#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamLatency 2026-08-07-13:55:
 * SENSITIVE_REVIEW vs REPAIR_REQUIRED routing — do not open edit agents on clean candidates.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifySensitiveWorkMode,
  resolveSensitiveContinuation,
} from "../sensitive-expert-path.mjs";

const UP = "f".repeat(40);
const MAIN = "a".repeat(40);

describe("classifySensitiveWorkMode", () => {
  it("deterministic PASS → SENSITIVE_REVIEW", () => {
    assert.equal(classifySensitiveWorkMode({ deterministicPassed: true }), "SENSITIVE_REVIEW");
  });
  it("deterministic FAIL → REPAIR_REQUIRED", () => {
    assert.equal(classifySensitiveWorkMode({ deterministicPassed: false }), "REPAIR_REQUIRED");
  });
  it("REQUEST_CHANGES → REPAIR_REQUIRED", () => {
    assert.equal(
      classifySensitiveWorkMode({ deterministicPassed: true, verifierVerdict: "REQUEST_CHANGES" }),
      "REPAIR_REQUIRED",
    );
  });
});

describe("resolveSensitiveContinuation latency routing", () => {
  it("clean sensitive → sensitive-review (not expert-resolving)", () => {
    const r = resolveSensitiveContinuation({
      riskClass: "sensitive",
      deterministicPassed: true,
      candidateUpstreamSha: UP,
      liveUpstreamHead: UP,
      candidateBaseAppsolinoSha: MAIN,
      liveAppsolinoMain: MAIN,
    });
    assert.equal(r.action, "sensitive-review");
    assert.equal(r.workMode, "SENSITIVE_REVIEW");
    assert.match(r.reason, /read-only|SENSITIVE_REVIEW/i);
  });

  it("failed deterministic → expert-resolving REPAIR_REQUIRED", () => {
    const r = resolveSensitiveContinuation({
      riskClass: "sensitive",
      deterministicPassed: false,
      candidateUpstreamSha: UP,
      liveUpstreamHead: UP,
      candidateBaseAppsolinoSha: MAIN,
      liveAppsolinoMain: MAIN,
    });
    assert.equal(r.action, "expert-resolving");
    assert.equal(r.workMode, "REPAIR_REQUIRED");
  });

  it("verifier APPROVE + deterministic → merge-eligible (no owner)", () => {
    const r = resolveSensitiveContinuation({
      riskClass: "sensitive",
      deterministicPassed: true,
      verifierCompleted: true,
      verifierVerdict: "APPROVE",
      candidateUpstreamSha: UP,
      liveUpstreamHead: UP,
      candidateBaseAppsolinoSha: MAIN,
      liveAppsolinoMain: MAIN,
    });
    assert.equal(r.action, "merge-eligible");
  });

  it("auto2:ai-verified label → merge-eligible without re-running sensitive-review", () => {
    const r = resolveSensitiveContinuation({
      riskClass: "sensitive",
      deterministicPassed: true,
      aiVerifiedLabel: true,
      candidateUpstreamSha: UP,
      liveUpstreamHead: UP,
      candidateBaseAppsolinoSha: MAIN,
      liveAppsolinoMain: MAIN,
    });
    assert.equal(r.action, "merge-eligible");
    assert.match(r.reason, /ai-verified/i);
  });
});
