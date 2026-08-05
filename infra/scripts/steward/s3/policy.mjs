#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS3 2026-08-05:
 * Sensitive-change assistance — dual Cursor APPROVE, Appsolino + Host D only.
 */
import { isGateEnabled } from "../activation/resolve-activation.mjs";
import { REVIEW_MODEL, REVIEW_PROVIDER } from "../review/policy.mjs";

export const S3_PHASE = "S3";
export const ALLOWED_REPO = "Appsolino/Fusion";
export const S3_PROVIDER = REVIEW_PROVIDER;
export const S3_MODEL = REVIEW_MODEL;

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
 * Fail closed on provider/model drift (no silent switch away from Cursor).
 * @param {{ provider?: string, model?: string }} [pins]
 */
export function assertS3Pins(pins = {}) {
  const provider = pins.provider || process.env.S3_PROVIDER || S3_PROVIDER;
  const model = pins.model || process.env.S3_MODEL || S3_MODEL;
  if (provider !== S3_PROVIDER) {
    throw new Error(
      `S3 provider drift forbidden: expected ${S3_PROVIDER} got ${provider}`,
    );
  }
  if (model !== S3_MODEL) {
    throw new Error(
      `S3 model drift forbidden: expected ${S3_MODEL} got ${model}`,
    );
  }
  if (String(process.env.STEWARD_REQUIRE_XAI || "").toLowerCase() === "true") {
    throw new Error("STEWARD_REQUIRE_XAI is forbidden on S3 — Cursor-only path");
  }
  return { provider, model };
}

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
 *   repository?: string,
 *   s3GateEnabled?: boolean,
 *   activationOpts?: object,
 * }} input
 */
export function evaluateS3Eligibility(input) {
  const reasons = [];
  const gate =
    input.s3GateEnabled ??
    isGateEnabled("s3Enabled", input.activationOpts || {});
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
  const repo = input.repository || ALLOWED_REPO;
  if (repo !== ALLOWED_REPO) reasons.push("cross-repository-target-rejected");
  return {
    eligible: reasons.length === 0,
    reasons,
    phase: S3_PHASE,
    configuredProvider: S3_PROVIDER,
    configuredModel: S3_MODEL,
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
 * Host P is structurally prohibited for S3.
 * @param {object} authorityCheck
 */
export function mapAuthorityToNeedsOwner(authorityCheck) {
  const a = authorityCheck || {};
  if (a.hostP || a.production || a.destructiveData || a.secretExpansion) {
    return { verdict: "NEEDS_OWNER", durable: true };
  }
  return { verdict: null, durable: false };
}

/**
 * Structural Host P prohibition — always fails closed.
 * @param {{ hostP?: boolean, authorityCheck?: object }} input
 */
export function assertHostPForbidden(input = {}) {
  if (input.hostP === true || input.authorityCheck?.hostP === true) {
    throw new Error("S3 Host P structurally prohibited");
  }
  return true;
}
