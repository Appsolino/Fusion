#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamAiVerifier 2026-08-07-04:25:
 * Independent AI verification of expert upstream repairs.
 * Separate model invocation with reviewer system prompt. Does not receive the
 * resolver's unsupported conclusions as facts — only problem, diff, tests, patches.
 * Prefer a distinct model when configured via UPSTREAM_VERIFIER_MODEL; otherwise
 * same provider with independent invocation (still fail-closed).
 *
 * FNXC:UpstreamAiProtocol 2026-08-07-08:45:
 * Structured verifier output must be production-robust: JSON-only contract →
 * bounded extraction → schema-repair retry → fresh independent invocation →
 * optional secondary model → fail closed as AI_PROTOCOL_ERROR (never ENGINEERING_UNRESOLVED).
 * Max 3 verifier attempts per candidate revision. Never turn prose into APPROVE.
 * Never silently substitute models without recording actualModel evidence.
 */
import { spawn } from "node:child_process";
import { validateVerifierVerdict, VERIFIER_VERDICT_SCHEMA_VERSION } from "./expert-decision-schema.mjs";
import { assertModelAvailable } from "../steward/s1a/cursor-engine.mjs";
import { cursorChildEnv, assertNoCredentialLeak } from "../steward/s1a/spawn-env.mjs";
import { CURSOR_AGENT_BIN, S1B_PROVIDER } from "../steward/s1b/policy.mjs";
import {
  parseAndValidateStructured,
  classifyAiFailure,
  nextFromAiFailureClass,
} from "./structured-json.mjs";

export const VERIFIER_PROVIDER = S1B_PROVIDER;
/*
FNXC:UpstreamAiVerifier 2026-08-07-04:40:
Prefer an independent model family from the resolver (composer-2.5). Opus 5 is
ZDR-covered; Fable variants are NO ZDR and must not be used for this mission.
Override with UPSTREAM_VERIFIER_MODEL when needed. Fail closed if unavailable.
*/
export const VERIFIER_MODEL_PREFERRED = "claude-opus-5-thinking-high";
export const VERIFIER_MODEL_DEFAULT = process.env.UPSTREAM_VERIFIER_MODEL || VERIFIER_MODEL_PREFERRED;
/** Secondary production verifier when configured (optional). Recorded when used. */
export const VERIFIER_MODEL_SECONDARY = process.env.UPSTREAM_VERIFIER_MODEL_SECONDARY || "";
/** Bounded verifier attempts per candidate revision (normal → repair → fresh [→ secondary]). */
export const DEFAULT_MAX_VERIFIER_ATTEMPTS = 3;

/**
 * @param {{
 *   originalProblem: string,
 *   upstreamIntent?: string,
 *   diffText: string,
 *   patchRegistryChanges?: object[],
 *   deterministicTestResults?: object,
 *   migrationInfo?: string|null,
 *   riskClass?: string,
 *   candidateSha?: string|null,
 *   upstreamSha?: string|null,
 *   baseAppsolinoSha?: string|null,
 * }} evidence
 * @param {{ mode?: "normal"|"schema-repair"|"fresh", priorError?: string|null }} [opts]
 */
