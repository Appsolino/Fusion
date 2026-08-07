#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:FusionReliabilitySuite 2026-08-07-04:24:
 * Regression coverage for the Part B truthfulness invariant: a SUCCESS may only survive when the
 * record carries positive proof that every mandatory final actually passed.
 * Surface enumeration — the v1 guard was bypassable through EVERY one of these, so the test asserts
 * the general invariant rather than the single reported repro:
 *   1. omitted `mandatoryFinalFailed`
 *   2. truthy non-boolean flag ("yes", 1)
 *   3. empty record with no level/repo/sha
 *   4. mandatoryFinals present but empty
 *   5. a final claiming passed:true with a nonzero exitCode
 *   6. configured/actual model mismatch (provider truthfulness)
 *   7. synthetic / mock execution posing as a live pass
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordChallengeRun,
  summarizeReliabilitySuite,
  evaluateSuccessProof,
  isMandatoryFinalFailed,
  isFixtureDrivenRun,
  CHALLENGE_CATALOG,
  RELIABILITY_DIR,
} from "../reliability-suite.mjs";

/** A fully-proven live SUCCESS record — the only shape allowed to stay SUCCESS. */
function provenRun(overrides = {}) {
  return {
    taskId: "REL-L1-PROVEN",
    level: 1,
    repo: "Appsolino/reliability-fixture",
    requestedBehavior: "fix failing assertion",
    startingSha: "a".repeat(40),
    finalSha: "b".repeat(40),
    configuredModel: "composer-2.5",
    actualModel: "composer-2.5",
    actualProvider: "cursor-cli",
    mandatoryFinals: [
      { name: "targeted-test", passed: true, exitCode: 0 },
      { name: "push", passed: true, exitCode: 0 },
    ],
    finalStatus: "SUCCESS",
    humanInterventions: 0,
    ...overrides,
  };
}

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fusion-rel-suite-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Read back what was actually persisted, since the guard rewrites on disk. */
function recordAndRead(run) {
  return JSON.parse(readFileSync(recordChallengeRun(root, run), "utf8"));
}

describe("isMandatoryFinalFailed", () => {
  it("treats truthy non-boolean values as a self-reported failure", () => {
    for (const value of ["yes", "true", 1, "FAILED"]) {
      assert.equal(isMandatoryFinalFailed(value), true, `expected ${JSON.stringify(value)} to be failed`);
    }
  });

  it("treats explicit negatives and absence as not-failed", () => {
    for (const value of [false, undefined, null, "", "false", "no", "0"]) {
      assert.equal(isMandatoryFinalFailed(value), false, `expected ${JSON.stringify(value)} to be not-failed`);
    }
  });
});

