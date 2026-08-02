#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-02-04:55:
 * Write AUTO-3 structured evidence from downloaded manifest + deploy receipt text.
 * Unavailable fields are null. Never hardcode enginePaused/hostPAccessed safe values.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildFactualAuto3Evidence, readTextIfExists } from "./parse-deploy-evidence.mjs";

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

  let manifest = null;
  if (args.manifest) {
    const mp = resolve(args.manifest);
    if (!existsSync(mp)) throw new Error(`manifest not found: ${mp}`);
    manifest = readFileSync(mp, "utf8");
  }

  const deployOutput = args["deploy-output"]
    ? readTextIfExists(resolve(args["deploy-output"]))
    : null;
  const terminalFile = args["terminal-file"]
    ? readTextIfExists(resolve(args["terminal-file"]))
    : null;

  const evidence = buildFactualAuto3Evidence({
    manifest,
    deployOutput,
    terminalFile,
    buildSourceSha: args.sourceSha || null,
    buildReleaseId: args.releaseId || null,
    recordedUtc: args.recordedUtc || new Date().toISOString(),
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${outPath}\n`);
}

main();