export function buildVerifierPrompt(evidence, opts = {}) {
  const mode = opts.mode || "normal";
  const shaBlock = {
    candidateSha: evidence.candidateSha || null,
    upstreamSha: evidence.upstreamSha || null,
    baseAppsolinoSha: evidence.baseAppsolinoSha || null,
  };
  const schemaHint = [
    "Return ONLY a single JSON object (optionally in one ```json fence). No prose before or after.",
    `schemaVersion: ${VERIFIER_VERDICT_SCHEMA_VERSION}`,
    "Required fields:",
    '  verdict: APPROVE | REQUEST_CHANGES | BLOCK_POLICY',
    "  summary: non-empty string",
    "  findings: string[] (alias blockingFindings)",
    "  requiredChanges: string[] (non-empty when REQUEST_CHANGES)",
    "  candidateSha, upstreamSha, baseAppsolinoSha: exact SHAs of the candidate under review",
    "  deterministicEvidenceAccepted: boolean",
    "  remainingRisks: string[]",
    "  requiresPolicyDecision: boolean (must be false for APPROVE)",
  ].join("\n");

  if (mode === "schema-repair") {
    return [
      "SCHEMA REPAIR — previous verifier output failed structured validation.",
      `Prior error: ${opts.priorError || "malformed"}`,
      "Re-emit ONLY a schema-valid JSON object. Do not invent facts. Do not APPROVE unless warranted.",
      "",
      "Candidate SHA binding (must match exactly):",
      JSON.stringify(shaBlock, null, 2),
      "",
      schemaHint,
    ].join("\n");
  }

  const preamble =
    mode === "fresh"
      ? [
          "Independent fresh verifier invocation (prior attempt discarded).",
          "Judge the package below only. Do not assume any prior verdict.",
          "",
        ]
      : [];

  return [
    ...preamble,
    "You are an independent Appsolino upstream AI verifier.",
    "Challenge the proposed repair. Do not rubber-stamp.",
    "You do not know whether the resolver claimed success — judge the diff and tests.",
    "Host P is prohibited. Do not approve secret expansion or production activation.",
    "",
    "Review package:",
    JSON.stringify(
      {
        originalProblem: evidence.originalProblem,
        upstreamIntent: evidence.upstreamIntent || null,
        riskClass: evidence.riskClass || "SENSITIVE",
        patchRegistryChanges: evidence.patchRegistryChanges || [],
        deterministicTestResults: evidence.deterministicTestResults || null,
        migrationInfo: evidence.migrationInfo || null,
        ...shaBlock,
        diffText: String(evidence.diffText || "").slice(0, 120_000),
      },
      null,
      2,
    ),
    "",
    schemaHint,
  ].join("\n");
}

/**
 * Single verifier invocation (parse + validate). Used by the bounded retry wrapper.
 * @param {Parameters<typeof runUpstreamAiVerifier>[0] & {
 *   promptMode?: "normal"|"schema-repair"|"fresh",
 *   priorError?: string|null,
 *   modelOverride?: string,
 * }} input
 */
