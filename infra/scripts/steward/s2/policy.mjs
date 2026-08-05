#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS2 2026-08-05:
 * Low-risk automatic completion after dual Cursor APPROVE + exact-head merge.
 */
import { isGateEnabled } from "../activation/resolve-activation.mjs";
import { REVIEW_MODEL, REVIEW_PROVIDER } from "../review/policy.mjs";

export const S2_PHASE = "S2";
export const ALLOWED_REPO = "Appsolino/Fusion";
export const S2_PROVIDER = REVIEW_PROVIDER;
export const S2_MODEL = REVIEW_MODEL;

/** Deterministic playbook ids — regenerate from merged tree, never ours/theirs. */
export const S2_PLAYBOOKS = Object.freeze([
  "generated-baselines",
  "generated-snapshots",
  "lockfile-regen-unchanged-intent",
  "formatting-lint-only",
  "known-safe-workflow-metadata",
  "stale-status-document-fields",
]);

/** Path/kind classes that must never be auto-completed as LOW. */
export const S2_FORBIDDEN_LOW_CLASSES = Object.freeze([
  "semantic-source",
  "workflow",
  "migration",
  "permission",
  "deployment",
  "dependency-intent",
]);

/**
 * Fail closed on provider/model drift (no silent xAI / alternate switch).
 * @param {{ provider?: string, model?: string }} [pins]
 */
export function assertS2Pins(pins = {}) {
  const provider = pins.provider || process.env.S2_PROVIDER || S2_PROVIDER;
  const model = pins.model || process.env.S2_MODEL || S2_MODEL;
  if (provider !== S2_PROVIDER) {
    throw new Error(
      `S2 provider drift forbidden: expected ${S2_PROVIDER} got ${provider}`,
    );
  }
  if (model !== S2_MODEL) {
    throw new Error(
      `S2 model drift forbidden: expected ${S2_MODEL} got ${model}`,
    );
  }
  if (String(process.env.STEWARD_REQUIRE_XAI || "").toLowerCase() === "true") {
    throw new Error("STEWARD_REQUIRE_XAI is forbidden on S2 — Cursor-only path");
  }
  return { provider, model };
}

/**
 * @param {{
 *   risk: string,
 *   testsGreen: boolean,
 *   playbookId?: string|null,
 *   hostP?: boolean,
 *   production?: boolean,
 *   repository?: string,
 *   reviewerVerdict?: string,
 *   approverVerdict?: string,
 *   s2GateEnabled?: boolean,
 *   activationOpts?: object,
 * }} input
 */
export function evaluateS2Eligibility(input) {
  const reasons = [];
  const gate =
    input.s2GateEnabled ??
    isGateEnabled("s2Enabled", input.activationOpts || {});
  if (!gate) reasons.push("s2-gate-disabled");
  if (String(input.risk || "").toUpperCase() !== "LOW") reasons.push("risk-not-low");
  if (!input.testsGreen) reasons.push("tests-not-green");
  if (input.hostP === true) reasons.push("hostP-forbidden");
  if (input.production === true) reasons.push("production-forbidden");
  const repo = input.repository || ALLOWED_REPO;
  if (repo !== ALLOWED_REPO) reasons.push("cross-repository-target-rejected");

  const playbookId = input.playbookId != null ? String(input.playbookId) : "";
  if (!playbookId) reasons.push("playbook-required");
  else if (!S2_PLAYBOOKS.includes(playbookId)) reasons.push("unknown-playbook");

  if (
    input.reviewerVerdict != null &&
    String(input.reviewerVerdict).toUpperCase() !== "APPROVE"
  ) {
    reasons.push("reviewer-not-approve");
  }
  if (
    input.approverVerdict != null &&
    String(input.approverVerdict).toUpperCase() !== "APPROVE"
  ) {
    reasons.push("approver-not-approve");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    playbooks: [...S2_PLAYBOOKS],
    playbookId: playbookId || null,
    phase: S2_PHASE,
    configuredProvider: S2_PROVIDER,
    configuredModel: S2_MODEL,
  };
}
