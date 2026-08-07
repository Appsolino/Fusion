#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamExpertResolver 2026-08-07-04:25:
 * Real AI expert resolver for upstream absorption engineering problems.
 * Reuses Steward S1B Cursor repair plumbing (composer-2.5) with structured
 * expert-decision schema validation. Mocks are unit-test only — live path
 * requires actual cursor-cli and fails closed when unavailable.
 * Independent verifier is a separate invocation (ai-verifier.mjs).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateExpertDecision, EXPERT_DECISION_SCHEMA_VERSION } from "./expert-decision-schema.mjs";
import { assertModelAvailable } from "../steward/s1a/cursor-engine.mjs";
import { cursorChildEnv, assertNoCredentialLeak } from "../steward/s1a/spawn-env.mjs";
import { CURSOR_AGENT_BIN, S1B_MODEL, S1B_PROVIDER } from "../steward/s1b/policy.mjs";
import { parseStructuredJson, classifyAiFailure, nextFromAiFailureClass } from "./structured-json.mjs";
import { spawnCursorWithTimeout, DEFAULT_CURSOR_TIMEOUT_MS } from "./cursor-spawn-timeout.mjs";

export const EXPERT_PROVIDER = S1B_PROVIDER;
export const EXPERT_MODEL = S1B_MODEL;

/**
 * @param {{
 *   upstreamHead: string,
 *   appsolinoBaseSha: string,
 *   mergeBase?: string|null,
 *   candidateUpstreamSha: string,
 *   conflictedFiles?: string[],
 *   changedFiles?: string[],
 *   failingTests?: string[],
 *   patchMetadata?: object[],
 *   previousAttempts?: object[],
 *   requiredChanges?: string[],
 *   targetedRepairInstructions?: string|null,
 *   architectureConstraints?: string[],
 * }} evidence
 */
export function buildExpertEvidencePrompt(evidence) {
  /*
  FNXC:UpstreamLatency 2026-08-07-14:10:
  Prefer targeted REQUEST_CHANGES instructions over unbounded previousAttempts dumps.
  Expert is for a known problem — not open-ended exploration.
  */
  const targeted =
    evidence.targetedRepairInstructions ||
    (Array.isArray(evidence.requiredChanges) && evidence.requiredChanges.length
      ? [
          "TARGETED REPAIR — fix ONLY these unresolved reviewer requirements:",
          ...evidence.requiredChanges.map((c, i) => `${i + 1}. ${c}`),
          "Do not re-investigate already accepted areas.",
        ].join("\n")
      : "");
  const prior = Array.isArray(evidence.previousAttempts)
    ? evidence.previousAttempts.slice(-3).map((a) => ({
        attempt: a.attempt,
        phase: a.phase,
        next: a.next || null,
        verifierVerdict: a.verifierVerdict || null,
        requiredChanges: (a.requiredChanges || []).slice(0, 12),
        reason: a.reason ? String(a.reason).slice(0, 240) : null,
      }))
    : [];
  return [
    "You are the Appsolino upstream AI expert resolver.",
    "Resolve the engineering problem on this sandboxed candidate worktree.",
    "Do not merge, deploy, touch Host P, or expand secrets.",
    "Do not ask the owner for routine technical decisions.",
    "Determine semantic intent of both upstream and Appsolino — do not blindly prefer either side.",
    "",
    targeted ? targeted + "\n" : "",
    "Evidence package (bounded; no secrets):",
    JSON.stringify({
      upstreamHead: evidence.upstreamHead,
      appsolinoBaseSha: evidence.appsolinoBaseSha,
      mergeBase: evidence.mergeBase || null,
      candidateUpstreamSha: evidence.candidateUpstreamSha,
      conflictedFiles: evidence.conflictedFiles || [],
      changedFiles: (evidence.changedFiles || []).slice(0, 80),
      failingTests: evidence.failingTests || [],
      patchMetadata: evidence.patchMetadata || [],
      requiredChanges: (evidence.requiredChanges || []).slice(0, 40),
      previousAttempts: prior,
      architectureConstraints: evidence.architectureConstraints || [
        "Host P prohibited",
        "enginePaused Host D posture must remain honest",
        "Appsolino patches stay independent when still required",
      ],
    }, null, 2),
    "",
    "When finished, print ONE fenced ```json object matching schemaVersion",
    String(EXPERT_DECISION_SCHEMA_VERSION),
    "with fields:",
    'decision, problemType, rootCause, upstreamIntent, appsolinoIntent, resolution,',
    "filesChanged, testsAddedOrChanged, patchActions, remainingRisks, requiresPolicyDecision",
  ].filter(Boolean).join("\n");
}

