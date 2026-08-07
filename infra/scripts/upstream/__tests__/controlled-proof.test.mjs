#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamControlledProof 2026-08-07-04:30:
 * Controlled end-to-end proof: V1 + PATCH-A + PATCH-B → upstream V1.1 fixes A not B →
 * system retires A, retains/adapts B → V1.2 fixes B → clean V1.2.
 * Judges by resulting registry state + deterministic assertions — not hard-coded AI answers.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertPatch, loadPatchRegistry, seedInitialProductPatches } from "../patch-registry.mjs";
import { reconcileAllPatches } from "../patch-reconcile.mjs";
import { runExpertRepairLoop } from "../expert-repair-loop.mjs";
import { evaluateFreshness, assertNoFalseGreen } from "../freshness.mjs";
import { assertFinalizerFreshness, selectRollingCandidate, planSupersedeObsolete } from "../rolling-candidate.mjs";

describe("controlled patch lifecycle V1→V1.1→V1.2", () => {
  /** @type {string} */
  let root;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "upstream-patch-proof-"));
    mkdirSync(join(root, ".appsolino", "patches"), { recursive: true });
    upsertPatch(root, {
      id: "FIX-A",
      status: "ACTIVE",
      defect: {
        description: "Issue A: null deref in planner",
        reproduction: "open planner with empty goals",
        affectedSubsystem: "engine/planner",
      },
      introducedAgainst: { upstreamSha: "v1".padEnd(40, "0") },
      regressionTests: ["test-a"],
      upstreamComparison: { classification: "APPSOLINO_ONLY" },
      localAction: { patchRequired: true, applyPaths: ["packages/engine/src/a.ts"] },
      retirementCondition: { regressionTestPassesOnCleanUpstream: true },
      revisions: [{ revision: 1, againstUpstreamSha: "v1".padEnd(40, "0"), summary: "initial", files: ["packages/engine/src/a.ts"] }],
    });
    upsertPatch(root, {
      id: "FIX-B",
      status: "ACTIVE",
      defect: {
        description: "Issue B: merge base assumes main",
        reproduction: "default branch master",
        affectedSubsystem: "engine/merge",
      },
      introducedAgainst: { upstreamSha: "v1".padEnd(40, "0") },
      regressionTests: ["test-b"],
      upstreamComparison: { classification: "APPSOLINO_ONLY" },
      localAction: { patchRequired: true, applyPaths: ["packages/engine/src/b.ts"] },
      retirementCondition: { regressionTestPassesOnCleanUpstream: true },
      revisions: [{ revision: 1, againstUpstreamSha: "v1".padEnd(40, "0"), summary: "initial", files: ["packages/engine/src/b.ts"] }],
    });
  });

  it("V1.1 fixes A only → retire A, retain B", async () => {
    const v11 = "v11".padEnd(40, "1");
    const r = await reconcileAllPatches({
      repoRoot: root,
      cleanUpstreamSha: v11,
      persist: true,
      runCleanRegression: async (patch) => {
        // On clean V1.1: A passes (upstream fixed), B fails (still broken)
        if (patch.id === "FIX-A") return { passed: true };
        if (patch.id === "FIX-B") return { passed: false };
        return { passed: false };
      },
      gatherUpstreamSignals: async (patch) => {
        if (patch.id === "FIX-A") {
          return [
            {
              kind: "commit",
              sha: v11,
              files: ["packages/engine/src/a.ts"],
              fixesBehavior: true,
              title: "fix planner null deref",
            },
          ];
        }
        return [];
      },
    });
    assert.deepEqual(r.retired.sort(), ["FIX-A"]);
    assert.ok(r.retained.includes("FIX-B"));
    assert.ok(!r.retired.includes("FIX-B"));
    const reg = loadPatchRegistry(root);
    const a = reg.patches.find((p) => p.id === "FIX-A");
    const b = reg.patches.find((p) => p.id === "FIX-B");
    assert.equal(a.status, "RETIRED");
    assert.equal(a.upstreamComparison.classification, "UPSTREAM_FIXED");
    assert.equal(b.status, "ACTIVE");
    assert.equal(b.localAction.patchRequired, true);
  });

  it("V1.2 fixes B → retire B → clean upstream", async () => {
    const v12 = "v12".padEnd(40, "2");
    const r = await reconcileAllPatches({
      repoRoot: root,
      cleanUpstreamSha: v12,
      persist: true,
      runCleanRegression: async (patch) => {
        // Both pass on clean V1.2
        return { passed: true };
      },
      gatherUpstreamSignals: async (patch) => {
        if (patch.id === "FIX-B") {
          return [
            {
              kind: "commit",
              sha: v12,
              files: ["packages/engine/src/b.ts"],
              fixesBehavior: true,
            },
          ];
        }
        // FIX-A already retired — still ACTIVE filter skips it
        return [{ kind: "commit", sha: v12, files: ["packages/engine/src/a.ts"], fixesBehavior: true }];
      },
    });
    assert.ok(r.retired.includes("FIX-B"));
    const reg = loadPatchRegistry(root);
    assert.equal(reg.active.length, 0);
    assert.equal(reg.patches.find((p) => p.id === "FIX-B").status, "RETIRED");
  });

  it("refuses incorrect retirement when classification claims fixed but test still fails", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "bad-retire-"));
    upsertPatch(tmp, {
      id: "FIX-C",
      status: "ACTIVE",
      defect: { description: "C", reproduction: "r", affectedSubsystem: "x" },
      introducedAgainst: { upstreamSha: null },
      regressionTests: ["t"],
      upstreamComparison: { classification: "APPSOLINO_ONLY" },
      localAction: { patchRequired: true, applyPaths: ["c.ts"] },
      retirementCondition: { regressionTestPassesOnCleanUpstream: true },
      revisions: [],
    });
    const r = await reconcileAllPatches({
      repoRoot: tmp,
      cleanUpstreamSha: "c".padEnd(40, "c"),
      persist: true,
      runCleanRegression: async () => ({ passed: false }),
      gatherUpstreamSignals: async () => [
        { kind: "commit", sha: "c".padEnd(40, "c"), files: ["c.ts"], fixesBehavior: true },
      ],
    });
    // compareFinding with fail + behavior fix claim + path overlap → UPSTREAM_RELATED not FIXED
    // decidePatch keeps active when regression fails
    assert.ok(r.retained.includes("FIX-C") || r.results[0].action === "RETAIN_OR_ADAPT" || r.results[0].action === "KEEP_ACTIVE_CONFLICT");
    const reg = loadPatchRegistry(tmp);
    assert.equal(reg.patches.find((p) => p.id === "FIX-C").status, "ACTIVE");
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("controlled expert resolution proof (injected engines)", () => {
  it("expert + failing tests cannot finalize; verifier REQUEST_CHANGES loops; then APPROVE", async () => {
    let testPass = false;
    let verifierRound = 0;
    const result = await runExpertRepairLoop({
      worktreePath: process.cwd(),
      maxAttempts: 3,
      evidence: {
        upstreamHead: "u".padEnd(40, "1"),
        appsolinoBaseSha: "a".padEnd(40, "2"),
        candidateUpstreamSha: "u".padEnd(40, "1"),
        conflictedFiles: ["packages/engine/src/x.ts"],
        problemSummary: "semantic conflict in executor",
      },
      liveUpstreamHead: "u".padEnd(40, "1"),
      expertFn: async () => ({
        ok: true,
        action: "EXPERT_DECISION",
        reason: "ok",
        decision: {
          schemaVersion: 1,
          decision: "RESOLVED",
          problemType: "SEMANTIC_CONFLICT",
          rootCause: "both changed handoff",
          upstreamIntent: "preserve planning",
          appsolinoIntent: "keep pause",
          resolution: "merge intents",
          filesChanged: ["packages/engine/src/x.ts"],
          testsAddedOrChanged: ["x.test.ts"],
          patchActions: ["adapt FIX-B"],
          remainingRisks: [],
          requiresPolicyDecision: false,
          confidence: null,
        },
        configuredProvider: "cursor-cli",
        configuredModel: "composer-2.5",
        actualProvider: "cursor-cli",
        actualModel: "composer-2.5",
        latencyMs: 1,
        schemaVersion: 1,
        role: "resolver",
        testInjection: true,
      }),
      verifierFn: async () => {
        verifierRound += 1;
        if (verifierRound === 1) {
          return {
            ok: true,
            action: "VERIFIER_VERDICT",
            reason: "ok",
            verdict: {
              schemaVersion: 1,
              verdict: "REQUEST_CHANGES",
              summary: "add regression",
              blockingFindings: [],
              requiredChanges: ["add regression"],
              risk: "MEDIUM",
            },
            configuredProvider: "cursor-cli",
            configuredModel: "composer-2.5",
            actualProvider: "cursor-cli",
            actualModel: "composer-2.5",
            latencyMs: 1,
            role: "verifier",
            testInjection: true,
          };
        }
        return {
          ok: true,
          action: "VERIFIER_VERDICT",
          reason: "ok",
          verdict: {
            schemaVersion: 1,
            verdict: "APPROVE",
            summary: "ok",
            blockingFindings: [],
            requiredChanges: [],
            risk: "LOW",
          },
          configuredProvider: "cursor-cli",
          configuredModel: "composer-2.5",
          actualProvider: "cursor-cli",
          actualModel: "composer-2.5",
          latencyMs: 1,
          role: "verifier",
          testInjection: true,
        };
      },
      runDeterministicTests: async () => {
        // First attempt fails even if expert says resolved; second passes after "repair"
        const passed = testPass;
        testPass = true;
        return { passed, failures: passed ? [] : ["regression still red"] };
      },
      recheckUpstreamFn: async () => "u".padEnd(40, "1"),
    });
    assert.equal(result.finalizable, true);
    assert.ok(result.attempts.length >= 2);
    assert.equal(result.attempts[0].testsPassed, false);
  });

  it("upstream move during repair → REFRESH_REQUIRED", async () => {
    let calls = 0;
    const result = await runExpertRepairLoop({
      worktreePath: process.cwd(),
      maxAttempts: 2,
      evidence: {
        candidateUpstreamSha: "old".padEnd(40, "0"),
        upstreamHead: "old".padEnd(40, "0"),
      },
      recheckUpstreamFn: async () => {
        calls += 1;
        return calls === 1 ? "new".padEnd(40, "1") : "new".padEnd(40, "1");
      },
      expertFn: async () => ({ ok: true, decision: null, reason: "should-not-run" }),
      verifierFn: async () => ({ ok: true, verdict: null }),
    });
    assert.equal(result.next, "REFRESH_REQUIRED");
    assert.equal(result.finalizable, false);
  });
});