describe("recordChallengeRun truthfulness guard", () => {
  it("preserves a fully-proven SUCCESS", () => {
    const rec = recordAndRead(provenRun());
    assert.equal(rec.finalStatus, "SUCCESS");
    assert.equal(rec.successProven, true);
    assert.equal(rec.truthfulnessViolationCaught, undefined);
  });

  // Surface 1 + 3: the original v1 holes.
  it("downgrades a SUCCESS that omits mandatory-final evidence entirely", () => {
    const rec = recordAndRead({ taskId: "PROBE-OMIT", level: 1, repo: "x", requestedBehavior: "y", finalStatus: "SUCCESS" });
    assert.equal(rec.finalStatus, "CRITICAL_FALSE_SUCCESS_PREVENTED");
    assert.equal(rec.claimedStatus, "SUCCESS");
    assert.equal(rec.truthfulnessViolationCaught, true);
  });

  it("marks a record missing required fields as schema-invalid", () => {
    const rec = recordAndRead({ taskId: "PROBE-EMPTY" });
    assert.equal(rec.schemaValid, false);
    assert.match(rec.schemaViolations.join(" "), /level/);
  });

  // Surface 2: truthy non-boolean flag slipped past the v1 `=== true` comparison.
  it("downgrades a SUCCESS whose mandatoryFinalFailed is a truthy string", () => {
    const rec = recordAndRead(provenRun({ taskId: "PROBE-STRING", mandatoryFinalFailed: "yes" }));
    assert.equal(rec.finalStatus, "CRITICAL_FALSE_SUCCESS_PREVENTED");
    assert.match(rec.truthfulnessViolationReasons.join(" "), /self-reports/);
  });

  // Surface 4: "verified nothing" must not read as verified.
  it("downgrades a SUCCESS with an empty mandatoryFinals set", () => {
    const rec = recordAndRead(provenRun({ mandatoryFinals: [] }));
    assert.equal(rec.finalStatus, "CRITICAL_FALSE_SUCCESS_PREVENTED");
    assert.match(rec.truthfulnessViolationReasons.join(" "), /nothing was actually verified/);
  });

  // Surface 5: a pass claim contradicted by its own exit code.
  it("downgrades a SUCCESS whose final claims pass with a nonzero exit code", () => {
    const rec = recordAndRead(provenRun({
      mandatoryFinals: [{ name: "targeted-test", passed: true, exitCode: 1 }],
    }));
    assert.equal(rec.finalStatus, "CRITICAL_FALSE_SUCCESS_PREVENTED");
    assert.match(rec.truthfulnessViolationReasons.join(" "), /nonzero exitCode/);
  });

  it("downgrades a SUCCESS whose final is not explicitly passed", () => {
    const rec = recordAndRead(provenRun({ mandatoryFinals: [{ name: "push", passed: false }] }));
    assert.equal(rec.finalStatus, "CRITICAL_FALSE_SUCCESS_PREVENTED");
    assert.match(rec.truthfulnessViolationReasons.join(" "), /not explicitly passed: push/);
  });

  // Surface 6: governance requires configured AND actual model; a mismatch is blocking.
  it("downgrades a SUCCESS with a configured/actual model mismatch", () => {
    const rec = recordAndRead(provenRun({ configuredModel: "composer-2.5", actualModel: "mock" }));
    assert.equal(rec.finalStatus, "CRITICAL_FALSE_SUCCESS_PREVENTED");
    assert.match(rec.truthfulnessViolationReasons.join(" "), /mismatch/);
  });

  it("downgrades a SUCCESS that omits the actual model", () => {
    const rec = recordAndRead(provenRun({ actualModel: undefined }));
    assert.equal(rec.finalStatus, "CRITICAL_FALSE_SUCCESS_PREVENTED");
    assert.match(rec.truthfulnessViolationReasons.join(" "), /actualModel/);
  });

  // Surface 7: mock execution may never be presented as real-provider proof.
  it("downgrades a synthetic or mock-provider SUCCESS", () => {
    assert.equal(recordAndRead(provenRun({ synthetic: true })).finalStatus, "CRITICAL_FALSE_SUCCESS_PREVENTED");
    assert.equal(recordAndRead(provenRun({ taskId: "P-INJ", testInjection: true })).finalStatus, "CRITICAL_FALSE_SUCCESS_PREVENTED");
    assert.equal(recordAndRead(provenRun({ taskId: "P-MOCK", actualProvider: "mock" })).finalStatus, "CRITICAL_FALSE_SUCCESS_PREVENTED");
  });

  it("rejects an unknown finalStatus rather than accepting it silently", () => {
    const rec = recordAndRead(provenRun({ finalStatus: "PROBABLY_FINE" }));
    assert.equal(rec.schemaValid, false);
    assert.match(rec.schemaViolations.join(" "), /unknown finalStatus/);
  });
});

describe("isFixtureDrivenRun", () => {
  it("detects a scripted executor in any model/provider slot", () => {
    assert.equal(isFixtureDrivenRun({ agentModel: "deterministic-fixture-agent" }), true);
    assert.equal(isFixtureDrivenRun({ actualProvider: "mock" }), true);
    assert.equal(isFixtureDrivenRun({ independentReview: { model: "fixture-reviewer-v1" } }), true);
    assert.equal(isFixtureDrivenRun({ agentModel: "composer-2.5", actualModel: "composer-2.5" }), false);
  });
});

