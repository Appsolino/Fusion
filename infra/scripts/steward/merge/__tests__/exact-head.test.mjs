#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  evaluateDualApprovalMerge,
  exactHeadMergeArgv,
} from "../exact-head.mjs";
import { REVIEW_MODEL, REVIEW_PROVIDER } from "../../review/policy.mjs";

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

describe("exact-head dual Cursor approval", () => {
  it("rejects cross-repo and Host P", () => {
    const r = evaluateDualApprovalMerge({
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
    const low = evaluateDualApprovalMerge({
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
  });

  it("dual APPROVE + green checks → ok when gate on", () => {
    const r = evaluateDualApprovalMerge({
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
    assert.ok(exactHeadMergeArgv({ prNumber: 80, headSha: "b".repeat(40) }).includes("--match-head-commit"));
  });
});
