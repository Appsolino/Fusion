#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REVIEW_MODEL, REVIEW_PROVIDER } from "../policy.mjs";
import {
  REQUIRED_CHECK_NAMES,
  buildEvidenceBundle,
} from "../evidence.mjs";
import { writerRevalidateAndMaybeMerge } from "../writer.mjs";
import { sha256Text } from "../verdict.mjs";

const SAMPLE_DIFF = `diff --git a/packages/engine/src/executor.ts b/packages/engine/src/executor.ts
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

function verdict(role, evidence, over = {}) {
  return {
    schemaVersion: 1,
    role,
    verdict: "APPROVE",
    risk: "LOW",
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
    modelFingerprint: `${REVIEW_MODEL} (listed)`,
    requestId: `${role}-${randomUUID()}`,
    sessionId: over.sessionId || randomUUID(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

function tempActivation({ s2 = false, s3 = false, kill = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "writer-act-"));
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
      emergency: { killSwitchFile: "KILL" },
    }),
  );
  if (kill) writeFileSync(killPath, "1\n");
  return {
    opts: { policyPath, killPath, env: {} },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("writer independent recompute", () => {
  it("rejects artifact self-comparison flag", () => {
    assert.throws(
      () =>
        writerRevalidateAndMaybeMerge({
          prNumber: 80,
          risk: "LOW",
          usedArtifactAsCurrent: true,
          artifact: {
            reviewer: {},
            approver: {},
            headSha: "b".repeat(40),
            diffSha256: "c".repeat(64),
            testsSha256: "d".repeat(64),
          },
        }),
      /self-comparison/,
    );
  });

  it("recomputes live diff/checks; rejects stale artifact digests", () => {
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
      assert.throws(
        () =>
          writerRevalidateAndMaybeMerge({
            prNumber: 80,
            risk: "LOW",
            merge: false,
            dryRun: true,
            activationOpts: act.opts,
            artifact: {
              reviewer: verdict("reviewer", liveBundle),
              approver: verdict("approver", liveBundle),
              headSha: liveBundle.headSha,
              // Stale digests — must not pass via self-compare.
              diffSha256: sha256Text("stale-diff"),
              testsSha256: liveBundle.testsSha256,
            },
            fetchPr: () => ({
              state: "OPEN",
              baseRefOid: liveBundle.baseSha,
              headRefOid: liveBundle.headSha,
              statusCheckRollup: okRollup(),
            }),
            fetchDiff: () => SAMPLE_DIFF,
          }),
        /diff digest mismatch/,
      );
    } finally {
      act.cleanup();
    }
  });

  it("blocks when required check missing after live recompute", () => {
    // Artifact digests must match what writer will recompute from incomplete rollup,
    // so failure is checksOk=false (not a silent self-compare).
    const incomplete = okRollup().filter((c) => c.name !== "Lint");
    let threw = false;
    try {
      buildEvidenceBundle({
        repository: "Appsolino/Fusion",
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        diffText: SAMPLE_DIFF,
        statusCheckRollup: incomplete,
        risk: "LOW",
        rollbackPlan: "r",
      });
    } catch {
      threw = true;
    }
    // buildEvidenceBundle still builds even when checks fail (checksOk false).
    assert.equal(threw, false);
    const liveBundle = buildEvidenceBundle({
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diffText: SAMPLE_DIFF,
      statusCheckRollup: incomplete,
      risk: "LOW",
      rollbackPlan: "r",
    });
    assert.equal(liveBundle.checksOk, false);
    const act = tempActivation({ s2: true });
    try {
      const r = writerRevalidateAndMaybeMerge({
        prNumber: 80,
        risk: "LOW",
        merge: false,
        dryRun: true,
        activationOpts: act.opts,
        artifact: {
          reviewer: verdict("reviewer", liveBundle),
          approver: verdict("approver", liveBundle),
          headSha: liveBundle.headSha,
          diffSha256: liveBundle.diffSha256,
          testsSha256: liveBundle.testsSha256,
        },
        fetchPr: () => ({
          state: "OPEN",
          baseRefOid: liveBundle.baseSha,
          headRefOid: liveBundle.headSha,
          statusCheckRollup: incomplete,
        }),
        fetchDiff: () => SAMPLE_DIFF,
      });
      assert.equal(r.action, "merge-blocked");
      assert.equal(r.writerRecomputed, true);
      assert.ok(r.reasons.includes("missing-required-check:Lint"));
    } finally {
      act.cleanup();
    }
  });

  it("KILL and disabled s2 gate block writer merge", () => {
    const liveBundle = buildEvidenceBundle({
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diffText: SAMPLE_DIFF,
      statusCheckRollup: okRollup(),
      risk: "LOW",
      rollbackPlan: "r",
    });
    const kill = tempActivation({ s2: true, kill: true });
    try {
      const r = writerRevalidateAndMaybeMerge({
        prNumber: 80,
        risk: "LOW",
        merge: true,
        dryRun: false,
        activationOpts: kill.opts,
        artifact: {
          reviewer: verdict("reviewer", liveBundle),
          approver: verdict("approver", liveBundle),
          headSha: liveBundle.headSha,
          diffSha256: liveBundle.diffSha256,
          testsSha256: liveBundle.testsSha256,
        },
        fetchPr: () => ({
          state: "OPEN",
          baseRefOid: liveBundle.baseSha,
          headRefOid: liveBundle.headSha,
          statusCheckRollup: okRollup(),
        }),
        fetchDiff: () => SAMPLE_DIFF,
      });
      assert.equal(r.action, "merge-blocked");
      assert.ok(r.reasons.includes("kill-switch-or-KILL-file"));
    } finally {
      kill.cleanup();
    }

    const off = tempActivation({ s2: false });
    try {
      const r = writerRevalidateAndMaybeMerge({
        prNumber: 80,
        risk: "LOW",
        merge: false,
        dryRun: true,
        activationOpts: off.opts,
        artifact: {
          reviewer: verdict("reviewer", liveBundle),
          approver: verdict("approver", liveBundle),
          headSha: liveBundle.headSha,
          diffSha256: liveBundle.diffSha256,
          testsSha256: liveBundle.testsSha256,
        },
        fetchPr: () => ({
          state: "OPEN",
          baseRefOid: liveBundle.baseSha,
          headRefOid: liveBundle.headSha,
          statusCheckRollup: okRollup(),
        }),
        fetchDiff: () => SAMPLE_DIFF,
      });
      assert.equal(r.action, "merge-blocked");
      assert.equal(r.writerRecomputed, true);
      assert.ok(r.reasons.includes("s2-gate-disabled"));
      assert.equal(r.live.diffSha256, liveBundle.diffSha256);
      assert.equal(r.live.testsSha256, liveBundle.testsSha256);
    } finally {
      off.cleanup();
    }
  });

  it("writer-ready when digests match and gate enabled; merge uses --match-head-commit", () => {
    const liveBundle = buildEvidenceBundle({
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diffText: SAMPLE_DIFF,
      statusCheckRollup: okRollup(),
      risk: "LOW",
      rollbackPlan: "r",
    });
    const on = tempActivation({ s2: true });
    let mergeArgvSeen = null;
    try {
      const ready = writerRevalidateAndMaybeMerge({
        prNumber: 80,
        risk: "LOW",
        merge: false,
        dryRun: true,
        activationOpts: on.opts,
        artifact: {
          reviewer: verdict("reviewer", liveBundle),
          approver: verdict("approver", liveBundle),
          headSha: liveBundle.headSha,
          diffSha256: liveBundle.diffSha256,
          testsSha256: liveBundle.testsSha256,
        },
        fetchPr: () => ({
          state: "OPEN",
          baseRefOid: liveBundle.baseSha,
          headRefOid: liveBundle.headSha,
          statusCheckRollup: okRollup(),
        }),
        fetchDiff: () => SAMPLE_DIFF,
      });
      assert.equal(ready.action, "writer-ready");
      assert.equal(ready.writerRecomputed, true);
      assert.ok(ready.mergeArgv.includes("--match-head-commit"));

      const merged = writerRevalidateAndMaybeMerge({
        prNumber: 80,
        risk: "LOW",
        merge: true,
        dryRun: false,
        activationOpts: on.opts,
        artifact: {
          reviewer: verdict("reviewer", liveBundle),
          approver: verdict("approver", liveBundle),
          headSha: liveBundle.headSha,
          diffSha256: liveBundle.diffSha256,
          testsSha256: liveBundle.testsSha256,
        },
        fetchPr: () => ({
          state: "OPEN",
          baseRefOid: liveBundle.baseSha,
          headRefOid: liveBundle.headSha,
          statusCheckRollup: okRollup(),
        }),
        fetchDiff: () => SAMPLE_DIFF,
        mergeExec: (argv) => {
          mergeArgvSeen = argv;
          return { status: 0, stdout: "ok" };
        },
      });
      assert.equal(merged.action, "merged");
      assert.equal(merged.writerRecomputed, true);
      assert.ok(mergeArgvSeen.includes("--match-head-commit"));
      assert.ok(mergeArgvSeen.includes(liveBundle.headSha));
    } finally {
      on.cleanup();
    }
  });
});
