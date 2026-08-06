#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:HostDTrust 2026-08-06: unit tests for durable trust-cycle controller.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTrustAuto3Result,
  decideNextTrustAction,
  findInProgressTrustRuns,
  isTrustProgrammeRun,
  executeTrustDecision,
} from "../host-d-trust-cycle.mjs";

describe("host-d-trust-cycle discovery", () => {
  it("recognizes trust handoff titles only", () => {
    assert.equal(isTrustProgrammeRun({ displayTitle: "AUTO-3 trust-c1-proof aa111 proof" }), true);
    assert.equal(isTrustProgrammeRun({ displayTitle: "AUTO-3 auto2-30705071215 staging" }), false);
  });

  it("finds in-progress trust runs and ignores completed", () => {
    const runs = [
      { databaseId: 1, status: "in_progress", displayTitle: "AUTO-3 trust-x proof" },
      { databaseId: 2, status: "completed", displayTitle: "AUTO-3 trust-y staging" },
      { databaseId: 3, status: "queued", displayTitle: "AUTO-3 other staging" },
    ];
    const inflight = findInProgressTrustRuns(runs);
    assert.equal(inflight.length, 1);
    assert.equal(inflight[0].databaseId, 1);
  });
});

describe("classifyTrustAuto3Result", () => {
  it("PASS deliberate proof ROLLED_BACK with restoration", () => {
    const c = classifyTrustAuto3Result({
      profile: "proof",
      forceSmokeFail: true,
      evidence: {
        terminal: "ROLLED_BACK",
        previousReleaseRestored: true,
        hostPAccessed: false,
      },
      liveHealthOk: true,
      liveEnginePaused: true,
    });
    assert.equal(c.pass, true);
    assert.equal(c.reason, "proof-rollback-restored");
  });

  it("PASS staging DEPLOYED with complete physical fields", () => {
    const c = classifyTrustAuto3Result({
      profile: "staging",
      evidence: {
        terminal: "DEPLOYED",
        health: "ok",
        enginePaused: true,
        hostPAccessed: false,
        completeness: { complete: true, needsEvidence: false },
      },
    });
    assert.equal(c.pass, true);
  });

  it("CRITICAL if hostPAccessed", () => {
    const c = classifyTrustAuto3Result({
      evidence: { terminal: "DEPLOYED", hostPAccessed: true, health: "ok", enginePaused: true },
    });
    assert.equal(c.pass, false);
    assert.equal(c.severity, "CRITICAL");
  });
});

describe("decideNextTrustAction", () => {
  const baseLedger = {
    hostP: "PROHIBITED",
    hostPAccessCount: 0,
    counters: {
      stagingDeploysPass: 1,
      proofRollbacksPass: 1,
      backupRestorePass: 1,
      requiredStagingDeploys: 3,
      requiredProofRollbacks: 2,
      requiredBackupRestores: 2,
    },
  };

  it("waits when a trust AUTO-3 is in progress (no duplicate dispatch)", () => {
    const d = decideNextTrustAction({
      ledger: baseLedger,
      runs: [{ databaseId: 9, status: "in_progress", displayTitle: "AUTO-3 trust-foo proof" }],
    });
    assert.equal(d.action, "wait-existing");
    assert.deepEqual(d.runIds, [9]);
  });

  it("prefers second backup/restore before more AUTO-3", () => {
    const d = decideNextTrustAction({ ledger: baseLedger, runs: [] });
    assert.equal(d.action, "local-backup-restore");
  });

  it("dispatches proof rollback when backup quota met", () => {
    const d = decideNextTrustAction({
      ledger: {
        ...baseLedger,
        counters: { ...baseLedger.counters, backupRestorePass: 2 },
      },
      runs: [],
    });
    assert.equal(d.action, "dispatch-proof-rollback");
    assert.equal(d.force_smoke_fail, true);
  });

  it("soaks when quotas met", () => {
    const d = decideNextTrustAction({
      ledger: {
        ...baseLedger,
        counters: {
          stagingDeploysPass: 3,
          proofRollbacksPass: 2,
          backupRestorePass: 2,
          requiredStagingDeploys: 3,
          requiredProofRollbacks: 2,
          requiredBackupRestores: 2,
        },
        trustWindow: { startedUtc: "2026-08-06T06:24:10Z" },
      },
      runs: [],
    });
    assert.equal(d.action, "soak-observe");
  });
});

describe("executeTrustDecision dry-run default", () => {
  it("does not dispatch when dryRun default", () => {
    const out = executeTrustDecision(
      { action: "dispatch-staging-deploy", profile: "staging", force_smoke_fail: false },
      { dryRun: true, mainSha: "a".repeat(40) },
    );
    assert.equal(out.dispatched, false);
    assert.equal(out.wouldDispatch, true);
  });
});
