#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamRollingCandidate 2026-08-07-05:55:
 * Deterministic dual-race coverage for finalizer + expert repair loop.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertFinalizerFreshness } from "../rolling-candidate.mjs";
import { runExpertRepairLoop } from "../expert-repair-loop.mjs";
import { parseCandidateBaseAppsolinoSha } from "../../auto2-finalize.mjs";

const UP = "5e718544acc6ab3c000630e38b9672d4c4c1da3c";
const OLD_UP = "297ec17f8eeba5822b359957a7fb4e7e73d61d19";
const MAIN_A = "3c9ec4d5710ad0731b76915908386d530ca3df57";
const MAIN_B = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("dual finalizer race guard", () => {
  it("upstream changes during candidate → REFRESH_REQUIRED", () => {
    const r = assertFinalizerFreshness({
      candidateUpstreamSha: OLD_UP,
      liveUpstreamHead: UP,
      candidateBaseAppsolinoSha: MAIN_A,
      liveAppsolinoMain: MAIN_A,
    });
    assert.equal(r.action, "REFRESH_REQUIRED");
    assert.equal(r.mismatch, "upstream");
  });

  it("Appsolino main changes during candidate → REFRESH_REQUIRED", () => {
    const r = assertFinalizerFreshness({
      candidateUpstreamSha: UP,
      liveUpstreamHead: UP,
      candidateBaseAppsolinoSha: MAIN_A,
      liveAppsolinoMain: MAIN_B,
    });
    assert.equal(r.action, "REFRESH_REQUIRED");
    assert.equal(r.mismatch, "appsolino-base");
  });

  it("both change during candidate → REFRESH_REQUIRED (upstream first)", () => {
    const r = assertFinalizerFreshness({
      candidateUpstreamSha: OLD_UP,
      liveUpstreamHead: UP,
      candidateBaseAppsolinoSha: MAIN_A,
      liveAppsolinoMain: MAIN_B,
    });
    assert.equal(r.action, "REFRESH_REQUIRED");
    assert.equal(r.mismatch, "upstream");
  });

  it("main changes immediately before finalizer → REFRESH_REQUIRED", () => {
    // Simulates: candidate prepared on MAIN_A; #124 merges to MAIN_B; finalizer rechecks.
    const r = assertFinalizerFreshness({
      candidateUpstreamSha: UP,
      liveUpstreamHead: UP,
      candidateBaseAppsolinoSha: MAIN_A,
      liveAppsolinoMain: MAIN_B,
    });
    assert.equal(r.ok, false);
    assert.equal(r.action, "REFRESH_REQUIRED");
  });
});

describe("parseCandidateBaseAppsolinoSha", () => {
  it("reads identity marker from AUTO-1 PR body", () => {
    const body = `## AUTO-1
<!-- appsolino-candidate-identity
candidateBaseAppsolinoSha: ${MAIN_A}
candidateUpstreamSha: ${UP}
-->
`;
    assert.equal(parseCandidateBaseAppsolinoSha(body), MAIN_A);
  });
});

describe("expert repair loop race", () => {
  it("main changes during AI expert repair → REFRESH_REQUIRED", async () => {
    let liveMain = MAIN_A;
    const out = await runExpertRepairLoop({
      maxAttempts: 2,
      worktreePath: "/tmp",
      headRefName: `automation/upstream-${UP.slice(0, 12)}`,
      evidence: {
        candidateUpstreamSha: UP,
        candidateBaseAppsolinoSha: MAIN_A,
      },
      recheckUpstreamFn: async () => UP,
      recheckAppsolinoMainFn: async () => liveMain,
      expertFn: async () => {
        // Mid-repair: Appsolino main advances (e.g. #124 merges).
        liveMain = MAIN_B;
        return {
          ok: true,
          decision: {
            schemaVersion: 1,
            decision: "RESOLVED",
            problemType: "SEMANTIC_CONFLICT",
            rootCause: "x",
            upstreamIntent: "y",
            appsolinoIntent: "z",
            resolution: "keep both",
            filesChanged: ["a.ts"],
            testsAddedOrChanged: ["a.test.ts"],
            patchActions: ["retain"],
            remainingRisks: [],
            requiresPolicyDecision: false,
          },
        };
      },
      verifierFn: async () => ({
        ok: true,
        verdict: {
          schemaVersion: 1,
          verdict: "APPROVE",
          summary: "deterministic gates passed",
          blockingFindings: [],
          requiredChanges: [],
          risk: "LOW",
        },
      }),
      runDeterministicTests: async () => ({ passed: true, failures: [] }),
    });
    assert.equal(out.next, "REFRESH_REQUIRED");
    assert.equal(out.finalizable, false);
    assert.equal(out.mismatch, "appsolino-base");
  });
});
