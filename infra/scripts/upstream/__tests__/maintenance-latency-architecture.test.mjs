#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamLatency 2026-08-07-14:25:
 * Cycle budget, abort mid-flight, non-convergence, targeted repair routing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createCycleBudget } from "../cycle-budget.mjs";
import { spawnCursorWithTimeout, CURSOR_KILL_GRACE_MS } from "../cursor-spawn-timeout.mjs";
import {
  detectNonConvergence,
  normalizeRequiredChangesSignature,
  buildTargetedRepairInstructions,
  hasMeaningfulCandidateDelta,
} from "../repair-convergence.mjs";
import { runExpertRepairLoop } from "../expert-repair-loop.mjs";
import { buildExpertEvidencePrompt } from "../expert-resolver.mjs";
import { startStaleWatchdog } from "../stale-watchdog.mjs";

const SHA = "a".repeat(40);
const SHA2 = "b".repeat(40);

describe("createCycleBudget", () => {
  it("child timeout is min(phase, remaining) and cannot reset cycle", () => {
    let now = 1_000_000;
    const b = createCycleBudget({
      cycleBudgetMs: 10_000,
      phaseBudgetsMs: { expert: 8_000, verifier: 5_000 },
      startedAt: now,
      nowFn: () => now,
    });
    assert.equal(b.childTimeoutMs("expert"), 8_000);
    now += 7_000;
    assert.equal(b.childTimeoutMs("expert"), 3_000);
    assert.equal(b.childTimeoutMs("verifier"), 3_000);
    now += 4_000;
    assert.equal(b.exhausted(), true);
    assert.equal(b.childTimeoutMs("expert"), 0);
    assert.equal(b.assertNotExhausted().next, "LATENCY_BUDGET_EXHAUSTED");
  });
});

describe("spawnCursorWithTimeout abort", () => {
  it("aborts mid-flight via AbortSignal with SIGTERM→SIGKILL", async () => {
    const kills = [];
    const spawnFn = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = (signal) => {
        kills.push(signal);
        if (signal === "SIGKILL") {
          setTimeout(() => child.emit("close", null, "SIGKILL"), 0);
        }
      };
      return child;
    };
    const ac = new AbortController();
    const p = spawnCursorWithTimeout({
      bin: "x",
      args: [],
      cwd: "/",
      env: process.env,
      timeoutMs: 60_000,
      spawnFn,
      label: "test",
      abortSignal: ac.signal,
    });
    setTimeout(() => ac.abort({ action: "REFRESH_REQUIRED", classification: "STALE_UPSTREAM" }), 20);
    const r = await p;
    assert.equal(r.ok, false);
    assert.equal(r.aborted, true);
    assert.ok(kills.includes("SIGTERM"));
    assert.ok(kills.includes("SIGKILL"));
  });

  it("refuses timeoutMs=0 as budget exhausted", async () => {
    const r = await spawnCursorWithTimeout({
      bin: "x",
      args: [],
      cwd: "/",
      env: process.env,
      timeoutMs: 0,
      spawnFn: () => {
        throw new Error("should not spawn");
      },
      label: "x",
    });
    assert.equal(r.ok, false);
    assert.match(r.error.message, /budget already exhausted/);
  });
});

describe("repair convergence", () => {
  it("detects non-convergence on repeated requiredChanges with no delta", () => {
    const sig = normalizeRequiredChangesSignature(["fix auth", "Add test"]);
    const first = detectNonConvergence({
      priorSignature: sig,
      nextSignature: sig,
      hadMeaningfulDelta: false,
      repeatCount: 1,
    });
    assert.equal(first.nonConverging, true);
    assert.equal(first.next, "NON_CONVERGING_LOOP");
  });

  it("builds targeted repair instructions", () => {
    const t = buildTargetedRepairInstructions(["keep Appsolino patch X"]);
    assert.match(t, /TARGETED REPAIR/);
    assert.match(t, /keep Appsolino patch X/);
  });

  it("expert prompt includes requiredChanges focus", () => {
    const p = buildExpertEvidencePrompt({
      upstreamHead: SHA,
      appsolinoBaseSha: SHA,
      candidateUpstreamSha: SHA,
      requiredChanges: ["only fix conflict in foo.ts"],
    });
    assert.match(p, /TARGETED REPAIR|only fix conflict/);
  });

  it("empty delta detection", () => {
    assert.equal(hasMeaningfulCandidateDelta({ filesChanged: [], diffText: "" }), false);
    assert.equal(hasMeaningfulCandidateDelta({ filesChanged: ["a.ts"], diffText: "" }), true);
  });
});

