#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-05:
 * Plan a repair PR (no push/merge). Activation gate must be ON.
 */
import {
  evaluateS1bEligibility,
  S1B_MODEL,
  S1B_PROVIDER,
} from "./policy.mjs";
import { isGateEnabled } from "../activation/resolve-activation.mjs";

/**
 * @param {{
 *   issueNumber: number,
 *   occurrence: string,
 *   fingerprint: string,
 *   assessment: object,
 *   existingRepairPr?: number|null,
 *   activationOpts?: object,
 *   s1bGateEnabled?: boolean,
 * }} input
 */
export function planS1bRepair(input) {
  const gate =
    input.s1bGateEnabled !== undefined
      ? Boolean(input.s1bGateEnabled)
      : isGateEnabled("s1bEnabled", input.activationOpts);
  const eligibility = evaluateS1bEligibility({
    issueNumber: input.issueNumber,
    occurrence: input.occurrence,
    fingerprint: input.fingerprint,
    repairRecommended: Boolean(input.assessment?.repairRecommended),
    reviewVerdict: String(
      input.assessment?.reviewerVerdict ||
        input.assessment?.review?.verdict ||
        "",
    ),
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
          "create write-enabled repair worktree on repair/steward-* branch",
          "cursor-cli composer-2.5 repair in worktree only (mutations allowed)",
          "run affected tests",
          "push repair branch via Automation App",
          "open one PR; invoke Cursor reviewer+approver (separate sessions)",
          "exact-head merge only after s2/s3 risk gates (outside S1B)",
        ]
      : [],
  };
}
