#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardGrok 2026-08-04:
 * Grok (xAI) reviewer/approver — no GitHub write / no Host / no Cursor creds.
 */
export const GROK_PROVIDER = "xai";
export const GROK_ALIAS = "grok-4.5";
export const GROK_REASONING_EFFORT = "high";
export const XAI_API_BASE = "https://api.x.ai/v1";
export const ALLOWED_REPO = "Appsolino/Fusion";

export const VERDICTS = Object.freeze([
  "APPROVE",
  "REQUEST_CHANGES",
  "BLOCK",
  "NEEDS_OWNER",
]);

export const RISKS = Object.freeze(["LOW", "SENSITIVE", "CRITICAL"]);

/** Forbidden child env keys for Grok processes. */
export const FORBIDDEN_GROK_ENV = Object.freeze([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "S1A_CURSOR_API_KEY",
  "CURSOR_API_KEY",
  "CURSOR_AGENT_API_KEY",
  "APPSOLINO_AUTOMATION_APP_PRIVATE_KEY",
  "HOST_D_SSH_KEY",
  "HOST_P_SSH_KEY",
]);

/**
 * Minimal allowlist for Grok child processes.
 * @param {{ apiKey?: string, src?: NodeJS.ProcessEnv }} [opts]
 */
export function grokChildEnv(opts = {}) {
  const src = opts.src || process.env;
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const k of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ"]) {
    if (src[k]) env[k] = src[k];
  }
  const key = opts.apiKey ?? src.XAI_API_KEY ?? "";
  if (key) env.XAI_API_KEY = key;
  for (const bad of FORBIDDEN_GROK_ENV) delete env[bad];
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  return env;
}

export function assertNoWriteCreds(env) {
  for (const k of FORBIDDEN_GROK_ENV) {
    if (env[k]) throw new Error(`grok child env leaks credential: ${k}`);
  }
  return true;
}
