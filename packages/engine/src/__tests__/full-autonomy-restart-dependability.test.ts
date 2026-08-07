/**
 * FNXC:FullAutonomy 2026-08-07-21:21:
 * CI failure evidence + repair-run + restart-state dependability tests.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildCiFailureEvidence,
  buildCiRepairAgentPrompt,
  parseCiRepairAgentVerdict,
  fingerprintCiFailure,
} from "../merge/ci-failure-evidence.js";
import { decideCiRepairAction } from "../merge/ci-repair.js";
import { runCiRepairRun } from "../merge/ci-repair-run.js";
import type { PrEntity } from "@fusion/core";

function entity(partial: Partial<PrEntity> = {}): PrEntity {
  return {
    id: "pre-1",
    sourceType: "task",
    sourceId: "FN-1",
    repo: "Appsolino/Fusion",
    headBranch: "fusion/FN-1",
    state: "open",
    autoMerge: true,
    unverified: false,
    responseRounds: 0,
    createdAt: 1,
    updatedAt: 1,
    checksRollup: "failure",
    headOid: "abc123",
    ...partial,
  };
}

describe("ci failure evidence", () => {
  it("extracts annotations and fingerprints failures", () => {
    const evidence = buildCiFailureEvidence({
      headOid: "abc123",
      checkRuns: [
        {
          name: "Lint",
          conclusion: "success",
        },
        {
          name: "Typecheck",
          conclusion: "failure",
          output: { title: "tsc failed", summary: "error TS2304: Cannot find name" },
          annotations: [{ path: "src/a.ts", startLine: 10, message: "Cannot find name 'x'" }],
        },
      ],
    });
    expect(evidence.failedChecks.map((c) => c.name)).toEqual(["Typecheck"]);
    expect(evidence.combinedLogExcerpt).toContain("TS2304");
    expect(evidence.failureClass).toBe("deterministic");
    expect(evidence.fingerprint).toHaveLength(24);
  });

  it("builds untrusted-delimited repair prompt", () => {
    const evidence = buildCiFailureEvidence({
      headOid: "abc",
      checkRuns: [{ name: "Gate", conclusion: "failure", logExcerpt: "vitest failing" }],
    });
    const { systemPrompt, prompt } = buildCiRepairAgentPrompt(evidence);
    expect(systemPrompt).toContain("untrusted");
    expect(prompt).toContain("<ci-failure-evidence>");
    expect(prompt).toContain("vitest failing");
  });

  it("parses CI_REPAIR verdict markers", () => {
    expect(parseCiRepairAgentVerdict("done\nCI_REPAIR: fixed lint error")).toBe("fixed");
    expect(parseCiRepairAgentVerdict("CI_REPAIR: blocked infra outage")).toBe("blocked");
    expect(parseCiRepairAgentVerdict("no marker")).toBe("blocked");
  });
});

describe("decideCiRepairAction fingerprints", () => {
  it("exhausts on identical fingerprint after an attempt", () => {
    const fp = fingerprintCiFailure({
      checkNames: ["Lint"],
      logExcerpt: "eslint error",
      headOid: "h1",
    });
    expect(
      decideCiRepairAction({
        checksRollup: "failure",
        failureClass: "deterministic",
        attemptCount: 1,
        headOid: "h2",
        lastRepairedHeadOid: "h1",
        failureFingerprint: fp,
        lastFailureFingerprint: fp,
      }).action,
    ).toBe("exhausted");
  });
});

describe("runCiRepairRun", () => {
  it("repairs, pushes, and stamps fingerprints", async () => {
    const evidence = buildCiFailureEvidence({
      headOid: "abc123",
      checkRuns: [
        { name: "Lint", conclusion: "failure", logExcerpt: "error TS2304: Cannot find name Foo" },
      ],
    });
    const result = await runCiRepairRun({
      entity: entity({ responseRounds: 0 }),
      evidence,
      attemptCount: 0,
      runAgent: async () => ({ text: "CI_REPAIR: fixed missing import" }),
      push: async () => ({ status: "pushed", sha: "def456" }),
      audit: vi.fn(),
    });
    expect(result.value).toBe("fixed");
    expect(result.contextPatch?.lastRepairedHeadOid).toBe("def456");
    expect(result.contextPatch?.lastFailureFingerprint).toBe(evidence.fingerprint);
  });

  it("does not push when budget exhausted", async () => {
    const push = vi.fn();
    const evidence = buildCiFailureEvidence({
      headOid: "abc123",
      checkRuns: [{ name: "Lint", conclusion: "failure", logExcerpt: "error TS2304" }],
    });
    const result = await runCiRepairRun({
      entity: entity({ responseRounds: 3 }),
      evidence,
      attemptCount: 3,
      maxAttempts: 3,
      runAgent: async () => ({ text: "CI_REPAIR: fixed" }),
      push,
    });
    expect(result.value).toBe("exhausted");
    expect(push).not.toHaveBeenCalled();
  });
});

/**
 * Pure restart convergence model — durable fields only, no wall-clock sleeps.
 * Simulates reconciliation after process death at key lifecycle points.
 */