describe("evaluateSuccessProof", () => {
  it("reports every failing reason at once so an operator sees the whole gap", () => {
    const { proven, reasons } = evaluateSuccessProof({ finalStatus: "SUCCESS" });
    assert.equal(proven, false);
    assert.ok(reasons.length > 1, `expected multiple reasons, got ${reasons.length}`);
  });
});

describe("summarizeReliabilitySuite", () => {
  it("excludes synthetic runs from evidence counters and level coverage", () => {
    recordChallengeRun(root, { ...provenRun({ taskId: "SYNTH" }), synthetic: true, repo: "synthetic" });
    const summary = summarizeReliabilitySuite(root);
    assert.equal(summary.attempted, 0);
    assert.equal(summary.syntheticExcluded, 1);
    assert.equal(summary.passed, 0);
    assert.deepEqual(summary.levelsProvenByRealRun, []);
  });

  it("counts a proven real run toward its level and surfaces remaining levels", () => {
    recordChallengeRun(root, provenRun());
    const summary = summarizeReliabilitySuite(root);
    assert.equal(summary.attempted, 1);
    assert.equal(summary.passed, 1);
    assert.deepEqual(summary.levelsProvenByRealRun, [1]);
    assert.ok(!summary.levelsUnproven.includes(1));
    assert.equal(summary.partBClaimable, false);
  });

  it("never claims Part B while any catalog level is unproven", () => {
    recordChallengeRun(root, provenRun());
    const summary = summarizeReliabilitySuite(root);
    assert.equal(summary.partBClaimable, false);
    assert.equal(summary.levelsUnproven.length, CHALLENGE_CATALOG.length - 1);
  });

  it("aggregates operator interventions, the headline autonomy metric", () => {
    recordChallengeRun(root, provenRun({ taskId: "A", humanInterventions: 2 }));
    recordChallengeRun(root, provenRun({ taskId: "B", humanInterventions: 3 }));
    assert.equal(summarizeReliabilitySuite(root).humanInterventions, 5);
  });

  /*
  A legacy schemaVersion-1 record can sit on disk reading `finalStatus: "SUCCESS"` without ever
  having been proof-checked. It must be loudly reported, not merely uncounted.
  */
  it("loudly flags a legacy SUCCESS record that was never proof-checked", () => {
    const dir = join(root, RELIABILITY_DIR, "runs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "LEGACY.json"), JSON.stringify({
      schemaVersion: 1,
      taskId: "REL-L1-LEGACY",
      level: 1,
      repo: "fixture",
      requestedBehavior: "x",
      finalStatus: "SUCCESS",
      mandatoryFinalFailed: false,
    }));
    const summary = summarizeReliabilitySuite(root);
    assert.equal(summary.passed, 0);
    assert.equal(summary.unprovenSuccessClaims, 1);
    assert.deepEqual(summary.unprovenSuccessTaskIds, ["REL-L1-LEGACY"]);
    assert.deepEqual(summary.levelsProvenByRealRun, []);
  });

  it("flags fixture-driven runs so a scripted executor is never read as agent proof", () => {
    recordChallengeRun(root, provenRun({
      taskId: "REL-L1-FIXTURE",
      agentModel: "deterministic-fixture-agent",
      independentReview: { provider: "deterministic-independent-reviewer", model: "fixture-reviewer-v1", verdict: "APPROVE" },
    }));
    const summary = summarizeReliabilitySuite(root);
    assert.equal(summary.fixtureDrivenClaims, 1);
    assert.deepEqual(summary.fixtureDrivenTaskIds, ["REL-L1-FIXTURE"]);
    assert.equal(summary.passed, 0);
    assert.equal(summary.falseSuccessIncidents, 1);
  });

  it("returns a safe empty summary when no runs exist", () => {
    const summary = summarizeReliabilitySuite(join(root, "missing"));
    assert.equal(summary.attempted, 0);
    assert.equal(summary.partBClaimable, false);
    assert.equal(summary.levelsUnproven.length, CHALLENGE_CATALOG.length);
  });
});
