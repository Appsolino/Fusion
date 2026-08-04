#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGrokDualApprovalMerge,
  exactHeadMergeArgv,
} from "../exact-head.mjs";

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
    configuredProvider: "xai",
    configuredModel: "grok-4.5",
    actualProvider: "xai",
    actualModel: "grok-4.5",
    modelFingerprint: "grok-4.5",
    requestId: role === "reviewer" ? "r1" : "a1",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

describe("exact-head grok dual approval", () => {
  it("rejects cross-repo and Host P", () => {
    const r = evaluateGrokDualApprovalMerge({
      repository: "Runfusion/Fusion",
      risk: "LOW",
      reviewer: verdict("reviewer"),
      approver: verdict("approver"),
      currentHeadSha: "b".repeat(40),
      currentDiffSha256: "c".repeat(64),
      currentTestsSha256: "d".repeat(64),
      checksConclusion: "success",
      s2Gate: true,
    });
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("cross-repository")));
  });

  it("LOW requires s2 gate; SENSITIVE requires s3", () => {
    const low = evaluateGrokDualApprovalMerge({
      repository: "Appsolino/Fusion",
      risk: "LOW",
      reviewer: verdict("reviewer"),
      approver: verdict("approver"),
      currentHeadSha: "b".repeat(40),
      currentDiffSha256: "c".repeat(64),
      currentTestsSha256: "d".repeat(64),
      checksConclusion: "success",
      s2Gate: false,
    });
    assert.ok(low.reasons.includes("s2-gate-disabled"));

    const sen = evaluateGrokDualApprovalMerge({
      repository: "Appsolino/Fusion",
      risk: "SENSITIVE",
      reviewer: verdict("reviewer", { risk: "SENSITIVE" }),
      approver: verdict("approver", { risk: "SENSITIVE" }),
      currentHeadSha: "b".repeat(40),
      currentDiffSha256: "c".repeat(64),
      currentTestsSha256: "d".repeat(64),
      checksConclusion: "success",
      s3Gate: false,
    });
    assert.ok(sen.reasons.includes("s3-gate-disabled"));
  });

  it("dual APPROVE + green checks → ok when gate on", () => {
    const r = evaluateGrokDualApprovalMerge({
      repository: "Appsolino/Fusion",
      risk: "LOW",
      reviewer: verdict("reviewer"),
      approver: verdict("approver"),
      currentHeadSha: "b".repeat(40),
      currentDiffSha256: "c".repeat(64),
      currentTestsSha256: "d".repeat(64),
      checksConclusion: "success",
      s2Gate: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.matchHeadCommit, "b".repeat(40));
  });

  it("exactHeadMergeArgv pins match-head-commit", () => {
    const argv = exactHeadMergeArgv({
      prNumber: 80,
      headSha: "b".repeat(40),
    });
    assert.ok(argv.includes("--match-head-commit"));
    assert.ok(argv.includes("b".repeat(40)));
  });
});
