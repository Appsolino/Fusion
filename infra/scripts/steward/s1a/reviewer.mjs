#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Independent second invocation — receives ONLY {evidencePack, assessment}.
 * No engineer scratchpads. Returns ACCEPT | REJECT | NEEDS_MORE_EVIDENCE.
 */
import { FILE_KIND, REVIEW_VERDICT, RISK_LEVEL } from "./policy.mjs";
import { classifyConflictFile } from "./engineer.mjs";

/**
 * @typedef {{
 *   verdict: string,
 *   reason: string,
 *   details: string[],
 * }} ReviewResult
 */

/**
 * Recompute expected risk from evidence alone (reviewer independence).
 * @param {import("./evidence-pack.mjs").EvidencePack} pack
 */
function expectedRiskFromEvidence(pack) {
  const terminal = String(pack.terminalStatus || "").toUpperCase();
  if (terminal === "CRITICAL" || terminal === "ROLLED_BACK") {
    return RISK_LEVEL.CRITICAL;
  }
  const files = (pack.auto1.conflictedFiles || []).map(classifyConflictFile);
  const sensitive =
    pack.auto1.touchesWorkflows === true ||
    pack.auto1.touchesMigrations === true ||
    pack.auto1.touchesLockfile === true ||
    pack.relatedPr?.touchesWorkflows === true ||
    pack.relatedPr?.touchesMigrations === true ||
    pack.relatedPr?.touchesLockfile === true ||
    files.some((f) =>
      [FILE_KIND.WORKFLOW, FILE_KIND.MIGRATION, FILE_KIND.LOCKFILE].includes(f.kind),
    );
  if (sensitive) return RISK_LEVEL.SENSITIVE;
  const hasSemantic = files.some((f) => f.kind === FILE_KIND.SEMANTIC_SOURCE);
  const hasGenerated = files.some((f) => f.kind === FILE_KIND.GENERATED_BASELINE);
  if (hasSemantic && hasGenerated) return RISK_LEVEL.SENSITIVE;
  if (hasSemantic) return RISK_LEVEL.HIGH;
  if (hasGenerated) return RISK_LEVEL.MEDIUM;
  return RISK_LEVEL.MEDIUM;
}

/**
 * Independent review of assessment against evidence.
 * @param {{
 *   evidencePack: import("./evidence-pack.mjs").EvidencePack,
 *   assessment: import("./engineer.mjs").Assessment,
 * }} input
 * @returns {ReviewResult}
 */
export function reviewAssessment(input) {
  const { evidencePack: pack, assessment } = input;
  /** @type {string[]} */
  const details = [];

  if (!pack?.fingerprint) {
    return {
      verdict: REVIEW_VERDICT.REJECT,
      reason: "missing-evidence-fingerprint",
      details: ["evidencePack.fingerprint required"],
    };
  }
  if (!assessment || typeof assessment !== "object") {
    return {
      verdict: REVIEW_VERDICT.REJECT,
      reason: "missing-assessment",
      details: ["assessment object required"],
    };
  }

  // Provider/model must match configured===actual (no silent fallback).
  if (
    assessment.configuredProvider !== assessment.actualProvider ||
    assessment.configuredModel !== assessment.actualModel
  ) {
    return {
      verdict: REVIEW_VERDICT.REJECT,
      reason: "provider-model-mismatch",
      details: [
        `configured=${assessment.configuredProvider}/${assessment.configuredModel}`,
        `actual=${assessment.actualProvider}/${assessment.actualModel}`,
      ],
    };
  }

  if (assessment.needsMoreEvidence || (assessment.evidenceGaps || []).length) {
    const criticalGaps = (assessment.evidenceGaps || []).filter((g) =>
      ["missing-upstream-sha", "missing-conflicted-files"].includes(g),
    );
    if (criticalGaps.length || assessment.needsMoreEvidence) {
      // Align with engineer signal; prefer NEEDS_MORE_EVIDENCE over REJECT.
      if (
        !pack.auto1.upstreamSha ||
        (!(pack.auto1.conflictedFiles || []).length &&
          pack.failureClass === "upstream-merge-conflict")
      ) {
        return {
          verdict: REVIEW_VERDICT.NEEDS_MORE_EVIDENCE,
          reason: "evidence-incomplete",
          details: assessment.evidenceGaps || criticalGaps,
        };
      }
    }
  }

  if (
    pack.failureClass === "upstream-merge-conflict" &&
    (!(pack.auto1.conflictedFiles || []).length || !pack.auto1.upstreamSha)
  ) {
    return {
      verdict: REVIEW_VERDICT.NEEDS_MORE_EVIDENCE,
      reason: "conflict-evidence-incomplete",
      details: [
        `conflictedFiles=${(pack.auto1.conflictedFiles || []).length}`,
        `upstreamSha=${pack.auto1.upstreamSha || "(missing)"}`,
      ],
    };
  }

  const expectedRisk = expectedRiskFromEvidence(pack);
  if (assessment.risk !== expectedRisk) {
    details.push(`risk-mismatch: assessment=${assessment.risk} expected=${expectedRisk}`);
    return {
      verdict: REVIEW_VERDICT.REJECT,
      reason: "risk-mismatch",
      details,
    };
  }

  // File kinds in assessment must match recomputation from evidence paths.
  const expectedFiles = (pack.auto1.conflictedFiles || []).map(classifyConflictFile);
  if ((assessment.files || []).length !== expectedFiles.length) {
    details.push(
      `file-count-mismatch: assessment=${(assessment.files || []).length} expected=${expectedFiles.length}`,
    );
    return {
      verdict: REVIEW_VERDICT.REJECT,
      reason: "file-count-mismatch",
      details,
    };
  }
  for (let i = 0; i < expectedFiles.length; i++) {
    const a = assessment.files[i];
    const e = expectedFiles[i];
    if (a.path !== e.path || a.kind !== e.kind) {
      details.push(`file-mismatch@${i}: ${a?.path}/${a?.kind} vs ${e.path}/${e.kind}`);
      return {
        verdict: REVIEW_VERDICT.REJECT,
        reason: "file-classification-mismatch",
        details,
      };
    }
  }

  if (!assessment.rootCause || !assessment.recommendedSolution) {
    return {
      verdict: REVIEW_VERDICT.REJECT,
      reason: "incomplete-assessment-prose",
      details: ["rootCause and recommendedSolution required"],
    };
  }

  // CRITICAL must remain freeze-only.
  if (expectedRisk === RISK_LEVEL.CRITICAL && assessment.repairRecommended) {
    return {
      verdict: REVIEW_VERDICT.REJECT,
      reason: "critical-must-not-recommend-repair",
      details: ["CRITICAL risk forbids repairRecommended"],
    };
  }

  details.push("independent-checks-passed");
  return {
    verdict: REVIEW_VERDICT.ACCEPT,
    reason: "ok",
    details,
  };
}

/**
 * @param {{
 *   evidencePack: import("./evidence-pack.mjs").EvidencePack,
 *   assessment: import("./engineer.mjs").Assessment,
 *   reviewFn?: typeof reviewAssessment,
 * }} input
 */
export async function runReviewer(input) {
  const fn = input.reviewFn || reviewAssessment;
  // Contract: only evidencePack + assessment (no scratchpads).
  return fn({
    evidencePack: input.evidencePack,
    assessment: input.assessment,
  });
}
