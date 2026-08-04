#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS3 2026-08-04:
 * Sensitive-change assistance — dual Cursor APPROVE, Appsolino + Host D only.
 */
import { isGateEnabled } from "../activation/resolve-activation.mjs";

export const S3_PHASE = "S3";
export const ALLOWED_REPO = "Appsolino/Fusion";

export const S3_SENSITIVE_CLASSES = Object.freeze([
  "engine-executor-scheduler",
  "providers",
  "workflows",
  "auth-boundaries",
  "migrations",
  "deployment",
  "lockfile-dependency-changes",
  "database-schema",
  "github-app-permissions",
]);

/**
 * @param {{
 *   risk: string,
 *   validationLevel?: string,
 *   rollbackPlan?: string,
 *   hostP?: boolean,
 *   production?: boolean,
 *   destructiveData?: boolean,
 *   secretExpansion?: boolean,
 *   weakenControls?: boolean,
 *   s3GateEnabled?: boolean,
 * }} input
 */
export function evaluateS3Eligibility(input) {
  const reasons = [];
  const gate = input.s3GateEnabled ?? isGateEnabled("s3Enabled");
  if (!gate) reasons.push("s3-gate-disabled");
  if (String(input.risk || "").toUpperCase() !== "SENSITIVE") {
    reasons.push("risk-not-sensitive");
  }
  const level = String(input.validationLevel || "").toUpperCase();
  if (level !== "B" && level !== "C") reasons.push("validation-level-not-b-or-c");
  if (!String(input.rollbackPlan || "").trim()) reasons.push("rollback-plan-missing");
  if (input.hostP === true) reasons.push("hostP-forbidden");
  if (input.production === true) reasons.push("production-forbidden");
  if (input.destructiveData === true) reasons.push("destructive-data-forbidden");
  if (input.secretExpansion === true) reasons.push("secret-expansion-forbidden");
  if (input.weakenControls === true) reasons.push("control-weakening-forbidden");
  return {
    eligible: reasons.length === 0,
    reasons,
    may: [
      "investigate",
      "repair-in-branch",
      "level-b-or-c-validation",
      "create-pr",
      "dual-cursor-approve",
      "exact-head-merge-appsolino-main",
      "deploy-host-d-via-auto3",
    ],
    mustNot: [
      "host-p",
      "production-activation",
      "destructive-production-data",
      "create-or-expand-secrets",
      "weaken-rollback-audit-review",
    ],
  };
}

/**
 * Owner-only hard stop → NEEDS_OWNER durable.
 * @param {object} authorityCheck
 */
export function mapAuthorityToNeedsOwner(authorityCheck) {
  const a = authorityCheck || {};
  if (a.hostP || a.production || a.destructiveData || a.secretExpansion) {
    return { verdict: "NEEDS_OWNER", durable: true };
  }
  return { verdict: null, durable: false };
}
