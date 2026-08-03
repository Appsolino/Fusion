#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Reconciliation detects parent/child mismatch, missing child, and stays idempotent.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcileRuns, mergeCandidatesIdempotent } from "../reconcile-runs.mjs";

describe("reconciliation", () => {
  it("detects parent/child terminal disagreement", () => {
    const r = reconcileRuns({
      nowMs: Date.parse("2026-08-01T16:00:00Z"),
      handoffs: [
        {
          parentRunId: "30705071215",
          parentTerminal: "DEPLOYED",
          childRunId: "30705088925",
          childTerminal: "BLOCKED",
          handoffId: "auto2-x",
          sourceSha: "16f24ed3b47321cc1b5aa693b2fac7e13a00b379",
        },
      ],
    });
    assert.equal(r.candidateCount, 1);
    assert.equal(r.candidates[0].failureClass, "parent-child-disagreement");
  });

  it("detects missing child after timeout", () => {
    const r = reconcileRuns({
      nowMs: Date.parse("2026-08-01T17:00:00Z"),
      missingChildTimeoutMs: 45 * 60 * 1000,
      handoffs: [
        {
          parentRunId: "30800000001",
          parentTerminal: "DEPLOYED",
          expectedAuto3Child: true,
          handoffId: "auto2-30800000001-1-aaaaaaaa-bbbb",
          childRunId: null,
          childTerminal: null,
          claimedAt: "2026-08-01T16:00:00Z",
        },
      ],
    });
    assert.equal(r.candidateCount, 1);
    assert.equal(r.candidates[0].failureClass, "missing-child-timeout");
  });

  it("does not flag missing child before timeout", () => {
    const r = reconcileRuns({
      nowMs: Date.parse("2026-08-01T16:10:00Z"),
      missingChildTimeoutMs: 45 * 60 * 1000,
      handoffs: [
        {
          parentRunId: "30800000001",
          parentTerminal: "DEPLOYED",
          expectedAuto3Child: true,
          handoffId: "auto2-30800000001-1-aaaaaaaa-bbbb",
          claimedAt: "2026-08-01T16:00:00Z",
        },
      ],
    });
    assert.equal(r.candidateCount, 0);
  });

  it("ignores approval-required and ignored parents (no AUTO-3 expected)", () => {
    const r = reconcileRuns({
      nowMs: Date.parse("2026-08-01T17:00:00Z"),
      missingChildTimeoutMs: 45 * 60 * 1000,
      handoffs: [
        {
          parentRunId: "1",
          parentTerminal: "APPROVAL_REQUIRED",
          finalizeAction: "approval-required",
          expectedAuto3Child: false,
          childRunId: null,
          claimedAt: "2026-08-01T16:00:00Z",
        },
        {
          parentRunId: "2",
          parentTerminal: "IGNORED",
          finalizeAction: "ignored",
          expectedAuto3Child: false,
          childRunId: null,
          claimedAt: "2026-08-01T16:00:00Z",
        },
      ],
    });
    assert.equal(r.candidateCount, 0);
  });

  it("unknown finalize action becomes needs-triage not missing-child", () => {
    const r = reconcileRuns({
      nowMs: Date.parse("2026-08-01T17:00:00Z"),
      handoffs: [
        {
          parentRunId: "9",
          parentTerminal: "UNKNOWN",
          finalizeAction: "future-action-xyz",
          expectedAuto3Child: null,
          childRunId: null,
          claimedAt: "2026-08-01T16:00:00Z",
        },
      ],
    });
    assert.equal(r.candidateCount, 1);
    assert.equal(r.candidates[0].failureClass, "needs-triage");
  });

  it("successful recent runs create no incidents", () => {
    const r = reconcileRuns({
      recentRuns: [
        {
          id: 30705532077,
          name: "Upstream AUTO-3 Deploy",
          status: "completed",
          conclusion: "success",
          run_attempt: 1,
        },
      ],
    });
    assert.equal(r.candidateCount, 0);
  });

  it("reconciliation is idempotent", () => {
    const input = {
      nowMs: Date.parse("2026-08-01T17:00:00Z"),
      handoffs: [
        {
          parentRunId: "30705071215",
          parentTerminal: "DEPLOYED",
          childRunId: "30705088925",
          childTerminal: "BLOCKED",
        },
      ],
    };
    const a = reconcileRuns(input);
    const b = reconcileRuns(input);
    const merged = mergeCandidatesIdempotent(a.candidates, b.candidates);
    assert.equal(merged.length, 1);
    assert.equal(a.candidates[0].instance.occurrenceId, b.candidates[0].instance.occurrenceId);
  });
});