type AutonomyPhase =
  | "claimed"
  | "implementing"
  | "validating"
  | "waiting_for_ci"
  | "repairing_ci"
  | "waiting_for_merge"
  | "merged_remote"
  | "completed";

interface DurableAutonomyState {
  phase: AutonomyPhase;
  claimOwner?: string | null;
  executionId?: string | null;
  workspaceId?: string | null;
  prNumber?: number | null;
  checksRollup?: "pending" | "failure" | "success" | null;
  ciRepairAttempts?: number;
  lastRepairedHeadOid?: string | null;
  mergeShaRemote?: string | null;
  completedLocal?: boolean;
}

function reconcileAfterRestart(state: DurableAutonomyState): DurableAutonomyState {
  const next = { ...state };
  // Dead worker: clear claim if no live execution proof (simulated by missing executionId).
  if (next.claimOwner && !next.executionId && next.phase === "claimed") {
    next.claimOwner = null;
    next.phase = "claimed"; // re-dispatch eligible
  }
  if (next.phase === "implementing" && !next.executionId) {
    next.claimOwner = null;
    next.phase = "claimed";
  }
  if (next.phase === "validating" && !next.executionId) {
    next.phase = "validating"; // resume validation without new claim owner
    next.claimOwner = "reconciler";
    next.executionId = "resume-validate";
  }
  if (next.phase === "waiting_for_ci") {
    // Reuse PR; resume monitoring
    next.executionId = "ci-watch";
    next.claimOwner = "reconciler";
  }
  if (next.phase === "repairing_ci") {
    next.executionId = "ci-repair";
    next.claimOwner = "reconciler";
    next.ciRepairAttempts = next.ciRepairAttempts ?? 0;
  }
  if (next.phase === "waiting_for_merge" && next.checksRollup === "success") {
    next.executionId = "merge-wait";
  }
  if (next.phase === "merged_remote" && next.mergeShaRemote && !next.completedLocal) {
    next.phase = "completed";
    next.completedLocal = true;
    next.claimOwner = null;
    next.workspaceId = null;
    next.executionId = null;
  }
  // Leaked workspace after completion
  if (next.phase === "completed") {
    next.workspaceId = null;
    next.claimOwner = null;
  }
  return next;
}

describe("restart reconciliation (pure)", () => {
  it("claimed-before-start: releases stale claim", () => {
    const after = reconcileAfterRestart({
      phase: "claimed",
      claimOwner: "dead-worker",
      executionId: null,
      workspaceId: "wt-1",
    });
    expect(after.claimOwner).toBeNull();
  });

  it("active worker crash: returns to claimed without duplicate PR", () => {
    const after = reconcileAfterRestart({
      phase: "implementing",
      claimOwner: "w1",
      executionId: null,
      prNumber: 42,
      workspaceId: "wt-1",
    });
    expect(after.phase).toBe("claimed");
    expect(after.prNumber).toBe(42);
    expect(after.claimOwner).toBeNull();
  });

  it("validation interruption: resumes validation", () => {
    const after = reconcileAfterRestart({
      phase: "validating",
      claimOwner: "w1",
      executionId: null,
    });
    expect(after.executionId).toBe("resume-validate");
    expect(after.phase).toBe("validating");
  });

  it("waiting-for-CI restart: keeps PR and resumes watch", () => {
    const after = reconcileAfterRestart({
      phase: "waiting_for_ci",
      prNumber: 7,
      checksRollup: "pending",
      claimOwner: "w1",
      executionId: null,
    });
    expect(after.prNumber).toBe(7);
    expect(after.executionId).toBe("ci-watch");
  });

  it("CI-repair restart: resumes repair with attempt count preserved", () => {
    const after = reconcileAfterRestart({
      phase: "repairing_ci",
      prNumber: 7,
      checksRollup: "failure",
      ciRepairAttempts: 1,
      lastRepairedHeadOid: null,
      executionId: null,
    });
    expect(after.executionId).toBe("ci-repair");
    expect(after.ciRepairAttempts).toBe(1);
  });

  it("green-PR-before-merge restart: resumes merge wait", () => {
    const after = reconcileAfterRestart({
      phase: "waiting_for_merge",
      prNumber: 7,
      checksRollup: "success",
      executionId: null,
    });
    expect(after.executionId).toBe("merge-wait");
  });

  it("merge succeeded remotely but local completion lost: completes once", () => {
    const after = reconcileAfterRestart({
      phase: "merged_remote",
      mergeShaRemote: "deadbeef",
      completedLocal: false,
      claimOwner: "w1",
      workspaceId: "wt-1",
      prNumber: 7,
    });
    expect(after.phase).toBe("completed");
    expect(after.completedLocal).toBe(true);
    expect(after.workspaceId).toBeNull();
    expect(after.claimOwner).toBeNull();
    // Idempotent second reconcile
    const again = reconcileAfterRestart(after);
    expect(again.phase).toBe("completed");
    expect(again.workspaceId).toBeNull();
  });

  it("leaked worktree after completion is cleared", () => {
    const after = reconcileAfterRestart({
      phase: "completed",
      completedLocal: true,
      workspaceId: "leaked-wt",
      claimOwner: "stale",
    });
    expect(after.workspaceId).toBeNull();
    expect(after.claimOwner).toBeNull();
  });
});
