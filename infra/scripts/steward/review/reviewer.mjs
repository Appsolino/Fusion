#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Independent Cursor reviewer — fresh session; no implementer transcript; no write token.
 */
import { randomUUID } from "node:crypto";
import { REVIEW_MODEL, REVIEW_PROVIDER, assertNoXaiRequirement } from "./policy.mjs";
import { invokeCursorReviewRole } from "./spawn.mjs";
import { sha256Text, validateVerdict } from "./verdict.mjs";

/**
 * @param {{
 *   evidence: {
 *     mission?: string,
 *     policyExcerpts?: string,
 *     repository: string,
 *     baseSha: string,
 *     headSha: string,
 *     diffText: string,
 *     changedFiles?: string[],
 *     testsLog: string,
 *     risk: string,
 *     rollbackPlan?: string,
 *     physicalHostD?: object|null,
 *   },
 *   apiKey?: string,
 *   engine?: Function,
 *   spawnFn?: Function,
 *   nowMs?: number,
 *   sessionId?: string,
 * }} input
 */
export async function runCursorReviewer(input) {
  assertNoXaiRequirement();
  const e = input.evidence;
  const diffSha256 = sha256Text(e.diffText);
  const testsSha256 = sha256Text(e.testsLog);
  const sessionId = input.sessionId || randomUUID();

  const system = [
    "You are CURSOR REVIEWER for Appsolino/Fusion Steward.",
    "Fresh session. You do NOT receive the implementer conversation.",
    "You have no GitHub write access and must not invent Host P actions.",
    "Return ONLY JSON: schemaVersion=1 role=reviewer verdict APPROVE|REQUEST_CHANGES|BLOCK|NEEDS_OWNER.",
    "authorityCheck.hostP/production/destructiveData/secretExpansion must be false.",
    `configuredProvider/actualProvider must be ${REVIEW_PROVIDER}; configuredModel/actualModel must be ${REVIEW_MODEL}.`,
    "Include sessionId matching this invocation and a unique requestId.",
  ].join(" ");

  const user = JSON.stringify({
    role: "reviewer",
    mission: e.mission || "",
    policyExcerpts: e.policyExcerpts || "",
    repository: e.repository,
    baseSha: e.baseSha,
    headSha: e.headSha,
    diffSha256,
    testsSha256,
    changedFiles: e.changedFiles || [],
    risk: e.risk,
    rollbackPlan: e.rollbackPlan || "",
    physicalHostD: e.physicalHostD ?? null,
    sessionId,
  });

  const result = await invokeCursorReviewRole({
    role: "reviewer",
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
    role: "reviewer",
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
