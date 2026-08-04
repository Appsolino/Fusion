#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-04:
 * S1B repair-PR agent policy — separate authority zone (not yet activated).
 */
export const S1B_PHASE = "S1B";
export const ALLOWED_REPO = "Appsolino/Fusion";
export const S1B_PROVIDER = "cursor-cli";
export const S1B_MODEL = "composer-2.5";
export const WORKTREE_ROOT = "/srv/appsolino-fusion/phase-1/worktrees";

/**
 * @param {{
 *   issueNumber: number,
 *   occurrence: string,
 *   fingerprint: string,
 *   repairRecommended: boolean,
 *   reviewVerdict: string,
 *   risk: string,
 *   existingRepairPr?: number|null,
 *   critical?: boolean,
 *   s1bGateEnabled?: boolean,
 * }} input
 */
export function evaluateS1bEligibility(input) {
  const reasons = [];
  if (!input.s1bGateEnabled) reasons.push("s1b-gate-disabled");
  if (!Number.isFinite(Number(input.issueNumber)) || input.issueNumber <= 0) {
    reasons.push("issue-missing");
  }
  if (!/^[a-f0-9]{64}$/.test(String(input.fingerprint || ""))) {
    reasons.push("fingerprint-invalid");
  }
  if (!String(input.occurrence || "").trim()) reasons.push("occurrence-missing");
  if (!input.repairRecommended) reasons.push("repair-not-recommended");
  if (String(input.reviewVerdict || "").toUpperCase() !== "ACCEPT") {
    reasons.push("reviewer-not-accept");
  }
  if (input.critical || String(input.risk || "").toUpperCase() === "CRITICAL") {
    reasons.push("critical-forbidden");
  }
  if (input.existingRepairPr) reasons.push("repair-already-exists");
  return {
    eligible: reasons.length === 0,
    reasons,
    branchName: `repair/steward-${input.issueNumber}-${String(input.fingerprint || "").slice(0, 12)}`,
    worktreePath: `${WORKTREE_ROOT}/repair-${input.issueNumber}-${String(input.occurrence || "").replace(/[^0-9A-Za-z._-]/g, "_").slice(0, 80)}`,
  };
}
