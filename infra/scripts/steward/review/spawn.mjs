#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Fresh cursor-agent ask-mode invocation per role (isolated sessionId).
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

  if (typeof input.engine === "function") {
    const parsed = await input.engine({
      role: input.role,
      system: input.system,
      user: input.user,
      sessionId,
      model,
    });
    return {
      parsed,
      sessionId,
      requestId: String(parsed?.requestId || `${input.role}-${sessionId}`),
      configuredProvider: REVIEW_PROVIDER,
      configuredModel: REVIEW_MODEL,
      actualProvider: REVIEW_PROVIDER,
      actualModel: REVIEW_MODEL,
      elapsedMs: Date.now() - started,
      stdout: "",
    };
  }

  const bin = input.cursorBin || process.env.STEWARD_CURSOR_AGENT_BIN || CURSOR_AGENT_BIN;
  const prompt = [
    input.system,
    "",
    "Return ONLY one fenced ```json object matching the required schema.",
    "",
    input.user,
  ].join("\n");

  const args = [
    "--mode",
    "ask",
    "--print",
    "--trust",
    "--sandbox",
    "enabled",
    "--model",
    model,
    prompt,
  ];

  const spawnFn = input.spawnFn || spawn;
  const timeoutMs = input.timeoutMs || 600_000;
  const stdout = await new Promise((resolve, reject) => {
    let child;
    try {
      child = /** @type {any} */ (
        spawnFn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] })
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
  });

  const parsed = parseLastJsonObject(stdout);
  if (!parsed) {
    throw new Error(`cursor review malformed JSON (${input.role})`);
  }

  return {
    parsed,
    sessionId,
    requestId: String(parsed.requestId || `${input.role}-${sessionId}`),
    configuredProvider: REVIEW_PROVIDER,
    configuredModel: REVIEW_MODEL,
    actualProvider: REVIEW_PROVIDER,
    actualModel: REVIEW_MODEL,
    elapsedMs: Date.now() - started,
    stdout,
  };
}
