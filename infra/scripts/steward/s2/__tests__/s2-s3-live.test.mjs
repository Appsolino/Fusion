#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS2S3 2026-08-05:
 * Mocked live-path unit tests — eligibility → dual APPROVE → writer recompute → merge/reconcile.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runS2 } from "../run-s2.mjs";
import { runS3 } from "../../s3/run-s3.mjs";
import { reconcileOriginatingIncident } from "../reconcile-incident.mjs";
import { REVIEW_MODEL, REVIEW_PROVIDER } from "../../review/policy.mjs";
import {
  REQUIRED_CHECK_NAMES,
  buildEvidenceBundle,
  assertWriterRecomputedDigests,
} from "../../review/evidence.mjs";
import { writerRevalidateAndMaybeMerge } from "../../review/writer.mjs";

const SAMPLE_DIFF = `diff --git a/scripts/lib/lifecycle-column-census-baseline.json b/scripts/lib/lifecycle-column-census-baseline.json
--- a/scripts/lib/lifecycle-column-census-baseline.json
+++ b/scripts/lib/lifecycle-column-census-baseline.json
@@ -1,3 +1,4 @@
+{ "ok": true }
 export function run() {}
`;

const SENSITIVE_DIFF = `diff --git a/packages/engine/src/executor.ts b/packages/engine/src/executor.ts
--- a/packages/engine/src/executor.ts
+++ b/packages/engine/src/executor.ts
@@ -1,3 +1,4 @@
+import type { CredentialInstanceRotator } from "./credential-instance-rotation.js";
 export function run() {}
`;

function okRollup() {
  return REQUIRED_CHECK_NAMES.map((name) => ({
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
  }));
}

