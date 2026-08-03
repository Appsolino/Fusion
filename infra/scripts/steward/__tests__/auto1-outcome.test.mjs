#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-03:
 * AUTO-1 structured outcome classification (run 30805433281 regression).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTO1_OUTCOME,
  parseAuto1ResultEvidence,
  treatmentForAuto1Outcome,
} from "../auto1-outcome-semantics.mjs";
import { classifyFailure, normalizeEvidence } from "../normalize-evidence.mjs";
import { evaluateLiveObservation } from "../evaluate-live.mjs";
import { collectFromFixture } from "../collect-evidence.mjs";
import { buildNewIssueContent } from "../upsert-incident.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("AUTO-1 outcome table", () => {
  it("maps documented outcomes", () => {
    assert.equal(treatmentForAuto1Outcome(AUTO1_OUTCOME.NO_CHANGE), "no-incident");
    assert.equal(treatmentForAuto1Outcome(AUTO1_OUTCOME.MERGED), "no-incident");
    assert.equal(treatmentForAuto1Outcome(AUTO1_OUTCOME.CONFLICT), "upstream-merge-conflict");
    assert.equal(treatmentForAuto1Outcome("weird"), "needs-triage");
    assert.equal(treatmentForAuto1Outcome(""), null);
  });
});

describe("run 30805433281 shaped conflict", () => {
  it("fixture classifies upstream-merge-conflict not correlation-race", () => {
    const { normalized, expected } = collectFromFixture(
      join(FIXTURES, "auto1-upstream-merge-conflict-30805433281"),
    );
    assert.equal(normalized.openIncident, true);
    assert.equal(normalized.failureClass, expected.failureClass);
    assert.equal(normalized.phase, expected.phase);
    assert.equal(normalized.component, expected.component);
    assert.equal(normalized.terminalStatus, "CONFLICT");
    assert.equal(normalized.instance.auto1Result.upstreamSha, "71ba437cfe41cc6c05f6f80a31a46c53d5b59cd4");
    assert.equal(normalized.instance.auto1Result.prUrl, "https://github.com/Appsolino/Fusion/pull/68");
    assert.deepEqual(normalized.instance.auto1Result.conflictedFiles, [
      "packages/engine/src/executor.ts",
      "scripts/lib/lifecycle-column-census-baseline.json",
    ]);
    assert.equal(normalized.instance.auto1Result.mutatedMain, false);
    assert.equal(normalized.instance.auto1Result.deployedHostD, false);
    const issue = buildNewIssueContent(normalized);
    assert.match(issue.body, /upstream-merge-conflict/);
    assert.match(issue.body, /pull\/68/);
    assert.match(issue.body, /executor\.ts/);
    assert.match(issue.body, /mutatedMain[\s\S]*false/);
    assert.match(issue.body, /deployedHostD[\s\S]*false/);
    assert.ok(!issue.body.includes("correlation-race"));
  });

  it("live evaluate prefers structured conflict over correlation strings", () => {
    const { evidence } = collectFromFixture(
      join(FIXTURES, "auto1-upstream-merge-conflict-30805433281"),
    );
    const n = evaluateLiveObservation({
      workflowName: evidence.workflowName,
      runId: evidence.runId,
      attempt: 1,
      conclusion: "failure",
      expectedSourceSha: evidence.sourceSha,
      logText: evidence.logText,
    });
    assert.equal(n.failureClass, "upstream-merge-conflict");
    assert.equal(n.openIncident, true);
  });
});

