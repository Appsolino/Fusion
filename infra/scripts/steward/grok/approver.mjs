#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardGrok 2026-08-04:
 * Independent Grok approver — new request/clean context after reviewer APPROVE.
 * Must not trust reviewer conclusions without re-checking digests.
 */
import { resolveGrokModel, xaiJsonCompletion } from "./client.mjs";
import { GROK_PROVIDER, assertNoWriteCreds, grokChildEnv } from "./policy.mjs";
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
 *     reviewerVerdictRaw: object,
 *   },
 *   apiKey?: string,
 *   fetchImpl?: typeof fetch,
 *   nowMs?: number,
 * }} input
 */
export async function runGrokApprover(input) {
  assertNoWriteCreds(grokChildEnv({ apiKey: input.apiKey }));
  const pin = await resolveGrokModel({
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
  });
  const e = input.evidence;
  if (e.reviewerVerdictRaw?.verdict !== "APPROVE") {
    throw new Error("approver requires prior reviewer APPROVE");
  }
  // Approver must not import hidden implementation reasoning — only digests + claims.
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

  const system = [
    "You are GROK APPROVER for Appsolino/Fusion Steward.",
    "Return ONLY a JSON object matching schemaVersion=1 role=approver.",
    "Independently validate exact head, digests, authority, and rollback.",
    "Do not approve solely because the reviewer approved.",
    "authorityCheck.hostP/production/destructiveData/secretExpansion must be false.",
    `configuredProvider must be ${GROK_PROVIDER}; configuredModel must be ${pin.actualModel}.`,
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
    reviewerClaims: {
      verdict: e.reviewerVerdictRaw.verdict,
      risk: e.reviewerVerdictRaw.risk,
      blockingFindings: e.reviewerVerdictRaw.blockingFindings,
      evidenceChecked: e.reviewerVerdictRaw.evidenceChecked,
    },
  });

  const result = await xaiJsonCompletion({
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    model: pin.actualModel,
    system,
    user,
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
    configuredProvider: GROK_PROVIDER,
    configuredModel: pin.actualModel,
    actualProvider: GROK_PROVIDER,
    actualModel: pin.actualModel,
    modelFingerprint: pin.modelFingerprint,
    requestId: result.requestId,
    expiresAt:
      result.parsed.expiresAt ||
      new Date(Date.now() + 6 * 3600_000).toISOString(),
  };

  return validateVerdict(art, {
    expectModel: pin.actualModel,
    expectHeadSha: e.headSha,
    expectDiffSha256: diffSha256,
    expectTestsSha256: testsSha256,
    nowMs: input.nowMs ?? Date.now(),
  });
}

/**
 * Writer-side revalidation before exact-head merge (App token path).
 * Candidate code must never perform this with its own secrets.
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
  if (reviewer.role !== "reviewer" || approver.role !== "approver") {
    throw new Error("reviewer and approver roles must be distinct");
  }
  return { reviewer, approver };
}
