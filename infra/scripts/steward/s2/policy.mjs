#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS2 2026-08-04:
 * Low-risk automatic completion after dual Cursor APPROVE + exact-head merge.
 */
import { isGateEnabled } from "../activation/resolve-activation.mjs";

export const S2_PHASE = "S2";
export const ALLOWED_REPO = "Appsolino/Fusion";

/** Deterministic playbook ids — regenerate from merged tree, never ours/theirs. */
export const S2_PLAYBOOKS = Object.freeze([
  "generated-baselines",
  "generated-snapshots",
  "lockfile-regen-unchanged-intent",
  "formatting-lint-only",
  "known-safe-workflow-metadata",
  "stale-status-document-fields",
]);

/**
 * @param {{
 *   risk: string,
 *   testsGreen: boolean,
 *   playbookId?: string|null,
 *   hostP?: boolean,
 *   s2GateEnabled?: boolean,
 * }} input
 */
export function evaluateS2Eligibility(input) {
  const reasons = [];
  const gate = input.s2GateEnabled ?? isGateEnabled("s2Enabled");
  if (!gate) reasons.push("s2-gate-disabled");
  if (String(input.risk || "").toUpperCase() !== "LOW") reasons.push("risk-not-low");
  if (!input.testsGreen) reasons.push("tests-not-green");
  if (input.hostP === true) reasons.push("hostP-forbidden");
  if (input.playbookId != null && !S2_PLAYBOOKS.includes(String(input.playbookId))) {
    reasons.push("unknown-playbook");
  }
  return { eligible: reasons.length === 0, reasons, playbooks: [...S2_PLAYBOOKS] };
}
