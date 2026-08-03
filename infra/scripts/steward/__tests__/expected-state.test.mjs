#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-03:
 * Expected-state classification: skipped validation and no-child finalize actions.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveObservation } from "../evaluate-live.mjs";
import { buildHandoffsFromRuns } from "../build-handoffs.mjs";
import { reconcileRuns } from "../reconcile-runs.mjs";
import {
  AUTO2_ACTION_EXPECTED_CHILD,
  expectedAuto3ChildForAction,
  parseAuto2FinalizeEvidence,
} from "../auto2-action-semantics.mjs";

describe("AUTO-2 action → expectedAuto3Child table", () => {
  it("maps every documented finalize action", () => {
    for (const [action, expected] of Object.entries(AUTO2_ACTION_EXPECTED_CHILD)) {
      assert.equal(expectedAuto3ChildForAction(action), expected, action);
    }
    assert.equal(expectedAuto3ChildForAction("totally-new"), null);
  });
});

describe("expected non-incident live observation", () => {
  it("normal maintenance PR → AUTO-2 validate skipped → no incident", () => {
    const n = evaluateLiveObservation({
      workflowName: "Upstream AUTO-2 Validate",
      runId: "30802700369",
      attempt: 1,
      conclusion: "skipped",
      expectedSourceSha: "939ea7aee892fb1b847a2f6e321547645b8b0261",
      logText: "branch not automation/upstream-* — validate skipped",
    });
    assert.equal(n.openIncident, false);
    assert.equal(n.terminalStatus, "SKIPPED");
  });

  it("docs PR → finalizer ignored → no incident", () => {
    const n = evaluateLiveObservation({
      workflowName: "Upstream AUTO-2 Finalize",
      runId: "1",
      attempt: 1,
      conclusion: "success",
      parentRunId: "1",
      parentConclusion: "success",
      logText: JSON.stringify({
        action: "ignored",
        reason: "non-automation / non-proof head ref",
      }),
    });
    assert.equal(n.openIncident, false);
  });

  it("sensitive upstream PR → approval-required → no missing-child incident", () => {
    const n = evaluateLiveObservation({
      workflowName: "Upstream AUTO-2 Finalize",
      runId: "2",
      attempt: 1,
      conclusion: "success",
      parentRunId: "2",
      parentConclusion: "success",
      logText: JSON.stringify({
        action: "approval-required",
        reason: "sensitive — one owner approval required",
      }),
    });
    assert.equal(n.openIncident, false);
  });

  it("expected handoff with child BLOCKED → parent-child-disagreement", () => {
    const n = evaluateLiveObservation({
      workflowName: "Upstream AUTO-2 Finalize",
      runId: "3",
      attempt: 1,
      conclusion: "success",
      parentRunId: "3",
      parentConclusion: "success",
      childRunId: "4",
      childConclusion: "failure",
      childStatus: "completed",
      logText: JSON.stringify({
        action: "auto-merged-deployed",
        auto3: { handoffId: "auto2-3-1-aaaa-bbbb", auto3RunId: "4", status: "BLOCKED" },
      }),
      evidenceArtifact: { terminal: "BLOCKED" },
    });
    assert.equal(n.openIncident, true);
    assert.equal(n.failureClass, "parent-child-disagreement");
  });

  it("unknown action → needs-triage", () => {
    const n = evaluateLiveObservation({
      workflowName: "Upstream AUTO-2 Finalize",
      runId: "5",
      attempt: 1,
      conclusion: "success",
      parentRunId: "5",
      logText: JSON.stringify({ action: "brand-new-action" }),
    });
    assert.equal(n.openIncident, true);
    assert.equal(n.failureClass, "needs-triage");
  });
});

describe("handoff build respects finalize action", () => {
  it("approval-required does not synthesize missing-child after timeout", () => {
    const handoffs = buildHandoffsFromRuns({
      auto2Runs: [
        {
          id: 10,
          name: "Upstream AUTO-2 Finalize",
          status: "completed",
          conclusion: "success",
          created_at: "2026-08-01T12:00:00Z",
          updated_at: "2026-08-01T12:01:00Z",
          head_sha: "cccccccccccccccccccccccccccccccccccccccc",
        },
      ],
      auto3Runs: [],
      logsByRunId: {
        "10": JSON.stringify({
          action: "approval-required",
          reason: "sensitive — one owner approval required",
        }),
      },
    });
    assert.equal(handoffs[0].expectedAuto3Child, false);
    const r = reconcileRuns({
      nowMs: Date.parse("2026-08-01T17:00:00Z"),
      missingChildTimeoutMs: 45 * 60 * 1000,
      handoffs,
    });
    assert.equal(r.candidateCount, 0);
  });

  it("parseAuto2FinalizeEvidence reads summary and JSON shapes", () => {
    const a = parseAuto2FinalizeEvidence("- action: `ignored`\n- handoff_id: `n/a`");
    assert.equal(a.action, "ignored");
    assert.equal(a.expectedAuto3Child, false);
    const b = parseAuto2FinalizeEvidence('"action":"auto-merged-deployed","auto3":{"handoffId":"auto2-x"}');
    assert.equal(b.action, "auto-merged-deployed");
    assert.equal(b.handoffId, "auto2-x");
    assert.equal(b.expectedAuto3Child, true);
  });
});
