#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Cursor-only independent review/approval — separate processes, no GitHub write,
 * no Host D/P, no xAI dependency.
 */
export const REVIEW_PROVIDER = "cursor-cli";
export const REVIEW_MODEL = "composer-2.5";
export const IMPLEMENTER_PROVIDER = "cursor-cli";
export const IMPLEMENTER_MODEL = "composer-2.5";
export const CURSOR_AGENT_BIN = "cursor-agent";
export const ALLOWED_REPO = "Appsolino/Fusion";

export const VERDICTS = Object.freeze([
  "APPROVE",
  "REQUEST_CHANGES",
  "BLOCK",
  "NEEDS_OWNER",
]);

export const RISKS = Object.freeze(["LOW", "SENSITIVE", "CRITICAL"]);

/** Never passed into reviewer/approver child processes. */
export const FORBIDDEN_REVIEW_ENV = Object.freeze([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "APPSOLINO_AUTOMATION_APP_PRIVATE_KEY",
  "APPSOLINO_AUTOMATION_APP_ID",
  "HOST_D_SSH_KEY",
  "HOST_D_DEPLOY_SSH_KEY",
  "HOST_P_SSH_KEY",
  "XAI_API_KEY",
]);

/**
 * @param {{
 *   role: "reviewer"|"approver",
 *   apiKey?: string,
 *   src?: NodeJS.ProcessEnv,
 *   sessionId: string,
 * }} opts
 */
export function reviewChildEnv(opts) {
  const src = opts.src || process.env;
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    STEWARD_REVIEW_ROLE: opts.role,
    STEWARD_REVIEW_SESSION_ID: opts.sessionId,
  };
  for (const k of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ"]) {
    if (src[k]) env[k] = src[k];
  }
  const key =
    opts.apiKey ??
    src.S1A_CURSOR_API_KEY ??
    src.CURSOR_API_KEY ??
    src.CURSOR_AGENT_API_KEY ??
    "";
  if (key) env.CURSOR_API_KEY = key;
  for (const bad of FORBIDDEN_REVIEW_ENV) delete env[bad];
  return env;
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function assertNoWriteCreds(env) {
  for (const k of FORBIDDEN_REVIEW_ENV) {
    if (env[k]) throw new Error(`review child env leaks credential: ${k}`);
  }
  return true;
}

/**
 * Fail closed if someone reintroduces xAI as a silent dependency.
 * @param {NodeJS.ProcessEnv} [src]
 */
export function assertNoXaiRequirement(src = process.env) {
  // Presence of the secret is allowed (harmless) but must never be required.
  if (String(src.STEWARD_REQUIRE_XAI || "").toLowerCase() === "true") {
    throw new Error("STEWARD_REQUIRE_XAI is forbidden — Cursor-only review path");
  }
  return true;
}
