#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS3 2026-08-05:
 * Documented rollback path for SENSITIVE assists (Appsolino + Host D only).
 */
import { ALLOWED_REPO } from "./policy.mjs";

/**
 * Build a concrete rollback plan string + structured steps.
 * Required before S3 eligibility / writer merge.
 *
 * @param {{
 *   previousMainSha?: string,
 *   mergedHeadSha?: string,
 *   prNumber?: number,
 *   hostDReleaseId?: string|null,
 *   deployedHostD?: boolean,
 * }} input
 */
export function describeS3RollbackPath(input = {}) {
  const previousMainSha = String(input.previousMainSha || "").trim();
  const mergedHeadSha = String(input.mergedHeadSha || "").trim();
  const prNumber = input.prNumber != null ? Number(input.prNumber) : null;
  const hostDReleaseId =
    input.hostDReleaseId != null ? String(input.hostDReleaseId) : null;
  const deployedHostD = input.deployedHostD === true;

  /** @type {string[]} */
  const steps = [
    `Repository scope: ${ALLOWED_REPO} only (never Host P).`,
    previousMainSha
      ? `Restore Appsolino main to previous SHA ${previousMainSha} via revert of merge (or exact-head revert PR) for head ${mergedHeadSha || "(pending)"}.`
      : "Capture previous main SHA before merge; revert merge commit on Appsolino main if needed.",
    prNumber
      ? `Reference repair/assist PR #${prNumber} in the revert commit message.`
      : "Reference the assist PR number in the revert commit message.",
  ];

  if (deployedHostD || hostDReleaseId) {
    steps.push(
      hostDReleaseId
        ? `Host D: roll back AUTO-3 release to previous release id ${hostDReleaseId} (AUTO-3 rollback path only).`
        : "Host D: if AUTO-3 deployed, roll back to the previous Host D release id recorded in evidence.",
    );
  } else {
    steps.push(
      "Host D: no deploy claimed — skip AUTO-3 rollback; do not invent a Host D action.",
    );
  }

  steps.push("Host P: PROHIBITED — do not SSH, deploy, or query Host P during rollback.");
  steps.push(
    "Re-run Level B/C validation on Appsolino (+ Host D if rolled back) before closing the incident.",
  );

  const plan = steps.join(" ");
  return {
    repository: ALLOWED_REPO,
    previousMainSha: previousMainSha || null,
    mergedHeadSha: mergedHeadSha || null,
    prNumber,
    hostDReleaseId,
    deployedHostD,
    hostP: false,
    steps,
    rollbackPlan: plan,
  };
}

/**
 * Validate that a caller-supplied rollback plan is non-empty and does not claim Host P.
 * @param {string} rollbackPlan
 */
export function assertRollbackPlanSafe(rollbackPlan) {
  const plan = String(rollbackPlan || "").trim();
  if (!plan) throw new Error("S3 rollback plan required");
  if (/\bhost\s*p\b/i.test(plan) && !/prohibit|forbid|never|not\s+access/i.test(plan)) {
    // Allow plans that explicitly prohibit Host P; reject plans that instruct Host P access.
    if (/\b(ssh|deploy|access|login).{0,40}host\s*p\b/i.test(plan)) {
      throw new Error("S3 rollback plan must not instruct Host P access");
    }
  }
  return plan;
}
