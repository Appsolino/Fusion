#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamPatchReconcile 2026-08-07-06:20:
 * Deterministic coverage for UPSTREAM_FIXED conflict auto-resolution.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideUpstreamFixedConflictResolution } from "../resolve-upstream-fixed-conflicts.mjs";

const FIXTURE = "packages/dashboard/app/task-modal-touch-resize-e2e-fixture.tsx";

describe("decideUpstreamFixedConflictResolution", () => {
  it("takes upstream when FIX-LANE-WIRING-TOUCH-FIXTURE is retired UPSTREAM_FIXED", () => {
    const r = decideUpstreamFixedConflictResolution({
      conflictedFiles: [FIXTURE],
      patches: [
        {
          id: "FIX-LANE-WIRING-TOUCH-FIXTURE",
          status: "ACTIVE",
          localAction: { applyPaths: [FIXTURE] },
        },
      ],
      reconcileResults: [
        {
          patchId: "FIX-LANE-WIRING-TOUCH-FIXTURE",
          action: "RETIRE",
          classification: "UPSTREAM_FIXED",
          regressionPassed: true,
        },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.action, "TAKE_UPSTREAM");
    assert.deepEqual(r.takeUpstreamFiles, [FIXTURE]);
    assert.ok(r.retiredPatchIds.includes("FIX-LANE-WIRING-TOUCH-FIXTURE"));
  });

  it("leaves conflict when regression did not pass", () => {
    const r = decideUpstreamFixedConflictResolution({
      conflictedFiles: [FIXTURE],
      patches: [
        {
          id: "FIX-LANE-WIRING-TOUCH-FIXTURE",
          status: "ACTIVE",
          localAction: { applyPaths: [FIXTURE] },
        },
      ],
      reconcileResults: [
        {
          patchId: "FIX-LANE-WIRING-TOUCH-FIXTURE",
          action: "RETAIN_OR_ADAPT",
          classification: "APPSOLINO_ONLY",
          regressionPassed: false,
        },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(r.action, "LEAVE_CONFLICT");
  });

  it("leaves conflict when an uncovered path is present", () => {
    const r = decideUpstreamFixedConflictResolution({
      conflictedFiles: [FIXTURE, "packages/engine/src/other.ts"],
      patches: [
        {
          id: "FIX-LANE-WIRING-TOUCH-FIXTURE",
          status: "ACTIVE",
          localAction: { applyPaths: [FIXTURE] },
        },
      ],
      reconcileResults: [
        {
          patchId: "FIX-LANE-WIRING-TOUCH-FIXTURE",
          action: "RETIRE",
          classification: "UPSTREAM_FIXED",
          regressionPassed: true,
        },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(r.action, "LEAVE_CONFLICT");
    assert.ok(r.uncoveredFiles.includes("packages/engine/src/other.ts"));
  });
});
