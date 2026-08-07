#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamFreshness 2026-08-07-04:05:
 * Unit tests for freshness invariant, false-green guards, rolling candidate supersede,
 * finalizer race protection, and expert/verifier structured schemas.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateFreshness,
  assertNoFalseGreen,
  UNHEALTHY_FRESHNESS_STATES,
  formatFreshnessReport,
} from "../freshness.mjs";
import {
  selectRollingCandidate,
  planSupersedeObsolete,
  assertFinalizerFreshness,
} from "../rolling-candidate.mjs";
import {
  validateExpertDecision,
  validateVerifierVerdict,
  combineResolutionGate,
} from "../expert-decision-schema.mjs";

const UP = "297ec17f8eeba5822b359957a7fb4e7e73d61d19";
const INT = "8120c07b6a074755f44ed22f066b40eaeb19f199";
const CAND = "64413f4e8d278c94ac7a4cc64a2f83d7e83edd46";

describe("evaluateFreshness", () => {
  it("FRESH only when integrated matches upstream HEAD", () => {
    const r = evaluateFreshness({
      upstreamHead: UP,
      integratedUpstreamSha: UP,
      commitsBehindIntegrated: 0,
    });
    assert.equal(r.state, "FRESH");
    assert.equal(r.overallHealthy, true);
  });

  it("AUTO-1 PR creation while behind is NOT FRESH", () => {
    const r = evaluateFreshness({
      upstreamHead: UP,
      integratedUpstreamSha: INT,
      candidateUpstreamSha: UP,
      commitsBehindIntegrated: 18,
      auto1Outcome: "merged",
      activeCandidatePr: 999,
    });
    assert.notEqual(r.state, "FRESH");
    assert.equal(r.overallHealthy, false);
  });

  it("upstream moved after candidate → REFRESH_REQUIRED", () => {
    const r = evaluateFreshness({
      upstreamHead: UP,
      integratedUpstreamSha: INT,
      candidateUpstreamSha: CAND,
      commitsBehindIntegrated: 18,
      commitsBehindCandidate: 8,
      activeCandidatePr: 118,
      auto2Action: "approval-required",
    });
    assert.equal(r.state, "REFRESH_REQUIRED");
    assert.equal(r.overallUnhealthy, true);
  });

  it("five commits behind with no current candidate → STALE", () => {
    const r = evaluateFreshness({
      upstreamHead: UP,
      integratedUpstreamSha: INT,
      commitsBehindIntegrated: 15,
    });
    assert.equal(r.state, "STALE");
    assert.ok(UNHEALTHY_FRESHNESS_STATES.includes(r.state));
  });

  it("SENSITIVE approval-required without expert → STALE unhealthy", () => {
    const r = evaluateFreshness({
      upstreamHead: UP,
      integratedUpstreamSha: INT,
      candidateUpstreamSha: UP,
      commitsBehindIntegrated: 10,
      auto2Action: "approval-required",
      expertActive: false,
    });
    assert.equal(r.state, "STALE");
    assert.match(r.reasons.join(" "), /without AI expert/i);
  });

  it("expert active on current candidate → EXPERT_RESOLVING", () => {
    const r = evaluateFreshness({
      upstreamHead: UP,
      integratedUpstreamSha: INT,
      candidateUpstreamSha: UP,
      commitsBehindIntegrated: 10,
      expertActive: true,
    });
    assert.equal(r.state, "EXPERT_RESOLVING");
    assert.equal(r.overallHealthy, false);
  });
});

describe("assertNoFalseGreen", () => {
  it("rejects FRESH while behind", () => {
    const g = assertNoFalseGreen({
      commitsBehindIntegrated: 15,
      state: "FRESH",
      auto1Success: true,
      auto2Success: true,
    });
    assert.equal(g.ok, false);
    assert.equal(g.violation, "false-green-fresh-while-behind");
  });

  it("allows FRESH at zero distance", () => {
    const g = assertNoFalseGreen({
      commitsBehindIntegrated: 0,
      state: "FRESH",
      auto1Success: true,
      auto2Success: true,
    });
    assert.equal(g.ok, true);
  });
});

describe("rolling candidate", () => {
  it("selects one current PR and marks obsolete SHA-pinned PRs", () => {
    const sel = selectRollingCandidate({
      upstreamHead: UP,
      openAutomationPrs: [
        { number: 118, headRefName: "automation/upstream-64413f4e8d27" },
        { number: 130, headRefName: `automation/upstream-${UP.slice(0, 12)}` },
      ],
    });
    assert.equal(sel.activeCandidate?.number, 130);
    assert.equal(sel.obsoleteCandidates.length, 1);
    assert.equal(sel.obsoleteCandidates[0].number, 118);
  });

  it("plans supersede-close without merge", () => {
    const sel = selectRollingCandidate({
      upstreamHead: UP,
      openAutomationPrs: [{ number: 118, headRefName: "automation/upstream-64413f4e8d27" }],
    });
    const plan = planSupersedeObsolete(sel, { newPrNumber: 131, newUpstreamSha: UP });
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0].type, "supersede-close");
    assert.match(plan.actions[0].comment, /Do not merge/);
  });
});

