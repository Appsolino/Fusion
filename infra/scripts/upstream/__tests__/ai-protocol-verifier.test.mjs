#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamAiProtocol 2026-08-07-09:00:
 * Regression coverage for production-robust structured verifier output.
 * Malformed responses must never APPROVE; recoverable formatting retries;
 * retry exhaustion fails closed as AI_PROTOCOL_ERROR (not ENGINEERING_UNRESOLVED).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseStructuredJson,
  parseAndValidateStructured,
  classifyAiFailure,
  nextFromAiFailureClass,
  extractJsonObjectCandidates,
} from "../structured-json.mjs";
import { validateVerifierVerdict } from "../expert-decision-schema.mjs";
import { runUpstreamAiVerifier, buildVerifierPrompt, DEFAULT_MAX_VERIFIER_ATTEMPTS } from "../ai-verifier.mjs";
import { runExpertRepairLoop } from "../expert-repair-loop.mjs";

const CAND = "4a027062f5de72e39931bf9f57fe2b28a817eecf";
const UP = "f7ca14beabc615d5a4ae044de67ac7c2c01adde8";
const BASE = "1375a36e203e3c517d26276d598ea2428942b04c";

function approvePayload(overrides = {}) {
  return {
    schemaVersion: 1,
    verdict: "APPROVE",
    summary: "repair looks sound",
    findings: [],
    requiredChanges: [],
    remainingRisks: [],
    deterministicEvidenceAccepted: true,
    requiresPolicyDecision: false,
    candidateSha: CAND,
    upstreamSha: UP,
    baseAppsolinoSha: BASE,
    risk: "SENSITIVE",
    ...overrides,
  };
}

const shaOpts = {
  expectedCandidateSha: CAND,
  expectedUpstreamSha: UP,
  expectedBaseAppsolinoSha: BASE,
  requireShaBinding: true,
};

describe("structured-json extraction", () => {
  it("parses whole-text JSON", () => {
    const r = parseStructuredJson(JSON.stringify(approvePayload()));
    assert.equal(r.ok, true);
    assert.equal(r.method, "whole-text");
    assert.equal(r.raw.verdict, "APPROVE");
  });

  it("extracts prose + valid JSON object", () => {
    const text = `Here is my analysis.\n\n${JSON.stringify(approvePayload())}\n`;
    const r = parseStructuredJson(text);
    assert.equal(r.ok, true);
    assert.equal(r.method, "balanced-brace");
    assert.equal(r.raw.verdict, "APPROVE");
  });

  it("extracts JSON followed by prose", () => {
    const text = `${JSON.stringify(approvePayload())}\n\nThanks for reviewing.`;
    // whole-text fails because of trailing prose; balanced-brace should win
    const r = parseStructuredJson(text);
    assert.equal(r.ok, true);
    assert.equal(r.raw.verdict, "APPROVE");
  });

  it("extracts fenced json", () => {
    const text = "Notes:\n```json\n" + JSON.stringify(approvePayload()) + "\n```\n";
    const r = parseStructuredJson(text);
    assert.equal(r.ok, true);
    assert.equal(r.method, "fenced-json");
  });

  it("rejects malformed JSON", () => {
    const text = '{ "verdict": "APPROVE", trailing }';
    const r = parseStructuredJson(text);
    assert.equal(r.ok, false);
    assert.match(r.error, /no-json|json-parse|malformed/i);
  });

  it("rejects no JSON", () => {
    const r = parseStructuredJson("I approve this change without structured output.");
    assert.equal(r.ok, false);
    assert.equal(r.error, "no-json-object");
  });

  it("balanced extract prefers last valid object", () => {
    const first = JSON.stringify({ schemaVersion: 1, verdict: "REQUEST_CHANGES", summary: "x", requiredChanges: ["a"], findings: [] });
    const second = JSON.stringify(approvePayload());
    const r = parseStructuredJson(`noise ${first} more ${second}`);
    assert.equal(r.ok, true);
    assert.equal(r.raw.verdict, "APPROVE");
  });

  it("extractJsonObjectCandidates is depth-aware", () => {
    const cands = extractJsonObjectCandidates('{ "a": { "b": 1 } } trailing');
    assert.ok(cands.length >= 1);
    assert.equal(JSON.parse(cands[0]).a.b, 1);
  });
});

