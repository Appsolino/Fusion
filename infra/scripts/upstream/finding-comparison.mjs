#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamFindingComparison 2026-08-07-04:20:
 * Mandatory Finding Comparison before retain/adapt/create/retire of Appsolino patches.
 * Uses behavior, root cause, code path, reproduction, and version evidence — not title similarity.
 * AI may assist reasoning; deterministic evidence is required to retire (UPSTREAM_FIXED).
 */
import { PATCH_CLASSIFICATIONS } from "./patch-registry.mjs";

/**
 * @param {{
 *   localDefect: {
 *     description: string,
 *     reproduction?: string,
 *     affectedSubsystem?: string,
 *     codePaths?: string[],
 *     rootCause?: string,
 *   },
 *   upstreamSignals?: Array<{
 *     kind: "issue"|"pr"|"commit"|"code",
 *     id?: string,
 *     title?: string,
 *     body?: string,
 *     files?: string[],
 *     fixesBehavior?: boolean|null,
 *     sha?: string|null,
 *   }>,
 *   cleanUpstreamRegressionPass?: boolean|null,
 *   titleSimilarityOnly?: boolean,
 * }} input
 */
export function compareFinding(input) {
  const local = input.localDefect || { description: "" };
  const signals = Array.isArray(input.upstreamSignals) ? input.upstreamSignals : [];
  /** @type {string[]} */
  const evidence = [];
  let classification = "APPSOLINO_ONLY";
  let relatedIssue = null;
  let relatedPr = null;
  let relatedCommit = null;

  if (input.titleSimilarityOnly === true && signals.length > 0) {
    return {
      ok: false,
      classification: null,
      reason: "title similarity alone is insufficient for Finding Comparison",
      evidence: ["titleSimilarityOnly=true refused"],
      relatedIssue: null,
      relatedPr: null,
      relatedCommit: null,
    };
  }

  const localPaths = new Set((local.codePaths || []).map((p) => p.replace(/\\/g, "/")));
  let pathOverlap = false;
  let behaviorFixClaim = false;
  let recorded = false;

  for (const s of signals) {
    if (s.kind === "issue") {
      recorded = true;
      relatedIssue = s.id || relatedIssue;
      evidence.push(`upstream-issue:${s.id || s.title || "unknown"}`);
    }
    if (s.kind === "pr") {
      recorded = true;
      relatedPr = s.id || relatedPr;
      evidence.push(`upstream-pr:${s.id || s.title || "unknown"}`);
    }
    if (s.kind === "commit") {
      relatedCommit = s.sha || relatedCommit;
      evidence.push(`upstream-commit:${s.sha || s.id || "unknown"}`);
    }
    const files = (s.files || []).map((f) => f.replace(/\\/g, "/"));
    if (files.some((f) => localPaths.has(f) || [...localPaths].some((lp) => f.includes(lp) || lp.includes(f)))) {
      pathOverlap = true;
      evidence.push(`path-overlap:${files.slice(0, 5).join(",")}`);
    }
    if (s.fixesBehavior === true) {
      behaviorFixClaim = true;
      evidence.push("upstream-claims-behavior-fix");
    }
  }

  if (input.cleanUpstreamRegressionPass === true && behaviorFixClaim) {
    classification = "UPSTREAM_FIXED";
    evidence.push("clean-upstream-regression-PASS + upstream behavior fix evidence");
  } else if (input.cleanUpstreamRegressionPass === true && !behaviorFixClaim) {
    classification = "NOT_REPRODUCIBLE";
    evidence.push("clean-upstream-regression-PASS without explicit upstream fix signal");
  } else if (input.cleanUpstreamRegressionPass === false && pathOverlap) {
    classification = "UPSTREAM_RELATED";
    evidence.push("defect still fails on clean upstream; overlapping paths");
  } else if (input.cleanUpstreamRegressionPass === false && recorded) {
    classification = "UPSTREAM_RECORDED";
    evidence.push("defect still fails; upstream has related issue/PR but not proven fixed");
  } else if (input.cleanUpstreamRegressionPass === false) {
    classification = "APPSOLINO_ONLY";
    evidence.push("defect still fails on clean upstream; no strong upstream signal");
  } else if (recorded && pathOverlap) {
    classification = "UPSTREAM_RELATED";
  } else if (recorded) {
    classification = "UPSTREAM_RECORDED";
  }

  if (!PATCH_CLASSIFICATIONS.includes(/** @type {*} */ (classification))) {
    return {
      ok: false,
      classification: null,
      reason: `invalid derived classification ${classification}`,
      evidence,
      relatedIssue,
      relatedPr,
      relatedCommit,
    };
  }

  // Hard rule: never emit UPSTREAM_FIXED without clean regression PASS.
  if (classification === "UPSTREAM_FIXED" && input.cleanUpstreamRegressionPass !== true) {
    return {
      ok: false,
      classification: null,
      reason: "UPSTREAM_FIXED requires cleanUpstreamRegressionPass===true",
      evidence,
      relatedIssue,
      relatedPr,
      relatedCommit,
    };
  }

  return {
    ok: true,
    classification,
    reason: `Finding Comparison → ${classification}`,
    evidence,
    relatedIssue,
    relatedPr,
    relatedCommit,
  };
}
