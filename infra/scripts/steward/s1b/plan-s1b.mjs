#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-04:
 * Plan a repair PR (no push/merge). Activation gate must be ON.
 */
import { evaluateS1bEligibility, S1B_MODEL, S1B_PROVIDER } from "./policy.mjs";
import { isGateEnabled } from "../activation/resolve-activation.mjs";

/**
 * @param {{
 *   issueNumber: number,
 *   occurrence: string,
 *   fingerprint: string,
 *   assessment: object,
 *   existingRepairPr?: number|null,
 * }} input
 */
export function planS1bRepair(input) {
  const gate = isGateEnabled("s1bEnabled");
  const eligibility = evaluateS1bEligibility({
    issueNumber: input.issueNumber,
    occurrence: input.occurrence,
    fingerprint: input.fingerprint,
    repairRecommended: Boolean(input.assessment?.repairRecommended),
    reviewVerdict: String(input.assessment?.reviewerVerdict || input.assessment?.review?.verdict || ""),
    risk: String(input.assessment?.risk || "SENSITIVE"),
    existingRepairPr: input.existingRepairPr ?? null,
    critical: Boolean(input.assessment?.criticalFreeze),
    s1bGateEnabled: gate,
  });
  return {
    ok: eligibility.eligible,
    eligibility,
    configuredProvider: S1B_PROVIDER,
    configuredModel: S1B_MODEL,
    nextSteps: eligibility.eligible
      ? [
          "create detached advice worktree (write-enabled sandbox)",
          "cursor-cli composer-2.5 repair in worktree only",
          "run affected tests",
          "push repair branch via Automation App",
          "open one PR; invoke Cursor reviewer+approver (separate sessions)",
          "exact-head merge only after risk controls",
        ]
      : [],
  };
}
