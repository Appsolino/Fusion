#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Write AUTO-3 structured evidence artifact from trusted deploy-job outputs.
 * Called only from trusted AUTO-3 on main — never from candidate trees.
 * Steward S0 reads this artifact; it does not gain Host D deploy authority.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AUTO3_EVIDENCE_SCHEMA_VERSION } from "./policy.mjs";

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = resolve(args.out || "auto3-evidence.json");
  const evidence = {
    schemaVersion: AUTO3_EVIDENCE_SCHEMA_VERSION,
    sourceSha: args.sourceSha || "",
    releaseId: args.releaseId || "",
    applicationVersion: args.applicationVersion || "",
    terminal: String(args.terminal || "UNKNOWN").toUpperCase(),
    highestMigration: args.highestMigration || "",
    health: args.health || "",
    enginePaused: String(args.enginePaused || "true").toLowerCase() !== "false",
    hostPAccessed: String(args.hostPAccessed || "false").toLowerCase() === "true",
    previousRelease: args.previousRelease || "",
    recordedUtc: args.recordedUtc || new Date().toISOString(),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${outPath}\n`);
}

main();
