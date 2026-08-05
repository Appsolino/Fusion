#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-05:
 * Cursor repair engine — write-capable spawn (not ask/plan).
 * Pins composer-2.5; fail closed on drift. Child env never inherits GH/App secrets.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertModelAvailable, parseLastJsonObject } from "../s1a/cursor-engine.mjs";
import { cursorChildEnv, assertNoCredentialLeak } from "../s1a/spawn-env.mjs";
import {
  assertS1bPins,
  CURSOR_AGENT_BIN,
  S1B_MODEL,
  S1B_PROVIDER,
} from "./policy.mjs";

/**
 * @param {{
 *   assessment: object,
 *   issueNumber: number,
 *   fingerprint: string,
 *   occurrence: string,
 *   worktreePath: string,
 * }} ctx
 */
export function buildRepairPrompt(ctx) {
  const a = ctx.assessment || {};
  return [
    "You are Steward S1B repair implementer.",
    "Implement ONE bounded repair in this worktree only.",
    `Issue: #${ctx.issueNumber}`,
    `Fingerprint: ${ctx.fingerprint}`,
    `Occurrence: ${ctx.occurrence}`,
    `Summary: ${a.summary || ""}`,
    `Root cause: ${a.rootCause || ""}`,
    `Recommended solution: ${a.recommendedSolution || ""}`,
    `Files: ${JSON.stringify(a.files || [])}`,
    "Constraints:",
    "- Mutate only files needed for the repair.",
    "- Do not merge, deploy, touch Host P, or expand secrets.",
    "- Do not push; the orchestrator pushes via Automation App.",
    "When done, print a single fenced ```json object with fields:",
    '["summary","changedFiles","testsToRun","notes"]',
  ].join("\n");
}

/**
 * @param {{
 *   assessment: object,
 *   issueNumber: number,
 *   fingerprint: string,
 *   occurrence: string,
 *   worktreePath: string,
 *   spawnFn?: typeof spawn,
 *   cursorBin?: string,
 *   model?: string,
 *   provider?: string,
 *   apiKey?: string|null,
 *   timeoutMs?: number,
 *   skipModelProbe?: boolean,
 *   engine?: (input: object) => Promise<object>|object,
 * }} input
 */
export async function runCursorRepairEngine(input) {
  const pins = assertS1bPins({
    provider: input.provider,
    model: input.model,
  });
  const worktreePath = input.worktreePath;
  if (!worktreePath) throw new Error("runCursorRepairEngine: worktreePath required");

  const childEnv = cursorChildEnv({
    apiKey:
      input.apiKey ??
      process.env.S1B_CURSOR_API_KEY ??
      process.env.S1A_CURSOR_API_KEY ??
      process.env.CURSOR_API_KEY ??
      process.env.CURSOR_AGENT_API_KEY ??
      "",
  });
  assertNoCredentialLeak(childEnv, { allowCursorKey: true });

  if (typeof input.engine === "function") {
    const result = await input.engine({
      ...input,
      configuredProvider: pins.provider,
      configuredModel: pins.model,
      childEnv,
      childEnvKeys: Object.keys(childEnv).sort(),
    });
    return {
      ...result,
      configuredProvider: pins.provider,
      configuredModel: pins.model,
      actualProvider: pins.provider,
      actualModel: pins.model,
      childEnvKeys: Object.keys(childEnv).sort(),
    };
  }

  const bin = input.cursorBin || process.env.S1B_CURSOR_AGENT_BIN || CURSOR_AGENT_BIN;
  const spawnFn = input.spawnFn || spawn;

  if (!input.skipModelProbe) {
    await assertModelAvailable(bin, pins.model, spawnFn, childEnv);
  }

  const prompt = buildRepairPrompt(input);
  // Default agent mode (--print, no --mode ask/plan) is write-capable.
  // Sandbox stays enabled (write-enabled sandbox per S1B plan).
  const args = [
    "--print",
    "--trust",
    "--force",
    "--sandbox",
    "enabled",
    "--model",
    pins.model,
    "--workspace",
    worktreePath,
  ];

  const assessmentDir = join(worktreePath, ".s1b");
  if (!existsSync(assessmentDir)) mkdirSync(assessmentDir, { recursive: true });
  writeFileSync(
    join(assessmentDir, "assessment.json"),
    JSON.stringify(input.assessment || {}, null, 2),
  );

  const timeoutMs = input.timeoutMs || 15 * 60 * 1000;
  const stdout = await new Promise((resolve, reject) => {
    /** @type {import("node:child_process").ChildProcessWithoutNullStreams} */
    let child;
    try {
      child = /** @type {any} */ (
        spawnFn(bin, args.concat([prompt]), {
          env: childEnv,
          stdio: ["ignore", "pipe", "pipe"],
          cwd: worktreePath,
        })
      );
    } catch (err) {
      reject(new Error(`S1B cursor repair spawn failed: ${err.message}`));
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new Error(`S1B cursor repair timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      out += String(d);
    });
    child.stderr?.on("data", (d) => {
      err += String(d);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`S1B cursor repair error: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `S1B cursor repair exit ${code}: ${(err || out).slice(0, 600)}`,
          ),
        );
        return;
      }
      resolve(out);
    });
  });

  const parsed = parseLastJsonObject(stdout) || {
    summary: "repair completed (unstructured stdout)",
    changedFiles: [],
    testsToRun: [],
    notes: stdout.slice(0, 2000),
  };

  return {
    summary: String(parsed.summary || ""),
    changedFiles: Array.isArray(parsed.changedFiles)
      ? parsed.changedFiles.map(String)
      : [],
    testsToRun: Array.isArray(parsed.testsToRun)
      ? parsed.testsToRun.map(String)
      : [],
    notes: String(parsed.notes || ""),
    configuredProvider: pins.provider,
    configuredModel: pins.model,
    actualProvider: S1B_PROVIDER,
    actualModel: S1B_MODEL,
    cursorBinary: bin,
    spawnArgs: args,
    childEnvKeys: Object.keys(childEnv).sort(),
    stdout: stdout.slice(0, 4000),
  };
}