describe("correlation strings cannot override outcome=conflict", () => {
  it("negative: handoff / selectCorrelated noise ignored when outcome=conflict", () => {
    const logText = [
      "changedFiles includes .changeset/planning-handoff-outcome.md",
      "noise: selectCorrelated wrong-auto3-child-selected newest-run display_title ISS-AUTO-003",
      JSON.stringify({
        outcome: "conflict",
        conflict: true,
        upstreamSha: "71ba437cfe41cc6c05f6f80a31a46c53d5b59cd4",
        conflictedFiles: [
          "packages/engine/src/executor.ts",
          "scripts/lib/lifecycle-column-census-baseline.json",
        ],
        prUrl: "https://github.com/Appsolino/Fusion/pull/68",
        mutatedMain: false,
        deployedHostD: false,
      }),
    ].join("\n");
    const c = classifyFailure({
      workflowName: "Upstream AUTO-1 Sync",
      workflowFamily: "auto1",
      logText,
      terminalStatus: "FAILED",
    });
    assert.equal(c.failureClass, "upstream-merge-conflict");
    const n = normalizeEvidence({
      workflowName: "Upstream AUTO-1 Sync",
      workflowFamily: "auto1",
      runId: "30805433281",
      logText,
      terminalStatus: "FAILED",
    });
    assert.equal(n.failureClass, "upstream-merge-conflict");
  });
});

describe("AUTO-1 non-incidents", () => {
  it("outcome=merged opens no incident", () => {
    const n = evaluateLiveObservation({
      workflowName: "Upstream AUTO-1 Sync",
      runId: "9",
      conclusion: "success",
      logText: JSON.stringify({ outcome: "merged", conflict: false, mutatedMain: false, deployedHostD: false }),
    });
    assert.equal(n.openIncident, false);
  });

  it("outcome=no-change opens no incident", () => {
    const n = evaluateLiveObservation({
      workflowName: "Upstream AUTO-1 Sync",
      runId: "10",
      conclusion: "success",
      logText: "outcome=no-change\n" + JSON.stringify({ outcome: "no-change" }),
    });
    assert.equal(n.openIncident, false);
  });
});

describe("parseAuto1ResultEvidence", () => {
  it("parses conflictedFiles array", () => {
    const r = parseAuto1ResultEvidence(
      `"conflictedFiles": [\n    "packages/engine/src/executor.ts",\n    "scripts/lib/lifecycle-column-census-baseline.json"\n  ],\n  "outcome": "conflict"`,
    );
    assert.equal(r.outcome, "conflict");
    assert.equal(r.conflictedFiles.length, 2);
  });
});

describe("reconcile recovers AUTO-1 conflicts", () => {
  it("evaluateLiveObservation on failed AUTO-1 with outcome=conflict is candidate-shaped", async () => {
    const { executeLiveReconcile } = await import("../run-live-reconcile.mjs");
    const conflictLog = JSON.stringify({
      outcome: "conflict",
      conflict: true,
      upstreamSha: "71ba437cfe41cc6c05f6f80a31a46c53d5b59cd4",
      conflictedFiles: [
        "packages/engine/src/executor.ts",
        "scripts/lib/lifecycle-column-census-baseline.json",
      ],
      prUrl: "https://github.com/Appsolino/Fusion/pull/68",
      mutatedMain: false,
      deployedHostD: false,
    });
    const payload = executeLiveReconcile({
      repo: "Appsolino/Fusion",
      nowMs: Date.parse("2026-08-03T12:00:00Z"),
      listRuns: () => ({
        ok: true,
        data: {
          workflow_runs: [
            {
              id: 30805433281,
              name: "Upstream AUTO-1 Sync",
              status: "completed",
              conclusion: "failure",
              head_sha: "b83fd0eda83b1760b441454f852b8564f954bdf4",
              run_attempt: 1,
            },
          ],
        },
      }),
      listAuto3Dispatch: () => ({ ok: true, data: { workflow_runs: [] } }),
      downloadEvidence: () => null,
      fetchRunLog: () => conflictLog,
    });
    assert.equal(payload.once.auto1CandidateCount, 1);
    assert.equal(payload.candidates.length, 1);
    assert.equal(payload.candidates[0].failureClass, "upstream-merge-conflict");
    assert.equal(payload.candidates[0].instance.auto1Result.prUrl, "https://github.com/Appsolino/Fusion/pull/68");
  });
});
