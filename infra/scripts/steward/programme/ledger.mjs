#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardProgramme 2026-08-04:
 * Machine-readable programme ledger helpers.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
export const LEDGER_PATH = join(HERE, "ledger.json");

export function loadLedger(path = LEDGER_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {object} ledger
 * @param {string} [path]
 */
export function saveLedger(ledger, path = LEDGER_PATH) {
  ledger.updatedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

/**
 * Live main SHA via git (not stored as self-invalidating CURRENT-STATE field).
 * @param {{ cwd?: string, remote?: string }} [opts]
 */
export function resolveLiveMainSha(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const remote = opts.remote || "origin";
  spawnSync("git", ["fetch", "--no-tags", remote, "main"], {
    cwd,
    encoding: "utf8",
  });
  const r = spawnSync("git", ["rev-parse", `${remote}/main`], {
    cwd,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`resolveLiveMainSha failed: ${(r.stderr || r.stdout || "").slice(0, 300)}`);
  }
  return String(r.stdout || "").trim();
}

/**
 * @param {string} phaseKey
 * @param {Partial<object>} patch
 * @param {{ path?: string }} [opts]
 */
export function updatePhase(phaseKey, patch, opts = {}) {
  const path = opts.path || LEDGER_PATH;
  const ledger = loadLedger(path);
  if (!ledger.phases?.[phaseKey]) {
    throw new Error(`unknown phase: ${phaseKey}`);
  }
  ledger.phases[phaseKey] = { ...ledger.phases[phaseKey], ...patch };
  if (patch.status === "IN_PROGRESS") ledger.activePhase = phaseKey;
  return saveLedger(ledger, path);
}

/**
 * @param {object} action
 * @param {{ path?: string }} [opts]
 */
export function addOwnerAction(action, opts = {}) {
  const path = opts.path || LEDGER_PATH;
  const ledger = loadLedger(path);
  ledger.openOwnerActions = ledger.openOwnerActions || [];
  const id = String(action.id || action.title || "").trim();
  if (id && ledger.openOwnerActions.some((a) => a.id === id)) {
    return ledger;
  }
  ledger.openOwnerActions.push({
    id: id || `owner-${ledger.openOwnerActions.length + 1}`,
    ...action,
    openedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  return saveLedger(ledger, path);
}
