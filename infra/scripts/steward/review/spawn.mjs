#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Fresh cursor-agent ask-mode invocation per role (isolated sessionId).
 * Always probes models with sanitized env; actual model comes from probe evidence.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
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

  const prompt = [
    input.system,
    "",
    "Return ONLY one fenced ```json object matching the required schema.",
    "Your JSON must set actualProvider/actualModel to the model you are running.",
    "",
    input.user,
  ].join("\n");

  // Full evidence (including multi-MB upstream diffs) must reach Cursor without
  // argv/E2BIG. cursor-agent reads the initial prompt from stdin when argv omits it.
  const args = [
    "--mode",
    "ask",
    "--print",
    "--trust",
    "--sandbox",
    "enabled",
    "--model",
    model,
  ];

  const timeoutMs = input.timeoutMs || 600_000;
  const stdout = await new Promise((resolve, reject) => {
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

  const parsed = parseLastJsonObject(stdout);
  if (!parsed) {
    throw new Error(`cursor review malformed JSON (${input.role})`);
  }

  // Prefer provider-reported model when present; still fail closed on mismatch vs probe.
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
    promptDelivery: "stdin",
    promptBytes: Buffer.byteLength(prompt, "utf8"),
  };
}
