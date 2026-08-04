#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardGrok 2026-08-04:
 * Independent Grok reviewer — clean context; no Cursor transcript; no write token.
 */
import { resolveGrokModel, xaiJsonCompletion } from "./client.mjs";
import { GROK_ALIAS, GROK_PROVIDER, assertNoWriteCreds, grokChildEnv } from "./policy.mjs";
import { sha256Text, validateVerdict } from "./verdict.mjs";

/**
 * @param {{
 *   evidence: {
 *     mission: string,
 *     policyExcerpts: string,
 *     repository: string,
 *     baseSha: string,
 *     headSha: string,
 *     diffText: string,
 *     changedFiles: string[],
 *     testsLog: string,
 *     risk: string,
 *     physicalHostD?: object|null,
 *   },
 *   apiKey?: string,
 *   fetchImpl?: typeof fetch,
 *   nowMs?: number,
 * }} input
 */
export async function runGrokReviewer(input) {
  assertNoWriteCreds(grokChildEnv({ apiKey: input.apiKey }));
  const pin = await resolveGrokModel({
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
  });
  const e = input.evidence;
  const diffSha256 = sha256Text(e.diffText);
  const testsSha256 = sha256Text(e.testsLog);
  const system = [
    "You are GROK REVIEWER for Appsolino/Fusion Steward.",
    "Return ONLY a JSON object matching schemaVersion=1 role=reviewer.",
    "You do not receive Cursor conversation history.",
    "You have no GitHub write access and must not invent Host P actions.",
    "authorityCheck.hostP/production/destructiveData/secretExpansion must be false.",
    `configuredProvider must be ${GROK_PROVIDER}; configuredModel must be ${pin.actualModel}.`,
  ].join(" ");
  const user = JSON.stringify({
    role: "reviewer",
    mission: e.mission,
    policyExcerpts: e.policyExcerpts,
    repository: e.repository,
    baseSha: e.baseSha,
    headSha: e.headSha,
    diffSha256,
    testsSha256,
    changedFiles: e.changedFiles,
    testsLogExcerpt: String(e.testsLog || "").slice(0, 40_000),
    diffExcerpt: String(e.diffText || "").slice(0, 120_000),
    riskHint: e.risk,
    physicalHostD: e.physicalHostD ?? null,
    requiredFields: [
      "schemaVersion",
      "role",
      "verdict",
      "risk",
      "repository",
      "baseSha",
      "headSha",
      "diffSha256",
      "testsSha256",
      "blockingFindings",
      "nonBlockingFindings",
      "requiredChanges",
      "evidenceChecked",
      "authorityCheck",
      "configuredProvider",
      "configuredModel",
      "actualProvider",
      "actualModel",
      "modelFingerprint",
      "requestId",
      "expiresAt",
    ],
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
    role: "reviewer",
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

export { GROK_ALIAS };
