#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamAiVerifier 2026-08-07-04:25:
 * Independent AI verification of expert upstream repairs.
 * Separate model invocation with reviewer system prompt. Does not receive the
 * resolver's unsupported conclusions as facts — only problem, diff, tests, patches.
 * Prefer a distinct model when configured via UPSTREAM_VERIFIER_MODEL; otherwise
 * same provider with independent invocation (still fail-closed).
 */
import { spawn } from "node:child_process";
import { validateVerifierVerdict, VERIFIER_VERDICT_SCHEMA_VERSION } from "./expert-decision-schema.mjs";
import { assertModelAvailable } from "../steward/s1a/cursor-engine.mjs";
import { cursorChildEnv, assertNoCredentialLeak } from "../steward/s1a/spawn-env.mjs";
import { CURSOR_AGENT_BIN, S1B_MODEL, S1B_PROVIDER } from "../steward/s1b/policy.mjs";
import { parseExpertStdout } from "./expert-resolver.mjs";

export const VERIFIER_PROVIDER = S1B_PROVIDER;
export const VERIFIER_MODEL_DEFAULT = process.env.UPSTREAM_VERIFIER_MODEL || S1B_MODEL;

/**
 * @param {{
 *   originalProblem: string,
 *   upstreamIntent?: string,
 *   diffText: string,
 *   patchRegistryChanges?: object[],
 *   deterministicTestResults?: object,
 *   migrationInfo?: string|null,
 *   riskClass?: string,
 * }} evidence
 */
export function buildVerifierPrompt(evidence) {
  return [
    "You are an independent Appsolino upstream AI verifier.",
    "Challenge the proposed repair. Do not rubber-stamp.",
    "You do not know whether the resolver claimed success — judge the diff and tests.",
    "Host P is prohibited. Do not approve secret expansion or production activation.",
    "",
    "Review package:",
    JSON.stringify({
      originalProblem: evidence.originalProblem,
      upstreamIntent: evidence.upstreamIntent || null,
      riskClass: evidence.riskClass || "SENSITIVE",
      patchRegistryChanges: evidence.patchRegistryChanges || [],
      deterministicTestResults: evidence.deterministicTestResults || null,
      migrationInfo: evidence.migrationInfo || null,
      diffText: String(evidence.diffText || "").slice(0, 120_000),
    }, null, 2),
    "",
    "Return ONE fenced ```json object with schemaVersion",
    String(VERIFIER_VERDICT_SCHEMA_VERSION),
    'fields: verdict (APPROVE|REQUEST_CHANGES|BLOCK_POLICY), summary, blockingFindings, requiredChanges, risk',
  ].join("\n");
}

/**
 * @param {{
 *   evidence: Parameters<typeof buildVerifierPrompt>[0],
 *   worktreePath?: string,
 *   spawnFn?: typeof spawn,
 *   cursorBin?: string,
 *   model?: string,
 *   timeoutMs?: number,
 *   skipModelProbe?: boolean,
 *   engine?: (input: object) => Promise<object>|object,
 *   apiKey?: string|null,
 * }} input
 */
export async function runUpstreamAiVerifier(input) {
  const model = input.model || VERIFIER_MODEL_DEFAULT;
  const childEnv = cursorChildEnv({
    apiKey:
      input.apiKey ??
      process.env.UPSTREAM_VERIFIER_CURSOR_API_KEY ??
      process.env.S1B_CURSOR_API_KEY ??
      process.env.CURSOR_API_KEY ??
      "",
  });
  assertNoCredentialLeak(childEnv, { allowCursorKey: true });
  const startedAt = Date.now();

  if (typeof input.engine === "function") {
    const engineered = await input.engine({ ...input, childEnv });
    const validated = validateVerifierVerdict(engineered?.verdict || engineered);
    return {
      ok: validated.ok,
      action: validated.ok ? "VERIFIER_VERDICT" : "BLOCKED_UNRESOLVED",
      reason: validated.ok ? "injected-engine" : validated.errors.join("; "),
      verdict: validated.verdict,
      configuredProvider: VERIFIER_PROVIDER,
      configuredModel: model,
      actualProvider: engineered?.actualProvider || VERIFIER_PROVIDER,
      actualModel: engineered?.actualModel || model,
      latencyMs: Date.now() - startedAt,
      schemaVersion: VERIFIER_VERDICT_SCHEMA_VERSION,
      role: "verifier",
      testInjection: true,
    };
  }

  const bin = input.cursorBin || process.env.CURSOR_AGENT_BIN || CURSOR_AGENT_BIN;
  if (input.skipModelProbe !== true) {
    try {
      await assertModelAvailable(bin, model, spawn, childEnv);
    } catch (error) {
      return {
        ok: false,
        action: "BLOCKED_UNRESOLVED",
        reason: `verifier model unavailable: ${error instanceof Error ? error.message : String(error)}`,
        configuredProvider: VERIFIER_PROVIDER,
        configuredModel: model,
        actualProvider: null,
        actualModel: null,
        latencyMs: Date.now() - startedAt,
        role: "verifier",
      };
    }
  }

  const prompt = buildVerifierPrompt(input.evidence);
  const spawnFn = input.spawnFn || spawn;
  const cwd = input.worktreePath || process.cwd();

  const stdout = await new Promise((resolve, reject) => {
    const child = spawnFn(bin, ["--print", "--force", "--mode", "ask", "--model", model, prompt], {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`verifier timed out after ${input.timeoutMs || 600000}ms`));
    }, input.timeoutMs || 600000);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`cursor-agent exit ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
  }).catch((error) => ({ __error: error }));

  if (stdout && typeof stdout === "object" && stdout.__error) {
    return {
      ok: false,
      action: "BLOCKED_UNRESOLVED",
      reason: `verifier invocation failed: ${stdout.__error.message || String(stdout.__error)}`,
      configuredProvider: VERIFIER_PROVIDER,
      configuredModel: model,
      actualProvider: null,
      actualModel: null,
      latencyMs: Date.now() - startedAt,
      role: "verifier",
    };
  }

  const parsed = parseExpertStdout(String(stdout));
  if (!parsed.ok) {
    return {
      ok: false,
      action: "BLOCKED_UNRESOLVED",
      reason: `malformed verifier output (${parsed.error}) — fail closed`,
      configuredProvider: VERIFIER_PROVIDER,
      configuredModel: model,
      actualProvider: VERIFIER_PROVIDER,
      actualModel: model,
      latencyMs: Date.now() - startedAt,
      role: "verifier",
    };
  }
  const validated = validateVerifierVerdict(parsed.raw);
  if (!validated.ok) {
    return {
      ok: false,
      action: "BLOCKED_UNRESOLVED",
      reason: `verifier schema validation failed: ${validated.errors.join("; ")}`,
      configuredProvider: VERIFIER_PROVIDER,
      configuredModel: model,
      actualProvider: VERIFIER_PROVIDER,
      actualModel: model,
      latencyMs: Date.now() - startedAt,
      role: "verifier",
    };
  }

  return {
    ok: true,
    action: "VERIFIER_VERDICT",
    reason: "validated structured verifier verdict",
    verdict: validated.verdict,
    configuredProvider: VERIFIER_PROVIDER,
    configuredModel: model,
    actualProvider: VERIFIER_PROVIDER,
    actualModel: model,
    latencyMs: Date.now() - startedAt,
    schemaVersion: VERIFIER_VERDICT_SCHEMA_VERSION,
    role: "verifier",
  };
}
