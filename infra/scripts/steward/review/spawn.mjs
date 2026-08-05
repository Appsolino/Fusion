#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Fresh cursor-agent ask-mode invocation per role (isolated sessionId).
 * Always probes models with sanitized env; actual model comes from probe evidence.
 * Full evidence is written to a temp workspace file; stdin carries a short read
 * instruction so mega upstream diffs neither hit ARG_MAX nor overwhelm the reply.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CURSOR_AGENT_BIN,
  REVIEW_MODEL,
  REVIEW_PROVIDER,
  assertNoWriteCreds,
  reviewChildEnv,
} from "./policy.mjs";
import { parseLastJsonObject } from "./verdict.mjs";
import { probeCursorModel } from "./model-probe.mjs";

/**
 * @param {{
 *   role: "reviewer"|"approver",
 *   system: string,
 *   user: string,
 *   sessionId?: string,
 *   apiKey?: string,
 *   cursorBin?: string,
 *   model?: string,
 *   spawnFn?: typeof spawn,
 *   timeoutMs?: number,
 *   skipModelProbe?: boolean,
 *   modelProbe?: object,
 *   engine?: (input: object) => Promise<object>|object,
 * }} input
 */
export async function invokeCursorReviewRole(input) {
  const sessionId = input.sessionId || randomUUID();
  const model = input.model || REVIEW_MODEL;
  if (model !== REVIEW_MODEL) {
    throw new Error(
      `model drift forbidden: configured ${REVIEW_MODEL} got ${model}`,
    );
  }
  const env = reviewChildEnv({
    role: input.role,
    sessionId,
    apiKey: input.apiKey,
  });
  assertNoWriteCreds(env);

  const started = Date.now();
  const bin = input.cursorBin || process.env.STEWARD_CURSOR_AGENT_BIN || CURSOR_AGENT_BIN;
  const spawnFn = input.spawnFn || spawn;

  let modelEvidence = input.modelProbe || null;
  if (!modelEvidence && !input.skipModelProbe) {
    modelEvidence = await probeCursorModel({
      bin,
      model,
      apiKey: input.apiKey,
      sessionId: `${sessionId}-probe`,
      role: input.role,
      spawnFn,
    });
  }
  if (!modelEvidence) {
    throw new Error("model evidence missing (fail closed)");
  }
  if (modelEvidence.actualModel !== REVIEW_MODEL) {
    throw new Error(
      `actual model drift: expected ${REVIEW_MODEL} got ${modelEvidence.actualModel}`,
    );
  }

  if (typeof input.engine === "function") {
    const parsed = await input.engine({
      role: input.role,
      system: input.system,
      user: input.user,
      sessionId,
      model,
      modelEvidence,
      envKeys: Object.keys(env).sort(),
      spawnArgsPreview: ["--mode", "ask", "--model", model],
    });
    return {
      parsed,
      sessionId,
      requestId: String(parsed?.requestId || `${input.role}-${sessionId}`),
      configuredProvider: REVIEW_PROVIDER,
      configuredModel: REVIEW_MODEL,
      actualProvider: modelEvidence.actualProvider,
      actualModel: modelEvidence.actualModel,
      modelFingerprint: modelEvidence.modelFingerprint,
      modelEvidence,
      elapsedMs: Date.now() - started,
      stdout: "",
      childEnvKeys: Object.keys(env).sort(),
    };
  }

  const evidenceDir = mkdtempSync(join(tmpdir(), `steward-review-${input.role}-`));
  const evidencePath = join(evidenceDir, "evidence.json");
  const fullPrompt = [
    input.system,
    "",
    "Return ONLY one fenced ```json object matching the required schema.",
    "Your JSON must set actualProvider/actualModel to the model you are running.",
    "",
    input.user,
  ].join("\n");
  writeFileSync(evidencePath, fullPrompt, "utf8");
  const prompt = [
    `Read the COMPLETE review instructions and evidence from this file (UTF-8): ${evidencePath}`,
    "The file contains the system rules and the full JSON evidence including diffText.",
    "You MUST examine diffText and requiredCheckResults from that file before deciding.",
    "Return ONLY one fenced ```json object matching the required schema.",
    "Your JSON must set actualProvider/actualModel to the model you are running.",
  ].join("\n");

  const args = [
    "--mode",
    "ask",
    "--print",
    "--trust",
    "--sandbox",
    "enabled",
    "--workspace",
    evidenceDir,
    "--model",
    model,
  ];

  const promptBytesEst = Buffer.byteLength(String(input.user || ""), "utf8");
  const evidenceBytesEst = Buffer.byteLength(fullPrompt, "utf8");
  // Mega upstream absorbs (multi-MB evidence.json) need far longer than 10–30m for
  // Cursor ask-mode to read diffText and emit a structured verdict.
  const mega = promptBytesEst > 500_000 || evidenceBytesEst > 500_000;
  const timeoutMs =
    input.timeoutMs ||
    (mega ? 5_400_000 : 600_000);

  let stdout;
  try {
    stdout = await new Promise((resolve, reject) => {
      let child;
      try {
        child = /** @type {any} */ (
          spawnFn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"] })
        );
      } catch (err) {
        reject(
          new Error(
            `cursor review spawn failed (${input.role}): ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
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
        reject(new Error(`cursor review timeout (${input.role})`));
      }, timeoutMs);
      child.stdout?.on("data", (d) => {
        out += String(d);
      });
      child.stderr?.on("data", (d) => {
        err += String(d);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`cursor review error (${input.role}): ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new Error(
              `cursor review exit ${code} (${input.role}): ${(err || out).slice(0, 400)}`,
            ),
          );
          return;
        }
        resolve(out);
      });
      try {
        child.stdin?.write(prompt);
        child.stdin?.end();
      } catch (err) {
        clearTimeout(timer);
        reject(
          new Error(
            `cursor review stdin write failed (${input.role}): ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });
  } finally {
    try {
      rmSync(evidenceDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  const parsed = parseLastJsonObject(stdout);
  if (!parsed) {
    throw new Error(
      `cursor review malformed JSON (${input.role}): stdoutHead=${JSON.stringify(String(stdout).slice(0, 500))}`,
    );
  }

  const reported =
    parsed.actualModel || parsed.model || modelEvidence.actualModel;
  if (reported !== REVIEW_MODEL) {
    throw new Error(
      `execution model mismatch: probe/configured ${REVIEW_MODEL} reported ${reported}`,
    );
  }

  return {
    parsed,
    sessionId,
    requestId: String(parsed.requestId || `${input.role}-${sessionId}`),
    configuredProvider: REVIEW_PROVIDER,
    configuredModel: REVIEW_MODEL,
    actualProvider: modelEvidence.actualProvider,
    actualModel: reported,
    modelFingerprint: modelEvidence.modelFingerprint,
    modelEvidence,
    elapsedMs: Date.now() - started,
    stdout,
    childEnvKeys: Object.keys(env).sort(),
    spawnArgs: args,
    promptDelivery: "evidence-file+stdin",
    promptBytes: Buffer.byteLength(fullPrompt, "utf8"),
    evidencePath,
  };
}
