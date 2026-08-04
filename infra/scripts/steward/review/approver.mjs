#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Independent Cursor approver — new session after reviewer APPROVE.
 * Must not trust reviewer conclusions without re-checking digests.
 */
import { randomUUID } from "node:crypto";
import { REVIEW_MODEL, REVIEW_PROVIDER, assertNoXaiRequirement } from "./policy.mjs";
import { invokeCursorReviewRole } from "./spawn.mjs";
import { sha256Text, validateVerdict } from "./verdict.mjs";

/**
 * @param {{
 *   evidence: {
 *     repository: string,
 *     baseSha: string,
 *     headSha: string,
 *     diffText: string,
 *     testsLog: string,
 *     risk: string,
 *     rollbackPlan: string,
 *     reviewerRequestId: string,
 *     reviewerSessionId: string,
 *     reviewerVerdictRaw: object,
 *   },
 *   apiKey?: string,
 *   engine?: Function,
 *   spawnFn?: Function,
 *   nowMs?: number,
 *   sessionId?: string,
 * }} input
 */
export async function runCursorApprover(input) {
  assertNoXaiRequirement();
  const e = input.evidence;
  if (e.reviewerVerdictRaw?.verdict !== "APPROVE") {
    throw new Error("approver requires prior reviewer APPROVE");
  }
  const diffSha256 = sha256Text(e.diffText);
  const testsSha256 = sha256Text(e.testsLog);
  if (e.reviewerVerdictRaw.headSha !== e.headSha) {
    throw new Error("stale head rejected (reviewer head ≠ current)");
  }
  if (e.reviewerVerdictRaw.diffSha256 !== diffSha256) {
    throw new Error("changed diff rejected vs reviewer");
  }
  if (e.reviewerVerdictRaw.testsSha256 !== testsSha256) {
    throw new Error("changed tests rejected vs reviewer");
  }

  const sessionId = input.sessionId || randomUUID();
  if (sessionId === e.reviewerSessionId) {
    throw new Error("approver must use a different sessionId than reviewer");
  }

  const system = [
    "You are CURSOR APPROVER for Appsolino/Fusion Steward.",
    "Fresh session separate from implementer and reviewer.",
    "Independently validate exact head, digests, authority, and rollback.",
    "Do not approve solely because the reviewer approved.",
    "Return ONLY JSON: schemaVersion=1 role=approver.",
    "authorityCheck.hostP/production/destructiveData/secretExpansion must be false.",
    `configuredProvider/actualProvider must be ${REVIEW_PROVIDER}; model must be ${REVIEW_MODEL}.`,
  ].join(" ");

  const user = JSON.stringify({
    role: "approver",
    repository: e.repository,
    baseSha: e.baseSha,
    headSha: e.headSha,
    diffSha256,
    testsSha256,
    risk: e.risk,
    rollbackPlan: e.rollbackPlan,
    reviewerRequestId: e.reviewerRequestId,
    reviewerSessionId: e.reviewerSessionId,
    reviewerClaims: {
      verdict: e.reviewerVerdictRaw.verdict,
      risk: e.reviewerVerdictRaw.risk,
      blockingFindings: e.reviewerVerdictRaw.blockingFindings,
      evidenceChecked: e.reviewerVerdictRaw.evidenceChecked,
    },
    sessionId,
  });

  const result = await invokeCursorReviewRole({
    role: "approver",
    system,
    user,
    sessionId,
    apiKey: input.apiKey,
    engine: input.engine,
    spawnFn: input.spawnFn,
  });

  const art = {
    ...result.parsed,
    schemaVersion: 1,
    role: "approver",
    repository: e.repository,
    baseSha: e.baseSha,
    headSha: e.headSha,
    diffSha256,
    testsSha256,
    configuredProvider: REVIEW_PROVIDER,
    configuredModel: REVIEW_MODEL,
    actualProvider: REVIEW_PROVIDER,
    actualModel: REVIEW_MODEL,
    modelFingerprint: REVIEW_MODEL,
    requestId: result.requestId,
    sessionId: result.sessionId,
    elapsedMs: result.elapsedMs,
    expiresAt:
      result.parsed.expiresAt ||
      new Date(Date.now() + 6 * 3600_000).toISOString(),
  };

  return validateVerdict(art, {
    expectModel: REVIEW_MODEL,
    expectHeadSha: e.headSha,
    expectDiffSha256: diffSha256,
    expectTestsSha256: testsSha256,
    nowMs: input.nowMs ?? Date.now(),
  });
}

/**
 * Writer-side revalidation before exact-head merge (App token path).
 * @param {{
 *   reviewer: object,
 *   approver: object,
 *   currentHeadSha: string,
 *   currentDiffSha256: string,
 *   currentTestsSha256: string,
 *   nowMs?: number,
 * }} input
 */
export function assertApprovalsStillValid(input) {
  const reviewer = validateVerdict(input.reviewer, {
    expectHeadSha: input.currentHeadSha,
    expectDiffSha256: input.currentDiffSha256,
    expectTestsSha256: input.currentTestsSha256,
    nowMs: input.nowMs ?? Date.now(),
  });
  if (reviewer.verdict !== "APPROVE") throw new Error("reviewer not APPROVE");
  const approver = validateVerdict(input.approver, {
    expectHeadSha: input.currentHeadSha,
    expectDiffSha256: input.currentDiffSha256,
    expectTestsSha256: input.currentTestsSha256,
    nowMs: input.nowMs ?? Date.now(),
  });
  if (approver.verdict !== "APPROVE") throw new Error("approver not APPROVE");
  if (reviewer.requestId === approver.requestId) {
    throw new Error("candidate cannot self-approve (identical request IDs)");
  }
  if (reviewer.sessionId === approver.sessionId) {
    throw new Error("candidate cannot self-approve (identical session IDs)");
  }
  if (reviewer.role !== "reviewer" || approver.role !== "approver") {
    throw new Error("reviewer and approver roles must be distinct");
  }
  return { reviewer, approver };
}
