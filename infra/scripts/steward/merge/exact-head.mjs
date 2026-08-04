#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardExactHead 2026-08-04:
 * Trusted exact-head merge helpers. Candidate branches never call this with App secrets.
 * Grok dual-approval path revalidates digests before `gh pr merge --match-head-commit`.
 */
import { assertApprovalsStillValid } from "../grok/approver.mjs";
import { isGateEnabled } from "../activation/resolve-activation.mjs";

export const ALLOWED_REPO = "Appsolino/Fusion";

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
 *   s2Gate?: boolean,
 *   s3Gate?: boolean,
 * }} input
 */
export function evaluateGrokDualApprovalMerge(input) {
  const reasons = [];
  if (input.repository !== ALLOWED_REPO) {
    reasons.push("cross-repository-target-rejected");
  }
  if (input.hostP === true || input.production === true) {
    reasons.push("hostP-or-production-forbidden");
  }
  const risk = String(input.risk || "").toUpperCase();
  if (risk === "CRITICAL") reasons.push("critical-forbidden");
  if (risk === "LOW") {
    const s2 = input.s2Gate ?? isGateEnabled("s2Enabled");
    if (!s2) reasons.push("s2-gate-disabled");
  } else if (risk === "SENSITIVE") {
    const s3 = input.s3Gate ?? isGateEnabled("s3Enabled");
    if (!s3) reasons.push("s3-gate-disabled");
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
  };
}

/**
 * Build gh argv for exact-head merge (caller supplies App token env).
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
