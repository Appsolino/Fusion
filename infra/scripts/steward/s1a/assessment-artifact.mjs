#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Writer assessment artifact — sanitized only (no raw evidence pack).
 */
import { createHash } from "node:crypto";
import {
  ALLOWED_REPO,
  FIXTURE_MODEL,
  FIXTURE_PROVIDER,
  LIVE_MODEL,
  LIVE_PROVIDER,
  S1A_BOUNDS,
} from "./policy.mjs";

/**
 * @typedef {{
 *   schemaVersion: number,
 *   repo: string,
 *   issueNumber: number,
 *   fingerprint: string,
 *   occurrence: string,
 *   mode: string,
 *   engine: string,
 *   configuredProvider: string,
 *   configuredModel: string,
 *   actualProvider: string,
 *   actualModel: string,
 *   assessment: object,
 *   reviewer: object,
 *   markdown: string,
 *   revised: boolean,
 *   evidenceDigest: {
 *     sha256: string,
 *     fingerprint: string,
 *     failureClass: string|null,
 *     occurrence: string|null,
 *     upstreamSha: string|null,
 *     prUrl: string|null,
 *     conflictedFiles: string[],
 *     physical: object,
 *   },
 * }} AssessmentArtifact
 */

/**
 * @param {import("./evidence-pack.mjs").EvidencePack} pack
 */
export function buildEvidenceDigest(pack) {
  const payload = {
    fingerprint: pack.fingerprint,
    failureClass: pack.failureClass ?? null,
    occurrence: pack.latestOccurrenceId ?? null,
    upstreamSha: pack.auto1?.upstreamSha ?? null,
    prUrl: pack.auto1?.prUrl || pack.relatedPr?.url || null,
    conflictedFiles: [...(pack.auto1?.conflictedFiles || [])],
    physical: pack.physical || {},
  };
  const sha256 = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return { sha256, ...payload };
}

/**
 * Build writer-safe artifact (NO raw evidencePack / logs / patches / sides).
 * @param {Partial<AssessmentArtifact> & { evidencePack?: object, worktreePath?: string|null }} art
 * @returns {AssessmentArtifact}
 */
export function buildAssessmentArtifact(art) {
  const digest =
    art.evidenceDigest ||
    (art.evidencePack ? buildEvidenceDigest(/** @type {any} */ (art.evidencePack)) : null);
  if (!digest) {
    throw new Error("assessment artifact requires evidenceDigest");
  }
  return {
    schemaVersion: S1A_BOUNDS.artifactSchemaVersion,
    repo: String(art.repo || ""),
    issueNumber: Number(art.issueNumber),
    fingerprint: String(art.fingerprint || "").toLowerCase(),
    occurrence: String(art.occurrence || "").trim(),
    mode: String(art.mode || ""),
    engine: String(art.engine || ""),
    configuredProvider: String(art.configuredProvider || ""),
    configuredModel: String(art.configuredModel || ""),
    actualProvider: String(art.actualProvider || ""),
    actualModel: String(art.actualModel || ""),
    assessment: art.assessment || {},
    reviewer: art.reviewer || {},
    markdown: String(art.markdown || ""),
    revised: Boolean(art.revised),
    evidenceDigest: digest,
  };
}

/**
 * Reject artifacts that still carry raw evidence payloads.
 * @param {any} art
 */
export function assertArtifactSanitized(art) {
  const forbidden = [
    "evidencePack",
    "workflowLogs",
    "conflictFileSides",
    "gitPathLog",
    "comments",
    "worktreePath",
  ];
  for (const k of forbidden) {
    if (art && Object.prototype.hasOwnProperty.call(art, k) && art[k] != null) {
      throw new Error(`writer artifact must not include raw field: ${k}`);
    }
  }
  const md = String(art?.markdown || "");
  // Heuristic: huge raw log dumps shouldn't be in markdown either.
  if (md.length > 200_000) {
    throw new Error("writer artifact markdown exceeds safe size");
  }
  return true;
}

/**
 * Validate artifact for upsert. Refuse fixture engine claims in live.
 * @param {any} art
 * @param {{ expectMode?: string }} [opts]
 */
export function validateAssessmentArtifact(art, opts = {}) {
  if (!art || typeof art !== "object") {
    throw new Error("artifact missing");
  }
  assertArtifactSanitized(art);
  if (Number(art.schemaVersion) !== S1A_BOUNDS.artifactSchemaVersion) {
    throw new Error(`artifact schemaVersion mismatch: ${art.schemaVersion}`);
  }
  if (art.repo !== ALLOWED_REPO) {
    throw new Error(`artifact repo not allowed: ${art.repo}`);
  }
  if (!Number.isFinite(Number(art.issueNumber)) || Number(art.issueNumber) <= 0) {
    throw new Error("artifact issueNumber invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(String(art.fingerprint || ""))) {
    throw new Error("artifact fingerprint invalid");
  }
  if (!String(art.occurrence || "").trim()) {
    throw new Error("artifact occurrence missing");
  }
  if (
    art.configuredProvider !== art.actualProvider ||
    art.configuredModel !== art.actualModel
  ) {
    throw new Error("artifact provider/model mismatch (silent fallback forbidden)");
  }
  if (!art.assessment || typeof art.assessment !== "object") {
    throw new Error("artifact assessment missing");
  }
  if (!art.reviewer || typeof art.reviewer !== "object") {
    throw new Error("artifact reviewer missing");
  }
  if (!art.markdown) {
    throw new Error("artifact markdown missing");
  }
  if (!art.evidenceDigest?.sha256) {
    throw new Error("artifact evidenceDigest missing");
  }

  const mode = String(opts.expectMode || art.mode || "").toLowerCase();
  const engine = String(art.engine || "").toLowerCase();

  if (mode === "fixture" || mode === "fixture-replay") {
    if (engine === "fixture" || engine === "deterministic") {
      if (
        art.actualProvider !== FIXTURE_PROVIDER ||
        art.actualModel !== FIXTURE_MODEL
      ) {
        throw new Error(
          `fixture artifact provider/model must be ${FIXTURE_PROVIDER}/${FIXTURE_MODEL}`,
        );
      }
    }
    return /** @type {AssessmentArtifact} */ (art);
  }

  if (mode === "live") {
    if (engine === "fixture" || engine === "deterministic") {
      throw new Error("refuse: live artifact claims fixture/deterministic engine");
    }
    if (engine !== "cursor-cli") {
      throw new Error(`live artifact engine must be cursor-cli, got ${engine}`);
    }
    if (
      art.actualProvider !== LIVE_PROVIDER ||
      art.actualModel !== LIVE_MODEL ||
      art.assessment.actualProvider !== LIVE_PROVIDER ||
      art.assessment.actualModel !== LIVE_MODEL
    ) {
      throw new Error(
        `live artifact provider/model must be ${LIVE_PROVIDER}/${LIVE_MODEL}`,
      );
    }
    if (
      art.actualProvider === FIXTURE_PROVIDER ||
      art.actualModel === FIXTURE_MODEL
    ) {
      throw new Error("refuse: fixture ids reported as live AI provider/model");
    }
  }

  return /** @type {AssessmentArtifact} */ (art);
}