export async function invokeVerifierOnce(input) {
  const model = input.modelOverride || input.model || VERIFIER_MODEL_DEFAULT;
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
  const shaOpts = {
    expectedCandidateSha: input.evidence?.candidateSha || input.expectedCandidateSha || null,
    expectedUpstreamSha: input.evidence?.upstreamSha || input.expectedUpstreamSha || null,
    expectedBaseAppsolinoSha: input.evidence?.baseAppsolinoSha || input.expectedBaseAppsolinoSha || null,
    requireShaBinding: Boolean(
      input.requireShaBinding ??
        (input.evidence?.candidateSha || input.expectedCandidateSha),
    ),
  };

  if (typeof input.engine === "function") {
    const engineered = await input.engine({ ...input, childEnv, promptMode: input.promptMode });
    if (engineered?.__providerError) {
      const reason = String(engineered.reason || engineered.__providerError);
      return {
        ok: false,
        action: "AI_PROVIDER_ERROR",
        failureClass: "AI_PROVIDER_ERROR",
        reason,
        verdict: null,
        configuredProvider: VERIFIER_PROVIDER,
        configuredModel: model,
        actualProvider: null,
        actualModel: null,
        latencyMs: Date.now() - startedAt,
        role: "verifier",
        testInjection: true,
        attemptMeta: { mode: input.promptMode || "normal" },
      };
    }
    const raw = engineered?.verdict || engineered;
    // Allow engines to return raw stdout string for protocol tests.
    if (typeof engineered?.stdout === "string") {
      const parsed = parseAndValidateStructured(engineered.stdout, (r) => validateVerifierVerdict(r, shaOpts));
      return finalizeParsed(parsed, model, startedAt, {
        actualProvider: engineered?.actualProvider || VERIFIER_PROVIDER,
        actualModel: engineered?.actualModel || model,
        testInjection: true,
        mode: input.promptMode || "normal",
      });
    }
    const validated = validateVerifierVerdict(raw, shaOpts);
    if (!validated.ok) {
      return {
        ok: false,
        action: "AI_PROTOCOL_ERROR",
        failureClass: "AI_PROTOCOL_ERROR",
        reason: `verifier schema validation failed: ${validated.errors.join("; ")}`,
        verdict: null,
        configuredProvider: VERIFIER_PROVIDER,
        configuredModel: model,
        actualProvider: engineered?.actualProvider || VERIFIER_PROVIDER,
        actualModel: engineered?.actualModel || model,
        latencyMs: Date.now() - startedAt,
        schemaVersion: VERIFIER_VERDICT_SCHEMA_VERSION,
        role: "verifier",
        testInjection: true,
        attemptMeta: { mode: input.promptMode || "normal" },
      };
    }
    return {
      ok: true,
      action: "VERIFIER_VERDICT",
      failureClass: null,
      reason: "injected-engine",
      verdict: validated.verdict,
      configuredProvider: VERIFIER_PROVIDER,
      configuredModel: model,
      actualProvider: engineered?.actualProvider || VERIFIER_PROVIDER,
      actualModel: engineered?.actualModel || model,
      latencyMs: Date.now() - startedAt,
      schemaVersion: VERIFIER_VERDICT_SCHEMA_VERSION,
      role: "verifier",
      testInjection: true,
      attemptMeta: { mode: input.promptMode || "normal" },
    };
  }

  const bin = input.cursorBin || process.env.CURSOR_AGENT_BIN || CURSOR_AGENT_BIN;
  if (input.skipModelProbe !== true) {
    try {
      await assertModelAvailable(bin, model, spawn, childEnv);
    } catch (error) {
      return {
        ok: false,
        action: "AI_PROVIDER_ERROR",
        failureClass: "AI_PROVIDER_ERROR",
        reason: `verifier model unavailable: ${error instanceof Error ? error.message : String(error)}`,
        configuredProvider: VERIFIER_PROVIDER,
        configuredModel: model,
        actualProvider: null,
        actualModel: null,
        latencyMs: Date.now() - startedAt,
        role: "verifier",
        attemptMeta: { mode: input.promptMode || "normal" },
      };
    }
  }

  const prompt = buildVerifierPrompt(input.evidence, {
    mode: input.promptMode || "normal",
    priorError: input.priorError || null,
  });
  const spawnFn = input.spawnFn || spawn;
  const cwd = input.worktreePath || process.cwd();

  const stdout = await new Promise((resolve, reject) => {
    const child = spawnFn(bin, ["--print", "--force", "--mode", "ask", "--model", model, prompt], {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`verifier timed out after ${input.timeoutMs || 600000}ms`));
    }, input.timeoutMs || 600000);
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
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
    const msg = stdout.__error.message || String(stdout.__error);
    const failureClass = /timed out/i.test(msg) ? "AI_PROVIDER_ERROR" : classifyAiFailure({ reason: msg });
    return {
      ok: false,
      action: nextFromAiFailureClass(failureClass),
      failureClass,
      reason: `verifier invocation failed: ${msg}`,
      configuredProvider: VERIFIER_PROVIDER,
      configuredModel: model,
      actualProvider: null,
      actualModel: null,
      latencyMs: Date.now() - startedAt,
      role: "verifier",
      attemptMeta: { mode: input.promptMode || "normal" },
    };
  }

  const parsed = parseAndValidateStructured(String(stdout), (r) => validateVerifierVerdict(r, shaOpts));
  return finalizeParsed(parsed, model, startedAt, {
    actualProvider: VERIFIER_PROVIDER,
    actualModel: model,
    mode: input.promptMode || "normal",
  });
}

/**
 * @param {ReturnType<typeof parseAndValidateStructured>} parsed
 * @param {string} model
 * @param {number} startedAt
 * @param {{ actualProvider: string|null, actualModel: string|null, testInjection?: boolean, mode: string }} meta
 */
function finalizeParsed(parsed, model, startedAt, meta) {
  if (!parsed.ok) {
    return {
      ok: false,
      action: "AI_PROTOCOL_ERROR",
      failureClass: "AI_PROTOCOL_ERROR",
      reason: `malformed verifier output (${parsed.error}) — fail closed`,
      verdict: null,
      configuredProvider: VERIFIER_PROVIDER,
      configuredModel: model,
      actualProvider: meta.actualProvider,
      actualModel: meta.actualModel,
      latencyMs: Date.now() - startedAt,
      schemaVersion: VERIFIER_VERDICT_SCHEMA_VERSION,
      role: "verifier",
      parseMethod: parsed.method,
      testInjection: meta.testInjection || false,
      attemptMeta: { mode: meta.mode },
    };
  }
  return {
    ok: true,
    action: "VERIFIER_VERDICT",
    failureClass: null,
    reason: "validated structured verifier verdict",
    verdict: parsed.validated,
    configuredProvider: VERIFIER_PROVIDER,
    configuredModel: model,
    actualProvider: meta.actualProvider,
    actualModel: meta.actualModel,
    latencyMs: Date.now() - startedAt,
    schemaVersion: VERIFIER_VERDICT_SCHEMA_VERSION,
    role: "verifier",
    parseMethod: parsed.method,
    testInjection: meta.testInjection || false,
    attemptMeta: { mode: meta.mode },
  };
}

