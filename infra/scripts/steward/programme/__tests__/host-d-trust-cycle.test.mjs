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
  resolveTrustCounters,
  resolveControllerExecutionMode,
  hasCriticalFreeze,
  buildDispatchKey,
  refineSkippedDecision,
  recordStagingDeployPass,
  applyClassifiedRunToLedger,
  mergeLedgerOverlay,
} from "../host-d-trust-cycle.mjs";

const TIP = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

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

describe("resolveControllerExecutionMode", () => {
  it("schedule forces execute-next with execute=true (cron dispatches when eligible)", () => {
    const m = resolveControllerExecutionMode({ eventName: "schedule" });
    assert.equal(m.mode, "execute-next");
    assert.equal(m.execute, true);
    assert.equal(m.shouldExecute, true);
  });

  it("manual reconcile-only never executes", () => {
    const m = resolveControllerExecutionMode({
      eventName: "workflow_dispatch",
      executeInput: true,
      modeInput: "reconcile-only",
    });
    assert.equal(m.mode, "reconcile-only");
    assert.equal(m.execute, false);
    assert.equal(m.shouldExecute, false);
  });

  it("manual decide stays dry", () => {
    const m = resolveControllerExecutionMode({
      eventName: "workflow_dispatch",
      executeInput: false,
      modeInput: "decide",
    });
    assert.equal(m.shouldExecute, false);
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

  it("incomplete evidence is needs-evidence (not another deployment)", () => {
    const c = classifyTrustAuto3Result({
      profile: "staging",
      evidence: {
        terminal: "DEPLOYED",
        health: "ok",
        enginePaused: true,
        completeness: { complete: false, needsEvidence: true },
      },
    });
    assert.equal(c.needsEvidence, true);
    assert.equal(c.pass, false);
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

  it("waits when a trust AUTO-3 is in progress (cron does not dispatch)", () => {
    const d = decideNextTrustAction({
      ledger: baseLedger,
      runs: [{ databaseId: 9, status: "in_progress", displayTitle: "AUTO-3 trust-foo proof" }],
      mainSha: TIP,
    });
    assert.equal(d.action, "wait-existing");
    assert.deepEqual(d.runIds, [9]);
  });

  it("prefers second backup/restore before more AUTO-3", () => {
    const d = decideNextTrustAction({ ledger: baseLedger, runs: [], mainSha: TIP });
    assert.equal(d.action, "local-backup-restore");
  });

  it("dispatches proof rollback when backup quota met", () => {
    const d = decideNextTrustAction({
      ledger: {
        ...baseLedger,
        counters: { ...baseLedger.counters, backupRestorePass: 2 },
      },
      runs: [],
      mainSha: TIP,
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
      mainSha: TIP,
    });
    assert.equal(d.action, "soak-observe");
  });

  it("CRITICAL freeze blocks dispatch", () => {
    const d = decideNextTrustAction({
      ledger: {
        ...baseLedger,
        counters: { ...baseLedger.counters, backupRestorePass: 2 },
        freezeDestructive: true,
      },
      runs: [],
      mainSha: TIP,
    });
    assert.equal(d.action, "stop-critical");
  });

  it("Host P boundary blocks dispatch", () => {
    assert.equal(hasCriticalFreeze({ hostP: "PROHIBITED", hostPAccessCount: 1 }), true);
    const d = decideNextTrustAction({
      ledger: {
        ...baseLedger,
        hostPAccessCount: 1,
        counters: { ...baseLedger.counters, backupRestorePass: 2 },
      },
      runs: [],
      mainSha: TIP,
    });
    assert.equal(d.action, "stop-critical");
  });

  it("incomplete evidence causes reconcile-needs-evidence, not another deployment", () => {
    const d = decideNextTrustAction({
      ledger: {
        ...baseLedger,
        counters: { ...baseLedger.counters, backupRestorePass: 2, proofRollbacksPass: 2 },
        needsEvidence: { runId: 1, reason: "needs-evidence" },
      },
      runs: [],
      mainSha: TIP,
    });
    assert.equal(d.action, "reconcile-needs-evidence");
  });

  it("does not duplicate a completed or already-dispatched test for same head", () => {
    const key = buildDispatchKey(
      { action: "dispatch-staging-deploy", profile: "staging" },
      TIP,
    );
    const d = decideNextTrustAction({
      ledger: {
        ...baseLedger,
        counters: {
          stagingDeploysPass: 1,
          proofRollbacksPass: 2,
          backupRestorePass: 2,
          requiredStagingDeploys: 3,
          requiredProofRollbacks: 2,
          requiredBackupRestores: 2,
        },
        dispatchedKeys: [key],
      },
      runs: [],
      mainSha: TIP,
    });
    assert.equal(d.action, "skip-duplicate");
    const refined = refineSkippedDecision(d, {
      counters: {
        stagingDeploysPass: 1,
        proofRollbacksPass: 2,
        backupRestorePass: 2,
        requiredStagingDeploys: 3,
        requiredProofRollbacks: 2,
        requiredBackupRestores: 2,
      },
    }, TIP);
    assert.equal(refined.action, "wait-tip-or-reconcile");
  });
});

describe("executeTrustDecision", () => {
  it("does not dispatch when dryRun default", () => {
    const out = executeTrustDecision(
      { action: "dispatch-staging-deploy", profile: "staging", force_smoke_fail: false },
      { dryRun: true, mainSha: TIP },
    );
    assert.equal(out.dispatched, false);
    assert.equal(out.wouldDispatch, true);
    assert.equal(out.childCount, 0);
  });

  it("dispatches at most one child and checkpoints before dispatch", () => {
    /** @type {object[]} */
    const calls = [];
    /** @type {object[]} */
    const checkpoints = [];
    const out = executeTrustDecision(
      {
        action: "dispatch-staging-deploy",
        profile: "staging",
        force_smoke_fail: false,
        dispatchKey: buildDispatchKey({ action: "dispatch-staging-deploy", profile: "staging" }, TIP),
      },
      {
        dryRun: false,
        mainSha: TIP,
        beforeDispatch: (cp) => checkpoints.push(cp),
        gh: (cmd, args) => {
          calls.push({ cmd, args });
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    );
    assert.equal(out.dispatched, true);
    assert.equal(out.childCount, 1);
    assert.equal(calls.length, 1);
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0].status, "checkpointed");
    assert.ok(checkpoints[0].handoffId);
  });
});

describe("resolveTrustCounters", () => {
  it("takes max Pass counts when top-level and trustWindow disagree", () => {
    const c = resolveTrustCounters({
      counters: { proofRollbacksPass: 1, backupRestorePass: 2, requiredProofRollbacks: 2 },
      trustWindow: { counters: { proofRollbacksPass: 2, backupRestorePass: 1, requiredProofRollbacks: 2 } },
    });
    assert.equal(c.proofRollbacksPass, 2);
    assert.equal(c.backupRestorePass, 2);
  });

  it("falls back to trustWindow.counters when top-level missing", () => {
    const c = resolveTrustCounters({
      trustWindow: { counters: { proofRollbacksPass: 2, requiredProofRollbacks: 2 } },
    });
    assert.equal(c.proofRollbacksPass, 2);
  });
});

describe("recordStagingDeployPass / applyClassifiedRunToLedger", () => {
  it("increments stagingDeploysPass once per run id", () => {
    let ledger = {
      counters: {
        stagingDeploysPass: 1,
        proofRollbacksPass: 2,
        backupRestorePass: 2,
        requiredStagingDeploys: 3,
      },
      auto3Runs: [],
    };
    ledger = recordStagingDeployPass(ledger, {
      id: 31090853566,
      sourceSha: "351bc8d2ad7985dfb82f2b64727d44f7ec4a3a2e",
      releaseId: "auto3-0.75.1-beta.1-351bc8d2ad79",
      terminal: "DEPLOYED",
    });
    assert.equal(resolveTrustCounters(ledger).stagingDeploysPass, 2);
    ledger = recordStagingDeployPass(ledger, {
      id: 31090853566,
      sourceSha: "351bc8d2ad7985dfb82f2b64727d44f7ec4a3a2e",
      releaseId: "auto3-0.75.1-beta.1-351bc8d2ad79",
      terminal: "DEPLOYED",
    });
    assert.equal(resolveTrustCounters(ledger).stagingDeploysPass, 2);
  });

  it("CRITICAL classification freezes further destructive testing", () => {
    const ledger = applyClassifiedRunToLedger(
      { counters: { stagingDeploysPass: 1 }, auto3Runs: [], hostPAccessCount: 0 },
      {
        id: 1,
        profile: "staging",
        classification: { pass: false, severity: "CRITICAL", reason: "host-p-accessed" },
        evidence: { terminal: "DEPLOYED", hostPAccessed: true },
      },
    );
    assert.equal(ledger.freezeDestructive, true);
    assert.ok(hasCriticalFreeze(ledger));
  });

  it("needs-evidence overlay blocks redeploy via merge", () => {
    const base = { counters: { stagingDeploysPass: 1 }, auto3Runs: [] };
    const classified = applyClassifiedRunToLedger(base, {
      id: 2,
      profile: "staging",
      classification: { pass: false, severity: "MEDIUM", reason: "needs-evidence", needsEvidence: true },
      evidence: { terminal: "DEPLOYED", completeness: { needsEvidence: true } },
    });
    const merged = mergeLedgerOverlay(base, classified);
    const d = decideNextTrustAction({ ledger: merged, runs: [], mainSha: TIP });
    assert.equal(d.action, "reconcile-needs-evidence");
  });
});