function tempActivation({ s2 = false, s3 = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "s2s3-act-"));
  const policyPath = join(dir, "activation-policy.json");
  const killPath = join(dir, "KILL");
  writeFileSync(
    policyPath,
    JSON.stringify({
      schemaVersion: 1,
      killSwitch: false,
      gates: {
        s1aAutoHandoff: { enabled: false },
        s0HandoffS1a: { enabled: false },
        s1bEnabled: { enabled: false },
        s2Enabled: { enabled: s2 },
        s3Enabled: { enabled: s3 },
      },
    }),
  );
  return {
    opts: { policyPath, killPath, env: {} },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function verdict(role, evidence, over = {}) {
  return {
    schemaVersion: 1,
    role,
    verdict: "APPROVE",
    risk: evidence.risk,
    repository: evidence.repository,
    baseSha: evidence.baseSha,
    headSha: evidence.headSha,
    diffSha256: evidence.diffSha256,
    testsSha256: evidence.testsSha256,
    blockingFindings: [],
    nonBlockingFindings: [],
    requiredChanges: [],
    evidenceChecked: ["diffText", "requiredCheckResults"],
    authorityCheck: {
      hostP: false,
      production: false,
      destructiveData: false,
      secretExpansion: false,
    },
    configuredProvider: REVIEW_PROVIDER,
    configuredModel: REVIEW_MODEL,
    actualProvider: REVIEW_PROVIDER,
    actualModel: REVIEW_MODEL,
    modelFingerprint: REVIEW_MODEL,
    requestId: `${role}-${randomUUID()}`,
    sessionId: over.sessionId || randomUUID(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

describe("S2 live path (mocked)", () => {
  it("gate required — skips when s2Enabled off", async () => {
    const act = tempActivation({ s2: false });
    try {
      const r = await runS2({
        prNumber: 90,
        issueNumber: 74,
        playbookId: "generated-baselines",
        paths: ["scripts/lib/lifecycle-column-census-baseline.json"],
        testsGreen: true,
        activationOpts: act.opts,
        dryRun: true,
      });
      assert.equal(r.action, "skipped");
      assert.ok(r.reasons.includes("s2-gate-disabled"));
      assert.equal(r.merged, false);
    } finally {
      act.cleanup();
    }
  });

  it("refuses semantic-source misclassified as LOW", async () => {
    const act = tempActivation({ s2: true });
    try {
      const r = await runS2({
        prNumber: 90,
        playbookId: "generated-baselines",
        paths: ["packages/engine/src/executor.ts"],
        testsGreen: true,
        s2GateEnabled: true,
        activationOpts: act.opts,
      });
      assert.equal(r.action, "skipped");
      assert.ok(r.reasons.some((x) => x.includes("semantic-source")));
    } finally {
      act.cleanup();
    }
  });

  it("plans full chain when eligible (dry-run)", async () => {
    const act = tempActivation({ s2: true });
    try {
      const r = await runS2({
        prNumber: 90,
        issueNumber: 74,
        playbookId: "generated-baselines",
        paths: ["scripts/lib/lifecycle-column-census-baseline.json"],
        testsGreen: true,
        s2GateEnabled: true,
        activationOpts: act.opts,
        dryRun: true,
        dualReviewFn: async () => ({
          action: "approved-ready",
          reviewerVerdict: "APPROVE",
          approverVerdict: "APPROVE",
        }),
      });
      assert.equal(r.action, "planned");
      assert.deepEqual(r.nextSteps, [
        "required-ci-green",
        "cursor-reviewer-approve",
        "cursor-approver-approve",
        "writer-live-recompute",
        "exact-head-merge",
        "originating-incident-reconcile",
      ]);
      assert.equal(r.configuredProvider, REVIEW_PROVIDER);
      assert.equal(r.hostP, false);
      assert.equal(r.reconcilePlan.action, "reconcile-planned");
    } finally {
      act.cleanup();
    }
  });

  it("writer live digest recompute + exact-head merge + incident reconcile", async () => {
    const liveBundle = buildEvidenceBundle({
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diffText: SAMPLE_DIFF,
      statusCheckRollup: okRollup(),
      risk: "LOW",
      rollbackPlan: "regen baseline from prior main",
    });
    const act = tempActivation({ s2: true });
    /** @type {string[]|null} */
    let mergeArgv = null;
    /** @type {string[]|null} */
    let ghArgv = null;
    try {
      // Prove digest recompute helper independently.
      assert.equal(
        assertWriterRecomputedDigests({
          artifactDiffSha256: liveBundle.diffSha256,
          recomputedDiffSha256: liveBundle.diffSha256,
          artifactTestsSha256: liveBundle.testsSha256,
          recomputedTestsSha256: liveBundle.testsSha256,
          usedArtifactAsCurrent: false,
        }),
        true,
      );

      const r = await runS2({
        prNumber: 90,
        issueNumber: 74,
        playbookId: "generated-baselines",
        paths: ["scripts/lib/lifecycle-column-census-baseline.json"],
        testsGreen: true,
        s2GateEnabled: true,
        activationOpts: act.opts,
        dryRun: false,
        merge: true,
        expectHead: liveBundle.headSha,
        fingerprint: "ab".repeat(32),
        occurrence: "workflow-run:1:attempt:1",
        artifact: {
          reviewer: verdict("reviewer", liveBundle),
          approver: verdict("approver", liveBundle),
          headSha: liveBundle.headSha,
          diffSha256: liveBundle.diffSha256,
          testsSha256: liveBundle.testsSha256,
        },
        dualReviewFn: async () => ({
          action: "approved-ready",
          reviewer: verdict("reviewer", liveBundle),
          approver: verdict("approver", liveBundle),
        }),
        writerFn: async (wInput) =>
          writerRevalidateAndMaybeMerge({
            ...wInput,
            fetchPr: () => ({
              state: "OPEN",
              baseRefOid: liveBundle.baseSha,
              headRefOid: liveBundle.headSha,
              statusCheckRollup: okRollup(),
            }),
            fetchDiff: () => SAMPLE_DIFF,
            mergeExec: (argv) => {
              mergeArgv = argv;
              return { status: 0, stdout: "ok" };
            },
          }),
        reconcileFn: (cInput) =>
          reconcileOriginatingIncident({
            ...cInput,
            gh: (argv) => {
              ghArgv = argv;
              return { status: 0, stdout: "ok" };
            },
          }),
      });

      assert.equal(r.action, "merged");
      assert.equal(r.merged, true);
      assert.equal(r.writerRecomputed, true);
      assert.ok(mergeArgv.includes("--match-head-commit"));
      assert.ok(mergeArgv.includes(liveBundle.headSha));
      assert.equal(r.reconcile.action, "reconciled");
      assert.ok(ghArgv.includes("issue"));
      assert.equal(r.hostP, false);
    } finally {
      act.cleanup();
    }
  });

  it("blocks merge when writer digests diverge (no self-compare)", async () => {
    const liveBundle = buildEvidenceBundle({
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diffText: SAMPLE_DIFF,
      statusCheckRollup: okRollup(),
      risk: "LOW",
      rollbackPlan: "r",
    });
    const act = tempActivation({ s2: true });
    try {
      await assert.rejects(
        async () =>
          runS2({
            prNumber: 90,
            playbookId: "generated-baselines",
            paths: ["scripts/lib/lifecycle-column-census-baseline.json"],
            testsGreen: true,
            s2GateEnabled: true,
            activationOpts: act.opts,
            dryRun: false,
            merge: true,
            artifact: {
              reviewer: verdict("reviewer", liveBundle),
              approver: verdict("approver", liveBundle),
              headSha: liveBundle.headSha,
              diffSha256: "0".repeat(64),
              testsSha256: liveBundle.testsSha256,
            },
            dualReviewFn: async () => ({
              action: "approved-ready",
              reviewerVerdict: "APPROVE",
              approverVerdict: "APPROVE",
            }),
            writerFn: async (wInput) =>
              writerRevalidateAndMaybeMerge({
                ...wInput,
                fetchPr: () => ({
                  state: "OPEN",
                  baseRefOid: liveBundle.baseSha,
                  headRefOid: liveBundle.headSha,
                  statusCheckRollup: okRollup(),
                }),
                fetchDiff: () => SAMPLE_DIFF,
              }),
          }),
        /diff digest mismatch/,
      );
    } finally {
      act.cleanup();
    }
  });
});

describe("S3 live path (mocked)", () => {
  it("gate required + hostP structurally forbidden", async () => {
    const skipped = await runS3({
      prNumber: 91,
      validationLevel: "B",
      rollbackPlan: "revert on Appsolino main; Host P prohibited",
      s3GateEnabled: false,
    });
    assert.equal(skipped.action, "skipped");
    assert.ok(skipped.reasons.includes("s3-gate-disabled"));

    await assert.rejects(
      async () =>
        runS3({
          prNumber: 91,
          validationLevel: "B",
          rollbackPlan: "revert",
          s3GateEnabled: true,
          hostP: true,
        }),
      /Host P/,
    );
  });

  it("plans dual APPROVE + writer merge wiring when eligible", async () => {
    const act = tempActivation({ s3: true });
    try {
      const r = await runS3({
        prNumber: 91,
        validationLevel: "C",
        previousMainSha: "a".repeat(40),
        s3GateEnabled: true,
        activationOpts: act.opts,
        dryRun: true,
        dualReviewFn: async () => ({
          action: "approved-ready",
          reviewerVerdict: "APPROVE",
          approverVerdict: "APPROVE",
        }),
      });
      assert.equal(r.action, "planned");
      assert.equal(r.writerMergeWired, true);
      assert.match(r.rollback.rollbackPlan, /Host P: PROHIBITED/);
      assert.ok(r.nextSteps.includes("writer-live-recompute-when-s3Enabled"));
      assert.equal(r.configuredProvider, REVIEW_PROVIDER);
    } finally {
      act.cleanup();
    }
  });

  it("writer merge when s3Enabled — exact-head + digest recompute", async () => {
    const liveBundle = buildEvidenceBundle({
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "c".repeat(40),
      diffText: SENSITIVE_DIFF,
      statusCheckRollup: okRollup(),
      risk: "SENSITIVE",
      rollbackPlan: "revert merge; Host P prohibited",
    });
    const act = tempActivation({ s3: true });
    /** @type {string[]|null} */
    let mergeArgv = null;
    try {
      const r = await runS3({
        prNumber: 91,
        validationLevel: "B",
        rollbackPlan: "revert merge on Appsolino main; Host P prohibited",
        previousMainSha: "a".repeat(40),
        s3GateEnabled: true,
        activationOpts: act.opts,
        dryRun: false,
        merge: true,
        expectHead: liveBundle.headSha,
        artifact: {
          reviewer: verdict("reviewer", liveBundle, { risk: "SENSITIVE" }),
          approver: verdict("approver", liveBundle, { risk: "SENSITIVE" }),
          headSha: liveBundle.headSha,
          diffSha256: liveBundle.diffSha256,
          testsSha256: liveBundle.testsSha256,
        },
        dualReviewFn: async () => ({
          action: "approved-ready",
          reviewer: verdict("reviewer", liveBundle, { risk: "SENSITIVE" }),
          approver: verdict("approver", liveBundle, { risk: "SENSITIVE" }),
        }),
        writerFn: async (wInput) => {
          assert.equal(wInput.risk, "SENSITIVE");
          return writerRevalidateAndMaybeMerge({
            ...wInput,
            fetchPr: () => ({
              state: "OPEN",
              baseRefOid: liveBundle.baseSha,
              headRefOid: liveBundle.headSha,
              statusCheckRollup: okRollup(),
            }),
            fetchDiff: () => SENSITIVE_DIFF,
            mergeExec: (argv) => {
              mergeArgv = argv;
              return { status: 0, stdout: "ok" };
            },
          });
        },
      });
      assert.equal(r.action, "merged");
      assert.equal(r.writerRecomputed, true);
      assert.equal(r.writerMergeWired, true);
      assert.ok(mergeArgv.includes("--match-head-commit"));
      assert.match(r.rollback.rollbackPlan, /Host P: PROHIBITED/);
      assert.equal(r.hostP, false);
      assert.equal(r.deployed, false);
    } finally {
      act.cleanup();
    }
  });

  it("s3 gate off blocks writer even after dual APPROVE", async () => {
    const liveBundle = buildEvidenceBundle({
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "c".repeat(40),
      diffText: SENSITIVE_DIFF,
      statusCheckRollup: okRollup(),
      risk: "SENSITIVE",
      rollbackPlan: "r",
    });
    // Force eligibility via s3GateEnabled true on runS3, but writer activation has s3 off.
    const act = tempActivation({ s3: false });
    try {
      const r = await runS3({
        prNumber: 91,
        validationLevel: "B",
        rollbackPlan: "revert; Host P prohibited",
        s3GateEnabled: true,
        activationOpts: act.opts,
        dryRun: false,
        merge: true,
        artifact: {
          reviewer: verdict("reviewer", liveBundle, { risk: "SENSITIVE" }),
          approver: verdict("approver", liveBundle, { risk: "SENSITIVE" }),
          headSha: liveBundle.headSha,
          diffSha256: liveBundle.diffSha256,
          testsSha256: liveBundle.testsSha256,
        },
        dualReviewFn: async () => ({
          action: "approved-ready",
          reviewerVerdict: "APPROVE",
          approverVerdict: "APPROVE",
        }),
        writerFn: async (wInput) =>
          writerRevalidateAndMaybeMerge({
            ...wInput,
            fetchPr: () => ({
              state: "OPEN",
              baseRefOid: liveBundle.baseSha,
              headRefOid: liveBundle.headSha,
              statusCheckRollup: okRollup(),
            }),
            fetchDiff: () => SENSITIVE_DIFF,
          }),
      });
      assert.equal(r.action, "merge-blocked");
      assert.ok(r.reasons.includes("s3-gate-disabled"));
      assert.equal(r.writerRecomputed, true);
      assert.equal(r.merged, false);
    } finally {
      act.cleanup();
    }
  });
});
