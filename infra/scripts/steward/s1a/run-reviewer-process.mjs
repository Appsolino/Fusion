#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Separate Node child-process reviewer entrypoint.
 * Reads stdin JSON {evidencePack, assessment}; writes ReviewResult JSON to stdout.
 * Must NOT import fixture-engine / engineer assessment builders.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reviewAssessment } from "./reviewer.mjs";

async function main() {
  const raw = readFileSync(0, "utf8");
  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    console.error(JSON.stringify({ error: `invalid-stdin-json: ${err.message}` }));
    process.exit(2);
  }
  if (!input || typeof input !== "object") {
    console.error(JSON.stringify({ error: "stdin must be object" }));
    process.exit(2);
  }
  // Hard contract: only these keys are used.
  const result = reviewAssessment({
    evidencePack: input.evidencePack,
    assessment: input.assessment,
  });
  process.stdout.write(JSON.stringify(result));
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main().catch((err) => {
    console.error(JSON.stringify({ error: String(err.message || err) }));
    process.exit(1);
  });
}

/**
 * Spawn this process as a child (used by analyze).
 * @param {{
 *   evidencePack: object,
 *   assessment: object,
 *   spawnFn?: typeof import("node:child_process").spawn,
 *   nodeBin?: string,
 *   scriptPath?: string,
 * }} input
 */
export async function runReviewerProcess(input) {
  const { spawn } = await import("node:child_process");
  const { dirname, join } = await import("node:path");
  const { reviewerChildEnv } = await import("./spawn-env.mjs");
  const spawnFn = input.spawnFn || spawn;
  const script =
    input.scriptPath ||
    join(dirname(fileURLToPath(import.meta.url)), "run-reviewer-process.mjs");
  const nodeBin = input.nodeBin || process.execPath;

  return new Promise((resolve, reject) => {
    const child = spawnFn(nodeBin, [script], {
      stdio: ["pipe", "pipe", "pipe"],
      env: reviewerChildEnv(),
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`reviewer-process exit ${code}: ${err || out}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`reviewer-process invalid JSON: ${e.message}`));
      }
    });
    child.stdin.write(
      JSON.stringify({
        evidencePack: input.evidencePack,
        assessment: input.assessment,
      }),
    );
    child.stdin.end();
  });
}