describe("false-green / stale / race regressions", () => {
  it("AUTO-1+AUTO-2 success while behind cannot be FRESH", () => {
    const st = evaluateFreshness({
      upstreamHead: "u".padEnd(40, "1"),
      integratedUpstreamSha: "i".padEnd(40, "2"),
      candidateUpstreamSha: "u".padEnd(40, "1"),
      commitsBehindIntegrated: 15,
      auto1Outcome: "merged",
      auto2Action: "expert-resolving",
      expertActive: true,
    });
    assert.notEqual(st.state, "FRESH");
    assert.equal(st.overallHealthy, false);
    const g = assertNoFalseGreen({
      commitsBehindIntegrated: 15,
      state: "FRESH",
      auto1Success: true,
      auto2Success: true,
    });
    assert.equal(g.ok, false);
  });

  it("finalizer race refuses stale candidate", () => {
    const r = assertFinalizerFreshness({
      candidateUpstreamSha: "old".padEnd(40, "0"),
      liveUpstreamHead: "new".padEnd(40, "1"),
    });
    assert.equal(r.action, "REFRESH_REQUIRED");
  });

  it("obsolete automation PRs are supersede-closed, not merged", () => {
    const sel = selectRollingCandidate({
      upstreamHead: "297ec17f8eeba5822b359957a7fb4e7e73d61d19",
      openAutomationPrs: [{ number: 118, headRefName: "automation/upstream-64413f4e8d27" }],
    });
    const plan = planSupersedeObsolete(sel);
    assert.equal(plan.actions[0].type, "supersede-close");
    assert.match(plan.actions[0].comment, /Do not merge/);
  });
});