/**
 * Bounded automatic recovery for malformed verifier output.
 *
 * attempt 1: normal
 * attempt 2: schema-repair instruction (same model)
 * attempt 3: fresh independent invocation; if UPSTREAM_VERIFIER_MODEL_SECONDARY set, use it
 *
 * @param {{
 *   evidence: Parameters<typeof buildVerifierPrompt>[0],
 *   worktreePath?: string,
 *   spawnFn?: typeof spawn,
 *   cursorBin?: string,
 *   model?: string,
 *   secondaryModel?: string,
 *   maxAttempts?: number,
 *   timeoutMs?: number,
 *   skipModelProbe?: boolean,
 *   engine?: (input: object) => Promise<object>|object,
 *   apiKey?: string|null,
 *   requireShaBinding?: boolean,
 *   expectedCandidateSha?: string|null,
 *   expectedUpstreamSha?: string|null,
 *   expectedBaseAppsolinoSha?: string|null,
 * }} input
 */
export async function runUpstreamAiVerifier(input) {
  const maxAttempts = Math.max(1, Number(input.maxAttempts ?? DEFAULT_MAX_VERIFIER_ATTEMPTS));
  const secondary =
    String(input.secondaryModel || VERIFIER_MODEL_SECONDARY || "").trim() || null;
  /** @type {object[]} */
  const attemptLog = [];
  let last = null;

  for (let i = 1; i <= maxAttempts; i++) {
    /** @type {"normal"|"schema-repair"|"fresh"} */
    let mode = "normal";
    if (i === 2) mode = "schema-repair";
    if (i >= 3) mode = "fresh";

    const modelOverride =
      i >= 3 && secondary ? secondary : input.model || VERIFIER_MODEL_DEFAULT;

    const result = await invokeVerifierOnce({
      ...input,
      promptMode: mode,
      priorError: last?.reason || null,
      modelOverride,
    });
    attemptLog.push({
      attempt: i,
      mode,
      ok: result.ok,
      failureClass: result.failureClass || null,
      reason: result.reason,
      configuredModel: result.configuredModel,
      actualModel: result.actualModel,
      parseMethod: result.parseMethod || null,
      latencyMs: result.latencyMs,
    });
    last = result;

    if (result.ok && result.verdict) {
      return {
        ...result,
        verifierAttempts: attemptLog,
        acceptedFromAttempt: i,
        acceptedModel: result.actualModel,
      };
    }

    // Provider errors: do not burn schema-repair on the same unavailable model unless secondary exists.
    if (result.failureClass === "AI_PROVIDER_ERROR") {
      if (i < maxAttempts && secondary && modelOverride !== secondary) {
        continue; // next iteration may use secondary on attempt 3
      }
      if (i >= maxAttempts || !secondary) {
        return {
          ...result,
          action: "AI_PROVIDER_ERROR",
          failureClass: "AI_PROVIDER_ERROR",
          verifierAttempts: attemptLog,
        };
      }
    }
    // Protocol errors continue through the budget.
  }

  return {
    ok: false,
    action: "AI_PROTOCOL_ERROR",
    failureClass: last?.failureClass || "AI_PROTOCOL_ERROR",
    reason:
      last?.reason ||
      `verifier retry budget exhausted after ${maxAttempts} attempts — fail closed`,
    verdict: null,
    configuredProvider: VERIFIER_PROVIDER,
    configuredModel: input.model || VERIFIER_MODEL_DEFAULT,
    actualProvider: last?.actualProvider ?? null,
    actualModel: last?.actualModel ?? null,
    latencyMs: attemptLog.reduce((s, a) => s + (a.latencyMs || 0), 0),
    schemaVersion: VERIFIER_VERDICT_SCHEMA_VERSION,
    role: "verifier",
    verifierAttempts: attemptLog,
    retryBudgetExhausted: true,
  };
}