/**
 * Parse last JSON object from model stdout (fail closed).
 * Uses production-robust structured extraction (fence / balanced braces).
 * @param {string} text
 */
export function parseExpertStdout(text) {
  const parsed = parseStructuredJson(text);
  if (!parsed.ok) return { ok: false, error: parsed.error, raw: null };
  return { ok: true, error: null, raw: parsed.raw, method: parsed.method };
}

/**
 * @param {{
 *   worktreePath: string,
 *   evidence: Parameters<typeof buildExpertEvidencePrompt>[0],
 *   spawnFn?: typeof spawn,
 *   cursorBin?: string,
 *   timeoutMs?: number,
 *   abortSignal?: AbortSignal|null,
 *   onActivity?: (() => void)|null,
 *   skipModelProbe?: boolean,
 *   engine?: (input: object) => Promise<object>|object,
 *   apiKey?: string|null,
 * }} input
 */
export async function runUpstreamExpertResolver(input) {
  const worktreePath = input.worktreePath;
  if (!worktreePath || !existsSync(worktreePath)) {
    return {
      ok: false,
      action: "BLOCKED_UNRESOLVED",
      reason: "expert worktree missing",
      configuredProvider: EXPERT_PROVIDER,
      configuredModel: EXPERT_MODEL,
      actualProvider: null,
      actualModel: null,
    };
  }

  const childEnv = cursorChildEnv({
    apiKey:
      input.apiKey ??
      process.env.UPSTREAM_EXPERT_CURSOR_API_KEY ??
      process.env.S1B_CURSOR_API_KEY ??
      process.env.S1A_CURSOR_API_KEY ??
      process.env.CURSOR_API_KEY ??
      process.env.CURSOR_AGENT_API_KEY ??
      "",
  });
  assertNoCredentialLeak(childEnv, { allowCursorKey: true });

  const startedAt = Date.now();
  if (typeof input.engine === "function") {
    // Unit-test injection only — must not be used as live acceptance proof.
    const engineered = await input.engine({ ...input, childEnv });
    const validated = validateExpertDecision(engineered?.decision || engineered);
    return {
      ok: validated.ok,
      action: validated.ok ? "EXPERT_DECISION" : "BLOCKED_UNRESOLVED",
      reason: validated.ok ? "injected-engine" : validated.errors.join("; "),
      decision: validated.decision,
      configuredProvider: EXPERT_PROVIDER,
      configuredModel: EXPERT_MODEL,
      actualProvider: engineered?.actualProvider || EXPERT_PROVIDER,
      actualModel: engineered?.actualModel || EXPERT_MODEL,
      latencyMs: Date.now() - startedAt,
      schemaVersion: EXPERT_DECISION_SCHEMA_VERSION,
      role: "resolver",
      testInjection: true,
    };
  }

  const bin = input.cursorBin || process.env.CURSOR_AGENT_BIN || CURSOR_AGENT_BIN;
  if (input.skipModelProbe !== true) {
    try {
      await assertModelAvailable(bin, EXPERT_MODEL, spawn, childEnv);
    } catch (error) {
      return {
        ok: false,
        action: "BLOCKED_UNRESOLVED",
        reason: `real AI model unavailable: ${error instanceof Error ? error.message : String(error)}`,
        configuredProvider: EXPERT_PROVIDER,
        configuredModel: EXPERT_MODEL,
        actualProvider: null,
        actualModel: null,
        latencyMs: Date.now() - startedAt,
        role: "resolver",
      };
    }
  }

  const prompt = buildExpertEvidencePrompt(input.evidence);
  const promptDir = join(worktreePath, ".appsolino");
  mkdirSync(promptDir, { recursive: true });
  const promptPath = join(promptDir, "upstream-expert-prompt.txt");
  writeFileSync(promptPath, prompt);

  const spawnFn = input.spawnFn || spawn;
  const args = [
    "--print",
    "--force",
    "--model", EXPERT_MODEL,
    prompt,
  ];

  const spawned = await spawnCursorWithTimeout({
    bin,
    args,
    cwd: worktreePath,
    env: childEnv,
    timeoutMs: input.timeoutMs ?? DEFAULT_CURSOR_TIMEOUT_MS,
    spawnFn,
    label: "expert resolver",
    abortSignal: input.abortSignal || null,
    onActivity: input.onActivity || null,
  });

  if (!spawned.ok) {
    const msg = spawned.error.message || String(spawned.error);
    if (spawned.aborted) {
      const stale = spawned.abortReason && typeof spawned.abortReason === "object";
      return {
        ok: false,
        action: stale ? "REFRESH_REQUIRED" : "LATENCY_BUDGET_EXHAUSTED",
        failureClass: stale
          ? spawned.abortReason.classification || "STALE_UPSTREAM"
          : "LATENCY_BUDGET_EXHAUSTED",
        reason: `expert aborted: ${msg}`,
        abortReason: spawned.abortReason || null,
        configuredProvider: EXPERT_PROVIDER,
        configuredModel: EXPERT_MODEL,
        actualProvider: null,
        actualModel: null,
        latencyMs: Date.now() - startedAt,
        role: "resolver",
      };
    }
    const failureClass = classifyAiFailure({ reason: msg, action: "AI_PROVIDER_ERROR" });
    return {
      ok: false,
      action: nextFromAiFailureClass(failureClass),
      failureClass,
      reason: `expert invocation failed: ${msg}`,
      configuredProvider: EXPERT_PROVIDER,
      configuredModel: EXPERT_MODEL,
      actualProvider: null,
      actualModel: null,
      latencyMs: Date.now() - startedAt,
      role: "resolver",
    };
  }

  const parsed = parseExpertStdout(String(spawned.stdout));
  if (!parsed.ok) {
    return {
      ok: false,
      action: "AI_PROTOCOL_ERROR",
      failureClass: "AI_PROTOCOL_ERROR",
      reason: `malformed expert output (${parsed.error}) — fail closed`,
      configuredProvider: EXPERT_PROVIDER,
      configuredModel: EXPERT_MODEL,
      actualProvider: EXPERT_PROVIDER,
      actualModel: EXPERT_MODEL,
      latencyMs: Date.now() - startedAt,
      role: "resolver",
    };
  }
  const validated = validateExpertDecision(parsed.raw);
  if (!validated.ok) {
    return {
      ok: false,
      action: "AI_PROTOCOL_ERROR",
      failureClass: "AI_PROTOCOL_ERROR",
      reason: `expert schema validation failed: ${validated.errors.join("; ")}`,
      configuredProvider: EXPERT_PROVIDER,
      configuredModel: EXPERT_MODEL,
      actualProvider: EXPERT_PROVIDER,
      actualModel: EXPERT_MODEL,
      latencyMs: Date.now() - startedAt,
      role: "resolver",
    };
  }

  return {
    ok: true,
    action: "EXPERT_DECISION",
    reason: "validated structured expert decision",
    decision: validated.decision,
    configuredProvider: EXPERT_PROVIDER,
    configuredModel: EXPERT_MODEL,
    actualProvider: EXPERT_PROVIDER,
    actualModel: EXPERT_MODEL,
    latencyMs: Date.now() - startedAt,
    schemaVersion: EXPERT_DECISION_SCHEMA_VERSION,
    role: "resolver",
    requestId: null,
  };
}