describe("validateVerifierVerdict SHA binding", () => {
  it("accepts valid structured APPROVE", () => {
    const v = validateVerifierVerdict(approvePayload(), shaOpts);
    assert.equal(v.ok, true);
    assert.equal(v.verdict.verdict, "APPROVE");
  });

  it("accepts valid REQUEST_CHANGES", () => {
    const v = validateVerifierVerdict(
      approvePayload({
        verdict: "REQUEST_CHANGES",
        summary: "needs test",
        requiredChanges: ["add regression"],
        deterministicEvidenceAccepted: true,
      }),
      shaOpts,
    );
    assert.equal(v.ok, true);
    assert.equal(v.verdict.verdict, "REQUEST_CHANGES");
  });

  it("rejects wrong candidate SHA", () => {
    const v = validateVerifierVerdict(
      approvePayload({ candidateSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      shaOpts,
    );
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /candidateSha/.test(e)));
  });

  it("rejects missing required fields under binding", () => {
    const v = validateVerifierVerdict(
      {
        schemaVersion: 1,
        verdict: "APPROVE",
        summary: "ok",
        findings: [],
        requiredChanges: [],
      },
      shaOpts,
    );
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /candidateSha/.test(e)));
  });

  it("rejects APPROVE with blocking findings", () => {
    const v = validateVerifierVerdict(approvePayload({ findings: ["critical hole"] }), shaOpts);
    assert.equal(v.ok, false);
  });

  it("parseAndValidateStructured maps schema failure to AI_PROTOCOL_ERROR", () => {
    const r = parseAndValidateStructured(JSON.stringify({ verdict: "APPROVE" }), (raw) =>
      validateVerifierVerdict(raw, shaOpts),
    );
    assert.equal(r.ok, false);
    assert.equal(r.failureClass, "AI_PROTOCOL_ERROR");
  });
});

describe("classifyAiFailure taxonomy", () => {
  it("malformed JSON → AI_PROTOCOL_ERROR not ENGINEERING_UNRESOLVED", () => {
    assert.equal(
      classifyAiFailure({
        reason: "malformed verifier output (json-parse-failed:...) — fail closed",
        action: "BLOCKED_UNRESOLVED",
      }),
      "AI_PROTOCOL_ERROR",
    );
    assert.equal(nextFromAiFailureClass("AI_PROTOCOL_ERROR"), "AI_PROTOCOL_ERROR");
  });

  it("timeout / unavailable → AI_PROVIDER_ERROR", () => {
    assert.equal(
      classifyAiFailure({ reason: "verifier timed out after 600000ms" }),
      "AI_PROVIDER_ERROR",
    );
    assert.equal(
      classifyAiFailure({ reason: "verifier model unavailable: no model" }),
      "AI_PROVIDER_ERROR",
    );
  });
});

