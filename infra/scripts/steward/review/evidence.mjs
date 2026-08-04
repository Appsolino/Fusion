#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Shared evidence builders and required-check evaluation for dual Cursor review.
 */
import { classifyConflictFile } from "../s1a/path-heuristics.mjs";
import { sha256Text } from "./verdict.mjs";

/** Exact required CI check names for Appsolino/Fusion merge path. */
export const REQUIRED_CHECK_NAMES = Object.freeze([
  "Lint",
  "Typecheck",
  "Build",
  "Gate",
  "Desktop packaging",
]);

/**
 * Extract changed paths from a unified diff.
 * @param {string} diffText
 * @returns {string[]}
 */
export function extractChangedFilesFromDiff(diffText) {
  /** @type {string[]} */
  const files = [];
  for (const line of String(diffText || "").split("\n")) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) files.push(m[2]);
  }
  return [...new Set(files)];
}

/**
 * @param {string[]} paths
 */
export function classifyChangedFiles(paths) {
  return paths.map((p) => classifyConflictFile(p));
}

/**
 * Fail closed unless every required check is present exactly once and SUCCESS.
 * @param {Array<{name?: string, status?: string, conclusion?: string}>} rollup
 */
export function evaluateRequiredChecks(rollup) {
  const list = Array.isArray(rollup) ? rollup : [];
  /** @type {Record<string, {name: string, status: string, conclusion: string}>} */
  const byName = {};
  /** @type {string[]} */
  const reasons = [];

  for (const c of list) {
    const name = String(c?.name || "");
    if (!REQUIRED_CHECK_NAMES.includes(name)) continue;
    if (byName[name]) {
      reasons.push(`duplicate-required-check:${name}`);
      continue;
    }
    byName[name] = {
      name,
      status: String(c.status || ""),
      conclusion: String(c.conclusion || ""),
    };
  }

  for (const name of REQUIRED_CHECK_NAMES) {
    const row = byName[name];
    if (!row) {
      reasons.push(`missing-required-check:${name}`);
      continue;
    }
    const status = row.status.toUpperCase();
    const conclusion = row.conclusion.toUpperCase();
    if (status === "IN_PROGRESS" || status === "QUEUED" || status === "PENDING") {
      reasons.push(`required-check-pending:${name}`);
      continue;
    }
    if (conclusion === "CANCELLED" || conclusion === "TIMED_OUT" || conclusion === "NEUTRAL") {
      reasons.push(`required-check-${conclusion.toLowerCase()}:${name}`);
      continue;
    }
    if (conclusion === "SKIPPED") {
      reasons.push(`required-check-skipped:${name}`);
      continue;
    }
    if (conclusion !== "SUCCESS") {
      reasons.push(`required-check-failed:${name}:${conclusion || "empty"}`);
    }
  }

  const ok = reasons.length === 0;
  const normalized = REQUIRED_CHECK_NAMES.map((name) => byName[name] || { name, status: "missing", conclusion: "" });
  return {
    ok,
    reasons,
    checksConclusion: ok ? "success" : "failure",
    testsLog: JSON.stringify(normalized),
    testsSha256: sha256Text(JSON.stringify(normalized)),
    presentCount: Object.keys(byName).length,
  };
}

/**
 * Full evidence object shared by reviewer, approver, and writer.
 * @param {{
 *   repository: string,
 *   baseSha: string,
 *   headSha: string,
 *   diffText: string,
 *   statusCheckRollup: object[],
 *   risk: string,
 *   rollbackPlan: string,
 *   mission?: string,
 *   policyExcerpts?: string,
 *   physicalHostD?: object|null,
 * }} input
 */
export function buildEvidenceBundle(input) {
  const diffText = String(input.diffText || "");
  if (!diffText.trim()) {
    throw new Error("diffText empty — fail closed (reviewers must see the code)");
  }
  const changedFiles = extractChangedFilesFromDiff(diffText);
  if (changedFiles.length === 0) {
    throw new Error("changedFiles empty — fail closed");
  }
  const classifiedFiles = classifyChangedFiles(changedFiles);
  const checks = evaluateRequiredChecks(input.statusCheckRollup);
  return {
    repository: input.repository,
    baseSha: input.baseSha,
    headSha: input.headSha,
    diffText,
    diffSha256: sha256Text(diffText),
    changedFiles,
    classifiedFiles,
    testsLog: checks.testsLog,
    testsSha256: checks.testsSha256,
    checksConclusion: checks.checksConclusion,
    checksOk: checks.ok,
    checkReasons: checks.reasons,
    risk: input.risk,
    rollbackPlan: input.rollbackPlan,
    mission: input.mission || "",
    policyExcerpts: input.policyExcerpts || "",
    physicalHostD: input.physicalHostD ?? null,
  };
}

/**
 * Payload fields sent to Cursor reviewer/approver (must include actual patches).
 * @param {ReturnType<typeof buildEvidenceBundle>} evidence
 * @param {"reviewer"|"approver"} role
 * @param {object} [extra]
 */
export function buildRoleEvidencePayload(evidence, role, extra = {}) {
  return {
    role,
    repository: evidence.repository,
    baseSha: evidence.baseSha,
    headSha: evidence.headSha,
    diffSha256: evidence.diffSha256,
    testsSha256: evidence.testsSha256,
    changedFiles: evidence.changedFiles,
    classifiedFiles: evidence.classifiedFiles,
    // Actual code + check evidence (not digests alone).
    diffText: evidence.diffText,
    requiredCheckResults: JSON.parse(evidence.testsLog),
    testsLog: evidence.testsLog,
    risk: evidence.risk,
    rollbackPlan: evidence.rollbackPlan,
    mission: evidence.mission,
    policyExcerpts: evidence.policyExcerpts,
    physicalHostD: evidence.physicalHostD,
    ...extra,
  };
}

/**
 * Reject writer paths that compare artifact digests only to themselves.
 * @param {{
 *   artifactDiffSha256: string,
 *   recomputedDiffSha256: string,
 *   artifactTestsSha256: string,
 *   recomputedTestsSha256: string,
 *   usedArtifactAsCurrent?: boolean,
 * }} input
 */
export function assertWriterRecomputedDigests(input) {
  if (input.usedArtifactAsCurrent) {
    throw new Error("writer artifact self-comparison rejected");
  }
  if (input.artifactDiffSha256 !== input.recomputedDiffSha256) {
    throw new Error("writer recomputed diff digest mismatch");
  }
  if (input.artifactTestsSha256 !== input.recomputedTestsSha256) {
    throw new Error("writer recomputed tests digest mismatch");
  }
  return true;
}
