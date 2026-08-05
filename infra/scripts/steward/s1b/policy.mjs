#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-05:
 * S1B repair-PR agent policy — separate authority zone (not yet activated).
 */
export const S1B_PHASE = "S1B";
export const ALLOWED_REPO = "Appsolino/Fusion";
export const S1B_PROVIDER = "cursor-cli";
export const S1B_MODEL = "composer-2.5";
export const WORKTREE_ROOT = "/srv/appsolino-fusion/phase-1/worktrees";
export const CURSOR_AGENT_BIN =
  process.env.S1B_CURSOR_AGENT_BIN ||
  process.env.S1A_CURSOR_AGENT_BIN ||
  "/home/fusion/.local/bin/cursor-agent";

/** Env keys that may carry Automation App installation tokens for push/PR. */
export const S1B_APP_TOKEN_ENV_KEYS = Object.freeze([
  "S1B_GITHUB_APP_TOKEN",
  "AUTO1_GITHUB_APP_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
]);

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveS1bAppToken(env = process.env) {
  for (const k of S1B_APP_TOKEN_ENV_KEYS) {
    const v = env[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

/**
 * Fail closed when Automation App token is absent.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertS1bAppToken(env = process.env) {
  const token = resolveS1bAppToken(env);
  if (!token) {
    throw new Error(
      "S1B fail-closed: GitHub App token unavailable (set S1B_GITHUB_APP_TOKEN from Appsolino Automation GitHub App). Owner OAuth/ad-hoc PAT is not the routine identity.",
    );
  }
  return token;
}

/**
 * Fail closed on provider/model drift.
 * @param {{ provider?: string, model?: string }} [pins]
 */
export function assertS1bPins(pins = {}) {
  const provider = pins.provider || process.env.S1B_PROVIDER || S1B_PROVIDER;
  const model = pins.model || process.env.S1B_MODEL || S1B_MODEL;
  if (provider !== S1B_PROVIDER) {
    throw new Error(
      `S1B model/provider drift forbidden: expected provider ${S1B_PROVIDER} got ${provider}`,
    );
  }
  if (model !== S1B_MODEL) {
    throw new Error(
      `S1B model/provider drift forbidden: expected model ${S1B_MODEL} got ${model}`,
    );
  }
  return { provider, model };
}

/**
 * @param {string} fingerprint
 * @param {string} occurrence
 */
export function repairOccurrenceKey(fingerprint, occurrence) {
  return `${String(fingerprint || "").toLowerCase()}::${String(occurrence || "").trim()}`;
}

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
    occurrenceKey: repairOccurrenceKey(input.fingerprint, input.occurrence),
  };
}