describe("stale watchdog", () => {
  it("aborts when upstream moves", async () => {
    let live = SHA;
    const wd = startStaleWatchdog({
      intervalMs: 5_000,
      candidateUpstreamSha: SHA,
      candidateBaseAppsolinoSha: SHA,
      recheckUpstreamFn: async () => live,
      recheckAppsolinoMainFn: async () => SHA,
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(wd.signal.aborted, false);
    live = SHA2;
    // Force tick by stopping and using a fresh watchdog with already-stale live
    wd.stop();
    const wd2 = startStaleWatchdog({
      intervalMs: 60_000,
      candidateUpstreamSha: SHA,
      candidateBaseAppsolinoSha: SHA,
      recheckUpstreamFn: async () => SHA2,
      recheckAppsolinoMainFn: async () => SHA,
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(wd2.signal.aborted, true);
    assert.equal(wd2.signal.reason.action, "REFRESH_REQUIRED");
    wd2.stop();
  });
});

describe("repair loop latency controls", () => {
  it("stops when expert empty-delta after REQUEST_CHANGES", async () => {
    let n = 0;
    const result = await runExpertRepairLoop({
      worktreePath: process.cwd(),
      maxAttempts: 3,
      enableStaleWatchdog: false,
      cycleBudgetMs: 120_000,
      evidence: { candidateSha: SHA, candidateUpstreamSha: SHA, candidateBaseAppsolinoSha: SHA },
      getDiffText: async () => "",
      expertFn: async () => {
        n += 1;
        return {
          ok: true,
          decision: {
            decision: "REPAIR",
            problemType: "OTHER_ENGINEERING",
            rootCause: "x",
            upstreamIntent: "u",
            appsolinoIntent: "a",
            resolution: "r",
            filesChanged: n === 1 ? ["a.ts"] : [],
            testsAddedOrChanged: [],
            patchActions: [],
            remainingRisks: [],
            requiresPolicyDecision: false,
          },
          latencyMs: 1,
          actualModel: "mock",
        };
      },
      verifierFn: async () => ({
        ok: true,
        verdict: {
          verdict: "REQUEST_CHANGES",
          summary: "need more",
          requiredChanges: ["fix foo"],
          findings: [],
          remainingRisks: [],
          requiresPolicyDecision: false,
          deterministicEvidenceAccepted: true,
          candidateSha: SHA,
          upstreamSha: SHA,
          baseAppsolinoSha: SHA,
        },
        latencyMs: 1,
        actualModel: "mock",
      }),
      runDeterministicTests: async () => ({ passed: true, failures: [] }),
    });
    assert.equal(result.next, "NON_CONVERGING_LOOP");
    assert.ok(n >= 2);
  });

  it("exhausts cycle budget before nested 15m multiplies", async () => {
    let now = 0;
    const budget = createCycleBudget({
      cycleBudgetMs: 100,
      phaseBudgetsMs: { expert: 50_000, verifier: 50_000 },
      startedAt: 0,
      nowFn: () => now,
    });
    now = 150;
    const result = await runExpertRepairLoop({
      worktreePath: process.cwd(),
      maxAttempts: 3,
      cycleBudget: budget,
      enableStaleWatchdog: false,
      evidence: {},
      expertFn: async () => {
        throw new Error("expert should not run — budget exhausted");
      },
      verifierFn: async () => {
        throw new Error("verifier should not run");
      },
    });
    assert.equal(result.next, "LATENCY_BUDGET_EXHAUSTED");
  });
});
