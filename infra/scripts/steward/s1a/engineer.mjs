#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Engineer facade — routes to fixture-engine or cursor-cli.
 * Live mode NEVER uses fixture/deterministic.
 */
export { analyzeEvidence, classifyConflictFile, runFixtureEngine } from "./fixture-engine.mjs";
export { classifyConflictFile as classifyPath } from "./path-heuristics.mjs";

import { resolveEngineId } from "./policy.mjs";

/**
 * @typedef {import("./fixture-engine.mjs").Assessment} Assessment
 */

/**
 * Invoke engineer. Injectable engine for tests.
 * @param {import("./evidence-pack.mjs").EvidencePack} evidencePack
 * @param {{
 *   attempt?: number,
 *   priorRejection?: { reason?: string } | null,
 *   mode?: string,
 *   engine?: (pack: import("./evidence-pack.mjs").EvidencePack, opts: object) => Assessment | Promise<Assessment>,
 * }} [opts]
 */
export async function runEngineer(evidencePack, opts = {}) {
  if (opts.engine) {
    return opts.engine(evidencePack, opts);
  }
  const mode = opts.mode || process.env.S1A_MODE || "fixture";
  const engineId = resolveEngineId(mode, process.env.S1A_ENGINE);
  if (engineId === "cursor-cli") {
    const { runCursorEngine } = await import("./cursor-engine.mjs");
    return runCursorEngine(evidencePack, opts);
  }
  const { runFixtureEngine } = await import("./fixture-engine.mjs");
  return runFixtureEngine(evidencePack, opts);
}
