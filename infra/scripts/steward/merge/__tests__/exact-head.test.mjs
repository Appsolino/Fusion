#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateDualApprovalMerge,
  exactHeadMergeArgv,
} from "../exact-head.mjs";
import { REVIEW_MODEL, REVIEW_PROVIDER } from "../../review/policy.mjs";
import { REQUIRED_CHECK_NAMES, evaluateRequiredChecks } from "../../review/evidence.mjs";

function verdict(role, over = {}) {
  return {
    schemaVersion: 1,
    role,
    verdict: "APPROVE",
    risk: "LOW",
    repository: "Appsolino/Fusion",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    diffSha256: "c".repeat(64),
    testsSha256: "d".repeat(64),
    blockingFindings: [],
    nonBlockingFindings: [],
    requiredChanges: [],
    evidenceChecked: ["diff"],
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
    requestId: role === "reviewer" ? "r1" : "a1",
    sessionId: over.sessionId || randomUUID(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

function act({ s2 = false, s3 = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "eh-"));
  const policyPath = join(dir, "p.json");
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

describe("exact-head dual Cursor approval", () => {
  it("rejects cross-repo and Host P", () => {
    const a = act({ s2: true });
    try {
      const r = evaluateDualApprovalMerge({
        repository: "Runfusion/Fusion",
        risk: "LOW",
        reviewer: verdict("reviewer"),
        approver: verdict("approver"),
        currentHeadSha: "b".repeat(40),
        currentDiffSha256: "c".repeat(64),
        currentTestsSha256: "d".repeat(64),
        checksConclusion: "success",
        activationOpts: a.opts,
      });
      assert.equal(r.ok, false);
      assert.ok(r.reasons.some((x) => x.includes("cross-repository")));
    } finally {
      a.cleanup();
    }
  });

  it("reads real s2/s3 gates — no hardcoded true override", () => {
    const off = act({ s2: false, s3: false });
    try {
      const low = evaluateDualApprovalMerge({
        repository: "Appsolino/Fusion",
        risk: "LOW",
        reviewer: verdict("reviewer"),
        approver: verdict("approver"),
        currentHeadSha: "b".repeat(40),
        currentDiffSha256: "c".repeat(64),
        currentTestsSha256: "d".repeat(64),
        checksConclusion: "success",
        activationOpts: off.opts,
      });
      assert.ok(low.reasons.includes("s2-gate-disabled"));
      const sen = evaluateDualApprovalMerge({
        repository: "Appsolino/Fusion",
        risk: "SENSITIVE",
        reviewer: verdict("reviewer", { risk: "SENSITIVE" }),
        approver: verdict("approver", { risk: "SENSITIVE" }),
        currentHeadSha: "b".repeat(40),
        currentDiffSha256: "c".repeat(64),
        currentTestsSha256: "d".repeat(64),
        checksConclusion: "success",
        activationOpts: off.opts,
      });
      assert.ok(sen.reasons.includes("s3-gate-disabled"));
    } finally {
      off.cleanup();
    }
  });

  it("dual APPROVE + green checks → ok when gate enabled via policy", () => {
    const on = act({ s2: true });
    try {
      const r = evaluateDualApprovalMerge({
        repository: "Appsolino/Fusion",
        risk: "LOW",
        reviewer: verdict("reviewer"),
        approver: verdict("approver"),
        currentHeadSha: "b".repeat(40),
        currentDiffSha256: "c".repeat(64),
        currentTestsSha256: "d".repeat(64),
        checksConclusion: "success",
        activationOpts: on.opts,
      });
      assert.equal(r.ok, true);
      assert.ok(
        exactHeadMergeArgv({ prNumber: 80, headSha: "b".repeat(40) }).includes(
          "--match-head-commit",
        ),
      );
    } finally {
      on.cleanup();
    }
  });

  it("required check set is exact five names", () => {
    assert.deepEqual(REQUIRED_CHECK_NAMES, [
      "Lint",
      "Typecheck",
      "Build",
      "Gate",
      "Desktop packaging",
    ]);
    assert.equal(evaluateRequiredChecks([]).ok, false);
  });
});