describe("assertFinalizerFreshness", () => {
  it("refuses stale candidate at merge time", () => {
    const r = assertFinalizerFreshness({
      candidateUpstreamSha: CAND,
      liveUpstreamHead: UP,
    });
    assert.equal(r.ok, false);
    assert.equal(r.action, "REFRESH_REQUIRED");
  });

  it("allows matching candidate", () => {
    const r = assertFinalizerFreshness({
      candidateUpstreamSha: UP,
      liveUpstreamHead: UP,
    });
    assert.equal(r.ok, true);
  });
});

describe("expert/verifier schemas", () => {
  it("rejects malformed expert decision", () => {
    const v = validateExpertDecision({ decision: "RESOLVED" });
    assert.equal(v.ok, false);
  });

  it("accepts complete expert decision", () => {
    const v = validateExpertDecision({
      schemaVersion: 1,
      decision: "RESOLVED",
      problemType: "SEMANTIC_CONFLICT",
      rootCause: "both sides changed executor handoff",
      upstreamIntent: "preserve planning choices",
      appsolinoIntent: "keep Host D pause semantics",
      resolution: "merge both intents with regression test",
      filesChanged: ["packages/engine/src/executor.ts"],
      testsAddedOrChanged: ["packages/engine/src/__tests__/x.test.ts"],
      patchActions: ["retain appsolino-host-d-pause"],
      remainingRisks: ["narrow race on unpause"],
      requiresPolicyDecision: false,
    });
    assert.equal(v.ok, true);
  });

  it("AI RESOLVED cannot bypass failed deterministic tests", () => {
    const expert = validateExpertDecision({
      schemaVersion: 1,
      decision: "RESOLVED",
      problemType: "TEST_FAILURE",
      rootCause: "x",
      upstreamIntent: "y",
      appsolinoIntent: "z",
      resolution: "fixed",
      filesChanged: [],
      testsAddedOrChanged: [],
      patchActions: [],
      remainingRisks: [],
      requiresPolicyDecision: false,
    }).decision;
    const verifier = validateVerifierVerdict({
      schemaVersion: 1,
      verdict: "APPROVE",
      summary: "looks good",
      blockingFindings: [],
      requiredChanges: [],
      risk: "LOW",
    }).verdict;
    const gate = combineResolutionGate({
      expert,
      verifier,
      deterministicPassed: false,
      deterministicFailures: ["regression still red"],
      repairAttempt: 1,
      maxRepairAttempts: 3,
    });
    assert.equal(gate.finalizable, false);
    assert.equal(gate.next, "EXPERT_RESOLVING");
  });

  it("REQUEST_CHANGES returns to expert loop", () => {
    const expert = validateExpertDecision({
      schemaVersion: 1,
      decision: "RESOLVED",
      problemType: "BUILD_FAILURE",
      rootCause: "x",
      upstreamIntent: "y",
      appsolinoIntent: "z",
      resolution: "fixed",
      filesChanged: ["a.ts"],
      testsAddedOrChanged: [],
      patchActions: [],
      remainingRisks: [],
      requiresPolicyDecision: false,
    }).decision;
    const verifier = validateVerifierVerdict({
      schemaVersion: 1,
      verdict: "REQUEST_CHANGES",
      summary: "missing test",
      blockingFindings: [],
      requiredChanges: ["add regression"],
      risk: "MEDIUM",
    }).verdict;
    const gate = combineResolutionGate({
      expert,
      verifier,
      deterministicPassed: true,
      repairAttempt: 1,
      maxRepairAttempts: 3,
    });
    assert.equal(gate.finalizable, false);
    assert.equal(gate.next, "EXPERT_RESOLVING");
  });

  it("model unavailable / missing verifier fails closed", () => {
    const expert = validateExpertDecision({
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
    }).decision;
    const gate = combineResolutionGate({
      expert,
      verifier: null,
      deterministicPassed: true,
    });
    assert.equal(gate.finalizable, false);
    assert.equal(gate.next, "BLOCKED_UNRESOLVED");
  });
});

describe("formatFreshnessReport", () => {
  it("renders concise status answering Phase 13 questions", () => {
    const status = evaluateFreshness({
      upstreamHead: UP,
      integratedUpstreamSha: INT,
      candidateUpstreamSha: CAND,
      commitsBehindIntegrated: 18,
      commitsBehindCandidate: 8,
      activeCandidatePr: 118,
      auto2Action: "approval-required",
    });
    const report = formatFreshnessReport({
      ...status,
      expertModel: null,
      verifierVerdict: null,
      patchesRetained: ["host-d-engine-paused"],
      patchesRetired: [],
      suitesPassed: [],
    });
    assert.match(report, /Upstream HEAD/);
    assert.match(report, /REFRESH_REQUIRED|STALE/);
    assert.match(report, /Overall healthy \| NO/);
  });
});
