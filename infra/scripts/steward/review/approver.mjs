#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Independent Cursor approver — receives original evidence, not only reviewerClaims.
 */
import { randomUUID } from "node:crypto";
import { REVIEW_MODEL, REVIEW_PROVIDER, assertNoXaiRequirement } from "./policy.mjs";
import { invokeCursorReviewRole } from "./spawn.mjs";
import { buildRoleEvidencePayload } from "./evidence.mjs";
import { validateVerdict } from "./verdict.mjs";

/**
 * @param {{
 *   evidence: object,
 *   apiKey?: string,
 *   engine?: Function,
 *   spawnFn?: Function,
 *   modelProbe?: object,
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
  if (!e?.diffText || !e?.changedFiles?.length) {
    throw new Error("approver requires independent diffText and changedFiles");
  }
  if (e.reviewerVerdictRaw.headSha !== e.headSha) {
    throw new Error("stale head rejected (reviewer head ≠ current)");
  }
  if (e.reviewerVerdictRaw.diffSha256 !== e.diffSha256) {
    throw new Error("changed diff rejected vs reviewer");
  }
  if (e.reviewerVerdictRaw.testsSha256 !== e.testsSha256) {
    throw new Error("changed tests rejected vs reviewer");
  }

  const sessionId = input.sessionId || randomUUID();
  if (sessionId === e.reviewerSessionId) {
    throw new Error("approver must use a different sessionId than reviewer");
  }

  const payload = buildRoleEvidencePayload(e, "approver", {
    sessionId,
    reviewerRequestId: e.reviewerRequestId,
    reviewerSessionId: e.reviewerSessionId,
    // Thin review metadata only — original evidence is included independently above.
    reviewerClaims: {
      verdict: e.reviewerVerdictRaw.verdict,
      risk: e.reviewerVerdictRaw.risk,
      blockingFindings: e.reviewerVerdictRaw.blockingFindings,
      evidenceChecked: e.reviewerVerdictRaw.evidenceChecked,
      requestId: e.reviewerVerdictRaw.requestId,
    },
  });

  const system = [
    "You are CURSOR APPROVER for Appsolino/Fusion Steward.",
    "Fresh session separate from implementer and reviewer.",
    "Independently re-read diffText and requiredCheckResults.",
    "Do not approve solely because the reviewer approved.",
    "Return ONLY JSON: schemaVersion=1 role=approver.",
    "authorityCheck.hostP/production/destructiveData/secretExpansion must be false.",
    `configuredProvider must be ${REVIEW_PROVIDER}; configuredModel must be ${REVIEW_MODEL}.`,
    "Set actualProvider/actualModel to the model you actually ran.",
    "MUST set risk to the evidence.risk value (LOW or SENSITIVE) — never omit risk.",
  ].join(" ");

  const user = JSON.stringify(payload);

  const result = await invokeCursorReviewRole({
    role: "approver",
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
    role: "approver",
    // Fill risk from evidence when the model omits it (common ask-mode collapse).
    risk: parsed.risk || e.risk,
    repository: e.repository,
    baseSha: e.baseSha,
    headSha: e.headSha,
    diffSha256: e.diffSha256,
    testsSha256: e.testsSha256,
    configuredProvider: REVIEW_PROVIDER,
    configuredModel: REVIEW_MODEL,
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

/**
 * Writer-side approval pairing check (digests must already be recomputed by writer).
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
