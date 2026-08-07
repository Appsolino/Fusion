#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-20:04:
 * Provenance-aware risk for upstream absorbs. Integration impact still selects
 * deterministic suites. Exact official Runfusion content must not be treated as
 * 169 files of new Appsolino engineering requiring human review or edit agents.
 *
 * Fail closed: missing durable AUTO-1 evidence never yields EXACT_UPSTREAM.
 * Resolved conflicts remain CONFLICT_RESOLUTION via sync-status records even when
 * GitHub later reports MERGEABLE.
 *
 * Dimensions:
 *   provenance: EXACT_UPSTREAM | LOCAL_APPSOLINO | CONFLICT_RESOLUTION | MIXED
 *   integrationImpact: LOW | MEDIUM | HIGH
 *
 * Gold path for EXACT_UPSTREAM + HIGH impact:
 *   strong tests + read-only integration review + no human + no Composer unless concrete failure.
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
 *   evidenceComplete?: boolean,
 *   conflictResolutionRecorded?: boolean,
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

  /*
  FNXC:AutomationGovernance 2026-08-07-20:04:
  Incomplete evidence must not grant the reduced-friction EXACT_UPSTREAM path.
  evidenceComplete must be explicitly true (loaded durable sync status). Fail closed
  to MIXED — still no human approval; only AI review scope + suites.
  */
  if (input.evidenceComplete !== true) {
    return {
      provenance: "MIXED",
      reasons: [
        "provenance evidence incomplete — fail closed away from EXACT_UPSTREAM",
        "require upstream-sync-status / Finding Comparison / patch reconcile proof on candidate",
      ],
    };
  }

  if (input.conflictResolutionRecorded === true || conflicts.length) {
    return {
      provenance: "CONFLICT_RESOLUTION",
      reasons: [
        input.conflictResolutionRecorded
          ? "AUTO-1 conflict/semantic resolution recorded in durable sync status"
          : `${conflicts.length} conflicted path(s) required Appsolino resolution`,
      ],
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
      "durable sync status present with no conflict resolution and no Appsolino-plane delta",
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
 * @param {Parameters<typeof classifyUpstream>[0] & {
 *   conflictedFiles?: string[],
 *   localPatchPathsTouched?: string[],
 *   appsolinoOnlyPaths?: string[],
 *   evidenceComplete?: boolean,
 *   conflictResolutionRecorded?: boolean,
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
    evidenceComplete: input.evidenceComplete,
    conflictResolutionRecorded: input.conflictResolutionRecorded,
  });
  const impact = classifyIntegrationImpact(base);

  /** @type {string[]} */
  const reasons = [...(base.reasons || [])];
  if (provenance.provenance === "EXACT_UPSTREAM") {
    for (let i = 0; i < reasons.length; i++) {
      if (/large absorb file count/i.test(reasons[i]) || /unusually large file count/i.test(reasons[i])) {
        reasons[i] = `exact-upstream absorb volume (${base.changedFileCount} files) — suite observability, not human-review trigger`;
      }
      if (/large absorb commit count/i.test(reasons[i]) || /unusually large commit count/i.test(reasons[i])) {
        reasons[i] = `exact-upstream absorb volume (${base.commitCount} commits) — suite observability, not human-review trigger`;
      }
    }
  }

  /*
  FNXC:AutomationGovernance 2026-08-07-20:04:
  humanReviewRequired stays false for all automation absorbs — provenance only scopes
  AI review depth and suites, never reintroduces Anas966.
  */
  const humanReviewRequired = false;
  const preferSensitiveReview =
    base.riskClass === "sensitive" ||
    base.riskClass === "medium" ||
    impact.integrationImpact === "HIGH" ||
    provenance.provenance === "CONFLICT_RESOLUTION" ||
    provenance.provenance === "MIXED";

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
    evidenceComplete: input.evidenceComplete !== false,
    policySummary:
      provenance.provenance === "EXACT_UPSTREAM"
        ? "EXACT_UPSTREAM: strong integration tests + read-only verifier; no human; no edit agent unless concrete failure"
        : provenance.provenance === "CONFLICT_RESOLUTION"
          ? "CONFLICT_RESOLUTION: scrutinize Appsolino resolution + strong tests; no human"
          : "LOCAL/MIXED: scrutinize Appsolino delta + strong tests; no human",
  };
}

export { LARGE_FILE_COUNT, LARGE_COMMIT_COUNT };
