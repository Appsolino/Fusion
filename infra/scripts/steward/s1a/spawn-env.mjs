#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Explicit allowlists for child-process environments (no credential inheritance).
 */

/**
 * Keys that must never leak into reviewer/cursor children.
 */
export const FORBIDDEN_CHILD_ENV_KEYS = Object.freeze([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "S1A_CURSOR_API_KEY",
  "CURSOR_API_KEY",
  "CURSOR_AGENT_API_KEY",
  "APPSOLINO_AUTOMATION_APP_PRIVATE_KEY",
  "APPSOLINO_AUTOMATION_APP_ID",
  "AWS_SECRET_ACCESS_KEY",
  "SSH_AUTH_SOCK",
]);

/**
 * @param {NodeJS.ProcessEnv} [src]
 */
function pick(src, keys) {
  /** @type {NodeJS.ProcessEnv} */
  const out = {};
  for (const k of keys) {
    if (src[k] != null && src[k] !== "") out[k] = src[k];
  }
  return out;
}

/**
 * Reviewer child: no Cursor or GitHub credentials.
 * @param {NodeJS.ProcessEnv} [src]
 */
export function reviewerChildEnv(src = process.env) {
  return pick(src, [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "NODE_OPTIONS",
    "LANG",
    "LC_ALL",
    "TZ",
  ]);
}

/**
 * Cursor child: optional API key only; never GitHub tokens.
 * @param {{ apiKey?: string|null, src?: NodeJS.ProcessEnv }} [opts]
 */
export function cursorChildEnv(opts = {}) {
  const src = opts.src || process.env;
  const env = pick(src, ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ"]);
  const key =
    opts.apiKey ??
    src.S1A_CURSOR_API_KEY ??
    src.CURSOR_API_KEY ??
    src.CURSOR_AGENT_API_KEY ??
    "";
  if (key) env.CURSOR_API_KEY = key;
  for (const bad of FORBIDDEN_CHILD_ENV_KEYS) {
    if (bad === "CURSOR_API_KEY") continue;
    delete env[bad];
  }
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  return env;
}

/**
 * Assert env object does not contain forbidden credential keys
 * (CURSOR_API_KEY allowed only when allowCursorKey=true).
 * @param {NodeJS.ProcessEnv} env
 * @param {{ allowCursorKey?: boolean }} [opts]
 */
export function assertNoCredentialLeak(env, opts = {}) {
  for (const k of FORBIDDEN_CHILD_ENV_KEYS) {
    if (opts.allowCursorKey && k === "CURSOR_API_KEY") continue;
    if (env[k]) {
      throw new Error(`child env leaks credential key: ${k}`);
    }
  }
  return true;
}
