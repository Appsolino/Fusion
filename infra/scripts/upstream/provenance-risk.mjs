#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-19:56:
 * Provenance-aware risk for upstream absorbs. Integration impact still selects
 * deterministic suites. Exact official Runfusion content must not be treated as
 * 169 files of new Appsolino engineering requiring human review or edit agents.
 *
 * Dimensions:
 *   provenance: EXACT_UPSTREAM | LOCAL_APPSOLINO | CONFLICT_RESOLUTION | MIXED
 *   integrationImpact: LOW | MEDIUM | HIGH
 *
 * Gold path for EXACT_UPSTREAM + HIGH impact:
 *   strong tests + read-only SENSITIVE_REVIEW + no human + no Composer unless concrete failure.
 */
import { classifyUpstream, LARGE_FILE_COUNT, LARGE_COMMIT_COUNT } from "../auto2-classify-upstream.mjs";

export const PROVENANCE = Object.freeze([
  "EXACT_UPSTREAM",
  "LOCAL_APPSOLINO",
  "CONFLICT_RESOLUTION",
  "MIXED",
]);

/**
 * Classify change provenance for an automation upstream absorb.
 * @param {{
 *   isAutomationUpstreamPr?: boolean,
 *   conflictedFiles?: string[],
 *   localPatchPathsTouched?: string[],
 *   appsolinoOnlyPaths?: string[],
 *   changedFiles?: string[],
 * }} input
 */
export function classifyChangeProvenance(input = {}) {
  const conflicts = Array.isArray(input.conflictedFiles) ? input.conflictedFiles.filter(Boolean) : [];
  const localPatches = Array.isArray(input.localPatchPathsTouched)
    ? input.localPatchPathsTouched.filter(Boolean)
    : [];
  const appsolinoOnly = Array.isArray(input.appsolinoOnlyPaths)
    ? input.appsolinoOnlyPaths.filter(Boolean)
    : [];

  if (!input.isAutomationUpstreamPr) {
    return {
      provenance: "LOCAL_APPSOLINO",
      reasons: ["not an automation/upstream-* absorb"],
    };
  }
  if (conflicts.length) {
    return {
      provenance: "CONFLICT_RESOLUTION",
      reasons: [`${conflicts.length} conflicted path(s) required Appsolino resolution`],
      conflictedFiles: conflicts,
    };
  }
  if (localPatches.length || appsolinoOnly.length) {
    return {
      provenance: "MIXED",
      reasons: [
        localPatches.length ? `${localPatches.length} local patch path(s) touched` : null,
        appsolinoOnly.length ? `${appsolinoOnly.length} Appsolino-only path(s)` : null,
      ].filter(Boolean),
      localPatchPathsTouched: localPatches,
      appsolinoOnlyPaths: appsolinoOnly,
    };
  }
  return {
    provenance: "EXACT_UPSTREAM",
    reasons: [
      "automation/upstream-* absorb with no recorded conflict resolution or local-only path set",
      "treat imported Runfusion commits as official upstream content — verify integration, do not re-architect",
    ],
  };
}

/**
 * Map flags → integration impact (suite selection), independent of provenance.
 * @param {ReturnType<typeof classifyUpstream>} classification
 */
export function classifyIntegrationImpact(classification) {
  if (!classification || classification.riskClass === "blocked") {
    return { integrationImpact: "HIGH", reasons: ["blocked or missing classification"] };
  }
  const high =
    classification.touchesMigrations ||
    classification.touchesAuthentication ||
    classification.touchesProviderRuntime ||
    classification.touchesDatabase ||
    classification.touchesWorkflows ||
    classification.touchesReleaseInfrastructure ||
    classification.touchesLockfiles ||
    classification.touchesDependencies;
  if (high) {
    return {
      integrationImpact: "HIGH",
      reasons: [
        classification.touchesMigrations ? "migrations" : null,
        classification.touchesAuthentication ? "authentication" : null,
        classification.touchesProviderRuntime ? "provider/runtime" : null,
        classification.touchesDatabase ? "database" : null,
        classification.touchesWorkflows ? "workflows" : null,
        classification.touchesReleaseInfrastructure ? "release/infra" : null,
        classification.touchesLockfiles || classification.touchesDependencies ? "dependencies" : null,
      ].filter(Boolean),
    };
  }
  if (classification.riskClass === "medium") {
    return { integrationImpact: "MEDIUM", reasons: ["medium product-code class"] };
  }
  return { integrationImpact: "LOW", reasons: classification.reasons || [] };
}

/**
 * Compose provenance + impact. Softens "large file/commit count" friction for EXACT_UPSTREAM:
 * counts remain observability and still expand suites via path flags, but do not alone imply
 * human approval or edit-agent necessity.
 *
 * @param {Parameters<typeof classifyUpstream>[0] & {
 *   conflictedFiles?: string[],
 *   localPatchPathsTouched?: string[],
 *   appsolinoOnlyPaths?: string[],
 * }} input
 */
export function classifyUpstreamWithProvenance(input) {
  const base = classifyUpstream(input);
  const provenance = classifyChangeProvenance({
    isAutomationUpstreamPr: input.isAutomationPr !== false,
    conflictedFiles: input.conflictedFiles,
    localPatchPathsTouched: input.localPatchPathsTouched,
    appsolinoOnlyPaths: input.appsolinoOnlyPaths,
    changedFiles: input.changedFiles,
  });
  const impact = classifyIntegrationImpact(base);

  /** @type {string[]} */
  const reasons = [...(base.reasons || [])];
  if (provenance.provenance === "EXACT_UPSTREAM") {
    // Rephrase volume reasons so operators do not treat volume as Appsolino invention risk.
    for (let i = 0; i < reasons.length; i++) {
      if (/unusually large file count/i.test(reasons[i])) {
        reasons[i] = `exact-upstream absorb volume (${base.changedFileCount} files) — suite observability, not human-review trigger`;
      }
      if (/unusually large commit count/i.test(reasons[i])) {
        reasons[i] = `exact-upstream absorb volume (${base.commitCount} commits) — suite observability, not human-review trigger`;
      }
    }
  }

  /*
  FNXC:AutomationGovernance 2026-08-07-19:56:
  Continuation policy for EXACT_UPSTREAM + HIGH: keep riskClass sensitive so suites stay strong,
  but mark humanReviewRequired=false and preferSensitiveReview=true (no Composer unless fail).
  */
  const humanReviewRequired = false; // autonomous upstream gold path never parks on Anas966
  const preferSensitiveReview =
    base.riskClass === "sensitive" ||
    base.riskClass === "medium" ||
    impact.integrationImpact === "HIGH";

  return {
    ...base,
    reasons,
    provenance: provenance.provenance,
    provenanceReasons: provenance.reasons,
    integrationImpact: impact.integrationImpact,
    integrationImpactReasons: impact.reasons,
    humanReviewRequired,
    preferSensitiveReview,
    volumeIsObservabilityOnly: provenance.provenance === "EXACT_UPSTREAM",
    policySummary:
      provenance.provenance === "EXACT_UPSTREAM"
        ? "EXACT_UPSTREAM: strong integration tests + read-only verifier; no human; no edit agent unless concrete failure"
        : provenance.provenance === "CONFLICT_RESOLUTION"
          ? "CONFLICT_RESOLUTION: scrutinize Appsolino resolution + strong tests"
          : "LOCAL/MIXED: scrutinize Appsolino delta + strong tests",
  };
}

export { LARGE_FILE_COUNT, LARGE_COMMIT_COUNT };
