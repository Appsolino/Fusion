#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Sanitized cursor-agent models probe — fail closed on unavailable model.
 */
import { spawn } from "node:child_process";
import {
  CURSOR_AGENT_BIN,
  REVIEW_MODEL,
  REVIEW_PROVIDER,
  assertNoWriteCreds,
  reviewChildEnv,
} from "./policy.mjs";

/**
 * @param {{
 *   bin?: string,
 *   model?: string,
 *   apiKey?: string,
 *   sessionId: string,
 *   role: "reviewer"|"approver"|"probe",
 *   spawnFn?: typeof spawn,
 *   timeoutMs?: number,
 * }} opts
 */
export async function probeCursorModel(opts) {
  const model = opts.model || REVIEW_MODEL;
  const bin = opts.bin || process.env.STEWARD_CURSOR_AGENT_BIN || CURSOR_AGENT_BIN;
  const env = reviewChildEnv({
    role: opts.role === "probe" ? "reviewer" : opts.role,
    sessionId: opts.sessionId,
    apiKey: opts.apiKey,
  });
  assertNoWriteCreds(env);
  // Probe must never carry write tokens (already stripped); also refuse GH_* leftovers.
  if (env.GITHUB_TOKEN || env.GH_TOKEN) {
    throw new Error("model probe env leaks GitHub token");
  }

  const spawnFn = opts.spawnFn || spawn;
  const timeoutMs = opts.timeoutMs || 30_000;
  const listOut = await new Promise((resolve, reject) => {
    let child;
    try {
      child = /** @type {any} */ (
        spawnFn(bin, ["models"], { env, stdio: ["ignore", "pipe", "pipe"] })
      );
    } catch (err) {
      reject(
        new Error(
          `cursor models probe spawn failed: ${err instanceof Error ? err.message : String(err)}`,
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
      reject(new Error("cursor models probe timeout"));
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      out += String(d);
    });
    child.stderr?.on("data", (d) => {
      err += String(d);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`cursor models probe error: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`cursor models probe exit ${code}: ${(err || out).slice(0, 400)}`));
        return;
      }
      resolve(out);
    });
  });

  const lines = String(listOut)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const hit = lines.find(
    (l) => l === model || l.startsWith(`${model} `) || l.startsWith(`${model} -`),
  );
  if (!hit) {
    throw new Error(
      `Requested model unavailable: ${model} (cursor-agent models did not list it)`,
    );
  }
  // Fingerprint + actualModel from listed line (execution evidence), not static overwrite.
  const listedModelId = hit.split(/\s+/)[0] || "";
  if (!listedModelId || listedModelId !== model) {
    throw new Error(`model drift: configured ${model} listed as ${listedModelId || "(empty)"}`);
  }
  return {
    configuredProvider: REVIEW_PROVIDER,
    configuredModel: model,
    actualProvider: REVIEW_PROVIDER,
    actualModel: listedModelId,
    modelFingerprint: hit,
    listedLine: hit,
    probeStdoutSha16: Buffer.from(String(listOut)).toString("base64").slice(0, 24),
    sanitizedEnvKeys: Object.keys(env).sort(),
  };
}