describe("runUpstreamAiVerifier recovery", () => {
  const evidence = {
    originalProblem: "test",
    diffText: "diff --git a/x",
    candidateSha: CAND,
    upstreamSha: UP,
    baseAppsolinoSha: BASE,
    deterministicTestResults: { passed: true, failures: [] },
  };

  it("valid structured APPROVE succeeds", async () => {
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      engine: async () => ({ verdict: approvePayload(), actualModel: "claude-opus-5-thinking-high" }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.verdict.verdict, "APPROVE");
    assert.equal(r.acceptedModel, "claude-opus-5-thinking-high");
    assert.equal(r.failureClass, null);
  });

  it("valid REQUEST_CHANGES succeeds as verdict", async () => {
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      engine: async () => ({
        verdict: approvePayload({
          verdict: "REQUEST_CHANGES",
          summary: "need more tests",
          requiredChanges: ["add dual-race test"],
        }),
      }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.verdict.verdict, "REQUEST_CHANGES");
  });

  it("prose + valid JSON recovers via extraction", async () => {
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      engine: async () => ({
        stdout: `I reviewed carefully.\n\n${JSON.stringify(approvePayload())}\n`,
        actualModel: "claude-opus-5-thinking-high",
      }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.verdict.verdict, "APPROVE");
    assert.equal(r.parseMethod, "balanced-brace");
  });

  it("JSON followed by prose recovers", async () => {
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      engine: async () => ({
        stdout: `${JSON.stringify(approvePayload())}\n\nEnd of review.`,
      }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.verdict.verdict, "APPROVE");
  });

  it("malformed JSON does not approve", async () => {
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      maxAttempts: 1,
      engine: async () => ({
        stdout: '{ "verdict": "APPROVE", "summary": "x" } TRAILING GARBAGE',
      }),
    });
    // Trailing garbage after a complete object: balanced extract may still recover the object.
    // Force truly broken JSON:
    const r2 = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      maxAttempts: 1,
      engine: async () => ({ stdout: '{ "verdict": "APPROVE",' }),
    });
    assert.equal(r2.ok, false);
    assert.equal(r2.failureClass, "AI_PROTOCOL_ERROR");
    assert.equal(r2.action, "AI_PROTOCOL_ERROR");
    assert.equal(r2.verdict, null);
    // Ensure even if first case recovered, it never invented APPROVE from garbage-only
    if (!r.ok) {
      assert.equal(r.failureClass, "AI_PROTOCOL_ERROR");
    }
  });

  it("no JSON fails closed", async () => {
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      maxAttempts: 1,
      engine: async () => ({ stdout: "APPROVE — looks good to me." }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureClass, "AI_PROTOCOL_ERROR");
    assert.equal(r.verdict, null);
  });

  it("wrong candidate SHA fails closed", async () => {
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      maxAttempts: 1,
      engine: async () => ({
        verdict: approvePayload({ candidateSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
      }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureClass, "AI_PROTOCOL_ERROR");
  });

  it("missing required fields fails closed", async () => {
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      maxAttempts: 1,
      engine: async () => ({
        verdict: { schemaVersion: 1, verdict: "APPROVE", summary: "ok", findings: [], requiredChanges: [] },
      }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureClass, "AI_PROTOCOL_ERROR");
  });

  it("provider unavailable → AI_PROVIDER_ERROR", async () => {
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      maxAttempts: 1,
      engine: async () => ({ __providerError: true, reason: "verifier model unavailable: missing" }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureClass, "AI_PROVIDER_ERROR");
    assert.equal(r.action, "AI_PROVIDER_ERROR");
  });

  it("timeout → AI_PROVIDER_ERROR via classify path", async () => {
    // engine returning provider error with timeout wording
    const r = await runUpstreamAiVerifier({
      evidence,
      maxAttempts: 1,
      engine: async () => ({ __providerError: true, reason: "verifier timed out after 600000ms" }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureClass, "AI_PROVIDER_ERROR");
  });

  it("first attempt malformed, second valid → recovers", async () => {
    let n = 0;
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      maxAttempts: 3,
      engine: async ({ promptMode }) => {
        n += 1;
        if (n === 1) {
          assert.equal(promptMode, "normal");
          return { stdout: "no json here" };
        }
        assert.equal(promptMode, "schema-repair");
        return { verdict: approvePayload(), actualModel: "claude-opus-5-thinking-high" };
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.acceptedFromAttempt, 2);
    assert.equal(r.verifierAttempts.length, 2);
    assert.equal(r.verdict.verdict, "APPROVE");
  });

  it("all attempts malformed → AI_PROTOCOL_ERROR fail closed", async () => {
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      maxAttempts: DEFAULT_MAX_VERIFIER_ATTEMPTS,
      engine: async () => ({ stdout: "still broken" }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureClass, "AI_PROTOCOL_ERROR");
    assert.equal(r.action, "AI_PROTOCOL_ERROR");
    assert.equal(r.retryBudgetExhausted, true);
    assert.equal(r.verifierAttempts.length, 3);
    assert.equal(r.verdict, null);
  });

  it("fresh attempt uses secondary model when configured", async () => {
    const models = [];
    const r = await runUpstreamAiVerifier({
      evidence,
      requireShaBinding: true,
      maxAttempts: 3,
      model: "claude-opus-5-thinking-high",
      secondaryModel: "composer-2",
      engine: async ({ modelOverride, promptMode }) => {
        models.push({ modelOverride, promptMode });
        if (promptMode !== "fresh") return { stdout: "bad" };
        return {
          verdict: approvePayload(),
          actualModel: modelOverride,
        };
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.acceptedModel, "composer-2");
    assert.ok(models.some((m) => m.promptMode === "fresh" && m.modelOverride === "composer-2"));
  });

  it("buildVerifierPrompt includes SHA binding and JSON-only contract", () => {
    const p = buildVerifierPrompt(evidence, { mode: "normal" });
    assert.match(p, /candidateSha/);
    assert.match(p, /ONLY a single JSON object/);
    const repair = buildVerifierPrompt(evidence, { mode: "schema-repair", priorError: "no-json-object" });
    assert.match(repair, /SCHEMA REPAIR/);
    assert.match(repair, /no-json-object/);
  });
});

describe("expert repair loop maps AI_PROTOCOL_ERROR", () => {
  it("malformed verifier after retries does not become BLOCKED_UNRESOLVED", async () => {
    const result = await runExpertRepairLoop({
      worktreePath: process.cwd(),
      maxAttempts: 1,
      evidence: {
        candidateUpstreamSha: UP,
        candidateBaseAppsolinoSha: BASE,
        candidateHeadSha: CAND,
        riskClass: "SENSITIVE",
      },
      expertFn: async () => ({
        ok: true,
        decision: {
          schemaVersion: 1,
          decision: "RESOLVED",
          problemType: "OTHER_ENGINEERING",
          rootCause: "x",
          upstreamIntent: "y",
          appsolinoIntent: "z",
          resolution: "fixed",
          filesChanged: [],
          testsAddedOrChanged: [],
          patchActions: [],
          remainingRisks: [],
          requiresPolicyDecision: false,
        },
        actualModel: "composer-2.5",
        configuredProvider: "cursor",
        configuredModel: "composer-2.5",
        actualProvider: "cursor",
        latencyMs: 1,
      }),
      verifierFn: async () => ({
        ok: false,
        action: "AI_PROTOCOL_ERROR",
        failureClass: "AI_PROTOCOL_ERROR",
        reason: "malformed verifier output (no-json-object) — fail closed",
        verdict: null,
        configuredProvider: "cursor",
        configuredModel: "claude-opus-5-thinking-high",
        actualModel: "claude-opus-5-thinking-high",
        latencyMs: 1,
        verifierAttempts: [{ attempt: 1, ok: false }, { attempt: 2, ok: false }, { attempt: 3, ok: false }],
      }),
      runDeterministicTests: async () => ({ passed: true, failures: [] }),
      getDiffText: async () => "diff",
    });
    assert.equal(result.finalizable, false);
    assert.equal(result.next, "AI_PROTOCOL_ERROR");
    assert.equal(result.failureClass, "AI_PROTOCOL_ERROR");
    assert.notEqual(result.next, "BLOCKED_UNRESOLVED");
  });
});
