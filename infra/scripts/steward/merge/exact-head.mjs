#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardExactHead 2026-08-04:
 * Trusted exact-head merge helpers. Candidate branches never call this with App secrets.
 */
import { assertApprovalsStillValid } from "../review/approver.mjs";
import { isGateEnabled, summarizeActivation } from "../activation/resolve-activation.mjs";
import { REQUIRED_CHECK_NAMES } from "../review/evidence.mjs";

export const ALLOWED_REPO = "Appsolino/Fusion";
export { REQUIRED_CHECK_NAMES };

/**
 * @param {{
 *   repository: string,
 *   risk: string,
 *   reviewer: object,
 *   approver: object,
 *   currentHeadSha: string,
 *   currentDiffSha256: string,
 *   currentTestsSha256: string,
 *   checksConclusion?: string,
 *   prState?: string,
 *   hostP?: boolean,
 *   production?: boolean,
 *   nowMs?: number,
 *   activationOpts?: { policyPath?: string, killPath?: string, env?: NodeJS.ProcessEnv, policy?: object },
 * }} input
 */
export function evaluateDualApprovalMerge(input) {
  const reasons = [];
  if (input.repository !== ALLOWED_REPO) {
    reasons.push("cross-repository-target-rejected");
  }
  if (input.hostP === true || input.production === true) {
    reasons.push("hostP-or-production-forbidden");
  }

  const act = summarizeActivation(input.activationOpts || {});
  if (act.killSwitch) reasons.push("kill-switch-or-KILL-file");

  const risk = String(input.risk || "").toUpperCase();
  if (risk === "CRITICAL") reasons.push("critical-forbidden");
  if (risk === "LOW") {
    if (!isGateEnabled("s2Enabled", input.activationOpts || {})) {
      reasons.push("s2-gate-disabled");
    }
  } else if (risk === "SENSITIVE") {
    if (!isGateEnabled("s3Enabled", input.activationOpts || {})) {
      reasons.push("s3-gate-disabled");
    }
  } else if (risk !== "LOW" && risk !== "SENSITIVE") {
    reasons.push(`unsupported-risk:${risk || "missing"}`);
  }

  const prState = String(input.prState || "OPEN").toUpperCase();
  if (prState === "MERGED") {
    return {
      ok: false,
      idempotentMerged: true,
      reasons: ["already-merged"],
    };
  }
  if (prState !== "OPEN") reasons.push(`pr-not-open:${prState}`);

  const checks = String(input.checksConclusion || "").toLowerCase();
  if (!checks || checks === "pending") reasons.push("required-checks-pending");
  else if (checks !== "success") reasons.push(`required-checks-${checks}`);

  try {
    assertApprovalsStillValid({
      reviewer: input.reviewer,
      approver: input.approver,
      currentHeadSha: input.currentHeadSha,
      currentDiffSha256: input.currentDiffSha256,
      currentTestsSha256: input.currentTestsSha256,
      nowMs: input.nowMs,
    });
  } catch (err) {
    reasons.push(`approval-revalidation:${err instanceof Error ? err.message : String(err)}`);
  }

  const uniq = [...new Set(reasons)];
  return {
    ok: uniq.length === 0,
    idempotentMerged: false,
    reasons: uniq,
    matchHeadCommit: input.currentHeadSha,
    activation: act,
  };
}

/** @deprecated */
export const evaluateGrokDualApprovalMerge = evaluateDualApprovalMerge;

/**
 * @param {{ prNumber: number, repo?: string, headSha: string }} input
 */
export function exactHeadMergeArgv(input) {
  const repo = input.repo || ALLOWED_REPO;
  if (!/^[0-9a-f]{40}$/i.test(input.headSha)) {
    throw new Error("exact-head merge requires full 40-char SHA");
  }
  return [
    "pr",
    "merge",
    String(input.prNumber),
    "--repo",
    repo,
    "--merge",
    "--match-head-commit",
    input.headSha.toLowerCase(),
  ];
}
