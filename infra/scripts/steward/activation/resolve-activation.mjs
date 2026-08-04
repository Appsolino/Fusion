#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardProgramme 2026-08-04:
 * Resolve version-controlled activation gates (kill switch wins).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ACTIVATION_POLICY_PATH = join(HERE, "activation-policy.json");
export const KILL_FILE_PATH = join(HERE, "KILL");

/**
 * @param {{ policyPath?: string, killPath?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function loadActivationPolicy(opts = {}) {
  const path = opts.policyPath || ACTIVATION_POLICY_PATH;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (Number(raw.schemaVersion) !== 1) {
    throw new Error(`activation policy schemaVersion unsupported: ${raw.schemaVersion}`);
  }
  return raw;
}

/**
 * @param {string} gateKey
 * @param {{ policy?: object, env?: NodeJS.ProcessEnv, killPath?: string }} [opts]
 */
export function isGateEnabled(gateKey, opts = {}) {
  const env = opts.env || process.env;
  const killPath = opts.killPath || KILL_FILE_PATH;
  const policy = opts.policy || loadActivationPolicy(opts);
  if (policy.killSwitch === true) return false;
  if (existsSync(killPath)) return false;

  const gate = policy.gates?.[gateKey];
  if (!gate) throw new Error(`unknown activation gate: ${gateKey}`);

  const overrideName = gate.envOverride;
  if (overrideName && Object.prototype.hasOwnProperty.call(env, overrideName)) {
    const v = String(env[overrideName] || "");
    const trueValue = gate.envTrueValue || "true";
    return v === trueValue || v.toLowerCase() === "true" || v === "1";
  }
  return Boolean(gate.enabled);
}

/**
 * Effective S1A auto handoff for workflows (env may mirror policy).
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolveS1aAutoHandoff(opts = {}) {
  return isGateEnabled("s1aAutoHandoff", opts);
}

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolveS0HandoffS1a(opts = {}) {
  return isGateEnabled("s0HandoffS1a", opts);
}

export function summarizeActivation(opts = {}) {
  const policy = loadActivationPolicy(opts);
  const keys = Object.keys(policy.gates || {});
  /** @type {Record<string, boolean>} */
  const effective = {};
  for (const k of keys) effective[k] = isGateEnabled(k, { ...opts, policy });
  return {
    killSwitch: Boolean(policy.killSwitch) || existsSync(opts.killPath || KILL_FILE_PATH),
    effective,
  };
}
