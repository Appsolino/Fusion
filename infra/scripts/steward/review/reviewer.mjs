#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Independent Cursor reviewer — fresh session; receives actual patch evidence.
 */
import { randomUUID } from "node:crypto";
import { REVIEW_MODEL, REVIEW_PROVIDER, assertNoXaiRequirement } from "./policy.mjs";
import { invokeCursorReviewRole } from "./spawn.mjs";
import { buildRoleEvidencePayload } from "./evidence.mjs";
import { validateVerdict } from "./verdict.mjs";

/**
 * @param {{
 *   evidence: import("./evidence.mjs").buildEvidenceBundle extends Function ? any : object,
 *   apiKey?: string,
 *   engine?: Function,
 *   spawnFn?: Function,
 *   modelProbe?: object,
 *   nowMs?: number,
 *   sessionId?: string,
 * }} input
 */
export async function runCursorReviewer(input) {
  assertNoXaiRequirement();
  const e = input.evidence;
  if (!e?.diffText || !e?.changedFiles?.length) {
    throw new Error("reviewer requires diffText and changedFiles");
  }
  const sessionId = input.sessionId || randomUUID();
  const payload = buildRoleEvidencePayload(e, "reviewer", { sessionId });

  const system = [
    "You are CURSOR REVIEWER for Appsolino/Fusion Steward.",
    "Fresh session. You do NOT receive the implementer conversation.",
    "You have no GitHub write access and must not invent Host P actions.",
    "Review the COMPLETE diffText and requiredCheckResults before deciding.",
    "Return ONLY JSON: schemaVersion=1 role=reviewer verdict APPROVE|REQUEST_CHANGES|BLOCK|NEEDS_OWNER.",
    "authorityCheck.hostP/production/destructiveData/secretExpansion must be false.",
    `configuredProvider must be ${REVIEW_PROVIDER}; configuredModel must be ${REVIEW_MODEL}.`,
    "Set actualProvider/actualModel to the model you actually ran.",
    "MUST set risk to the evidence.risk value (LOW or SENSITIVE) — never omit risk.",
    "Include sessionId matching this invocation and a unique requestId.",
    "evidenceChecked must list what you examined (include diffText and requiredCheckResults).",
  ].join(" ");

  const user = JSON.stringify(payload);

  const result = await invokeCursorReviewRole({
    role: "reviewer",
    system,
    user,
    sessionId,
    apiKey: input.apiKey,
    engine: input.engine,
    spawnFn: input.spawnFn,
    modelProbe: input.modelProbe,
  });

  const parsed = result.parsed && typeof result.parsed === "object" ? result.parsed : {};
  const art = {
    ...parsed,
    schemaVersion: 1,
    role: "reviewer",
    // Fill risk from evidence when the model omits it (common ask-mode collapse).
    risk: parsed.risk || e.risk,
    repository: e.repository,
    baseSha: e.baseSha,
    headSha: e.headSha,
    diffSha256: e.diffSha256,
    testsSha256: e.testsSha256,
    configuredProvider: REVIEW_PROVIDER,
    configuredModel: REVIEW_MODEL,
    // From probe/execution evidence — not static overwrite of probe truth.
    actualProvider: result.actualProvider,
    actualModel: result.actualModel,
    modelFingerprint: result.modelFingerprint,
    requestId: result.requestId,
    sessionId: result.sessionId,
    elapsedMs: result.elapsedMs,
    evidencePayloadHasDiffText: user.includes('"diffText"') && user.includes(e.diffText.slice(0, 32)),
    expiresAt:
      parsed.expiresAt ||
      new Date(Date.now() + 6 * 3600_000).toISOString(),
  };

  for (const k of ["blockingFindings", "nonBlockingFindings", "requiredChanges", "evidenceChecked"]) {
    if (!Array.isArray(art[k])) art[k] = [];
  }
  if (!art.authorityCheck || typeof art.authorityCheck !== "object") {
    art.authorityCheck = {
      hostP: false,
      production: false,
      destructiveData: false,
      secretExpansion: false,
    };
  }
  try {
    return validateVerdict(art, {
      expectModel: REVIEW_MODEL,
      expectHeadSha: e.headSha,
      expectDiffSha256: e.diffSha256,
      expectTestsSha256: e.testsSha256,
      nowMs: input.nowMs ?? Date.now(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      schemaVersion: 1,
      role: art.role,
      verdict: "REQUEST_CHANGES",
      risk: art.risk || e.risk || "SENSITIVE",
      repository: e.repository,
      baseSha: e.baseSha,
      headSha: e.headSha,
      diffSha256: e.diffSha256,
      testsSha256: e.testsSha256,
      configuredProvider: REVIEW_PROVIDER,
      configuredModel: REVIEW_MODEL,
      actualProvider: art.actualProvider,
      actualModel: art.actualModel,
      modelFingerprint: art.modelFingerprint,
      requestId: art.requestId,
      sessionId: art.sessionId,
      blockingFindings: [`verdict-validation: ${msg}`],
      nonBlockingFindings: [],
      requiredChanges: ["Return a complete schemaVersion=1 verdict JSON including risk"],
      evidenceChecked: ["validation-failed"],
      authorityCheck: {
        hostP: false,
        production: false,
        destructiveData: false,
        secretExpansion: false,
      },
      expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
      elapsedMs: art.elapsedMs,
      evidencePayloadHasDiffText: art.evidencePayloadHasDiffText,
    };
  }
}

export { buildRoleEvidencePayload };
