#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  FORBIDDEN_REVIEW_ENV,
  REVIEW_MODEL,
  REVIEW_PROVIDER,
  assertNoWriteCreds,
  assertNoXaiRequirement,
  reviewChildEnv,
} from "../policy.mjs";
import { sha256Text, validateVerdict } from "../verdict.mjs";
import { runCursorReviewer } from "../reviewer.mjs";
import { runCursorApprover, assertApprovalsStillValid } from "../approver.mjs";
import { evaluateDualApprovalMerge, exactHeadMergeArgv } from "../../merge/exact-head.mjs";

function baseVerdict(role, over = {}) {
  const sessionId = over.sessionId || randomUUID();
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
    sessionId,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

describe("cursor dual review control plane", () => {
  it("no xAI requirement", () => {
    assert.doesNotThrow(() => assertNoXaiRequirement({}));
    assert.throws(
      () => assertNoXaiRequirement({ STEWARD_REQUIRE_XAI: "true" }),
      /STEWARD_REQUIRE_XAI/,
    );
  });

  it("reviewer and approver envs cannot write / no Host / no XAI", () => {
    const rev = reviewChildEnv({
      role: "reviewer",
      sessionId: "s-rev",
      apiKey: "cursor-k",
      src: {
        PATH: "/usr/bin",
        GITHUB_TOKEN: "leak",
        GH_TOKEN: "leak",
        XAI_API_KEY: "xai",
        HOST_D_DEPLOY_SSH_KEY: "ssh",
        APPSOLINO_AUTOMATION_APP_PRIVATE_KEY: "pk",
      },
    });
    assert.equal(rev.CURSOR_API_KEY, "cursor-k");
    assert.equal(rev.STEWARD_REVIEW_SESSION_ID, "s-rev");
    assert.equal(rev.STEWARD_REVIEW_ROLE, "reviewer");
    for (const k of FORBIDDEN_REVIEW_ENV) assert.equal(rev[k], undefined);
    assert.doesNotThrow(() => assertNoWriteCreds(rev));
  });

  it("malformed / cross-repo / expired / stale digests rejected", () => {
    assert.throws(() => validateVerdict({}), /schemaVersion/);
    assert.throws(
      () => validateVerdict(baseVerdict("reviewer", { repository: "Runfusion/Fusion" })),
      /cross-repository/,
    );
    assert.throws(
      () =>
        validateVerdict(baseVerdict("reviewer"), {
          nowMs: Date.now() + 10_000_000,
        }),
      /expired/,
    );
    assert.throws(
      () =>
        validateVerdict(baseVerdict("reviewer"), {
          expectHeadSha: "e".repeat(40),
        }),
      /stale head/,
    );
    assert.throws(
      () =>
        validateVerdict(baseVerdict("reviewer"), {
          expectDiffSha256: "f".repeat(64),
        }),
      /changed diff/,
    );
    assert.throws(
      () =>
        validateVerdict(baseVerdict("reviewer"), {
          expectTestsSha256: "f".repeat(64),
        }),
      /changed tests/,
    );
  });

  it("three separate processes — distinct session and request IDs", async () => {
    const sessions = [];
    const engine = async ({ role, sessionId }) => {
      sessions.push({ role, sessionId });
      return baseVerdict(role, {
        sessionId,
        requestId: `${role}-${sessionId}`,
        risk: "LOW",
        diffSha256: sha256Text("DIFF"),
        testsSha256: sha256Text("TESTS"),
      });
    };
    const evidence = {
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diffText: "DIFF",
      testsLog: "TESTS",
      risk: "LOW",
      rollbackPlan: "revert merge",
      mission: "t",
      policyExcerpts: "p",
    };
    const reviewer = await runCursorReviewer({ evidence, engine });
    const approver = await runCursorApprover({
      evidence: {
        ...evidence,
        reviewerRequestId: reviewer.requestId,
        reviewerSessionId: reviewer.sessionId,
        reviewerVerdictRaw: reviewer,
        rollbackPlan: "revert merge",
      },
      engine,
    });
    assert.equal(sessions.length, 2);
    assert.notEqual(sessions[0].sessionId, sessions[1].sessionId);
    assert.notEqual(reviewer.requestId, approver.requestId);
    assert.notEqual(reviewer.sessionId, approver.sessionId);
    assert.equal(reviewer.configuredProvider, "cursor-cli");
    assert.equal(approver.actualModel, "composer-2.5");
    assertApprovalsStillValid({
      reviewer,
      approver,
      currentHeadSha: "b".repeat(40),
      currentDiffSha256: sha256Text("DIFF"),
      currentTestsSha256: sha256Text("TESTS"),
    });
  });

  it("candidate cannot self-approve with identical session/request", () => {
    const sid = randomUUID();
    const v = baseVerdict("reviewer", { sessionId: sid, requestId: "same" });
    const a = baseVerdict("approver", { sessionId: sid, requestId: "same" });
    assert.throws(
      () =>
        assertApprovalsStillValid({
          reviewer: v,
          approver: a,
          currentHeadSha: "b".repeat(40),
          currentDiffSha256: "c".repeat(64),
          currentTestsSha256: "d".repeat(64),
        }),
      /self-approve/,
    );
  });

  it("exact-head merge evaluation respects gates and Host P", () => {
    const reviewer = baseVerdict("reviewer");
    const approver = baseVerdict("approver", { sessionId: randomUUID() });
    const bad = evaluateDualApprovalMerge({
      repository: "Appsolino/Fusion",
      risk: "LOW",
      reviewer,
      approver,
      currentHeadSha: "b".repeat(40),
      currentDiffSha256: "c".repeat(64),
      currentTestsSha256: "d".repeat(64),
      checksConclusion: "success",
      hostP: true,
      s2Gate: true,
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.reasons.includes("hostP-or-production-forbidden"));

    const ok = evaluateDualApprovalMerge({
      repository: "Appsolino/Fusion",
      risk: "LOW",
      reviewer,
      approver,
      currentHeadSha: "b".repeat(40),
      currentDiffSha256: "c".repeat(64),
      currentTestsSha256: "d".repeat(64),
      checksConclusion: "success",
      s2Gate: true,
    });
    assert.equal(ok.ok, true);
    assert.ok(exactHeadMergeArgv({ prNumber: 80, headSha: "b".repeat(40) }).includes("--match-head-commit"));
  });
});
