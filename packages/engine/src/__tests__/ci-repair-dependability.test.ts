/**
 * FNXC:FullAutonomy 2026-08-07-21:04:
 * Dependability suite seed — CI repair decisions + checks transition releases.
 */
import { describe, expect, it, vi } from "vitest";
import {
  classifyCiFailureEvidence,
  decideCiRepairAction,
  autoMergeGateCiFailedValue,
  DEFAULT_CI_REPAIR_MAX_ATTEMPTS,
} from "../merge/ci-repair.js";
import { deriveTransitions } from "../merge/pr-reconcile.js";
import { createAutoMergeGateHandler } from "../merge/pr-nodes.js";
import type { PrEntity, TaskDetail } from "@fusion/core";

function entity(partial: Partial<PrEntity>): PrEntity {
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
    checksRollup: "pending",
    reviewDecision: "APPROVED",
    mergeable: "clean",
    ...partial,
  };
}

describe("ci-repair decisions", () => {
  it("waits while checks pending", () => {
    expect(decideCiRepairAction({ checksRollup: "pending" }).action).toBe("wait");
  });

  it("repairs deterministic failure within budget", () => {
    const d = decideCiRepairAction({
      checksRollup: "failure",
      failureClass: "deterministic",
      attemptCount: 0,
    });
    expect(d.action).toBe("repair");
    expect(d.maxAttempts).toBe(DEFAULT_CI_REPAIR_MAX_ATTEMPTS);
  });

  it("exhausts after max attempts", () => {
    expect(
      decideCiRepairAction({
        checksRollup: "failure",
        failureClass: "deterministic",
        attemptCount: 3,
      }).action,
    ).toBe("exhausted");
  });

  it("refuses blind retry on same head", () => {
    expect(
      decideCiRepairAction({
        checksRollup: "failure",
        failureClass: "deterministic",
        attemptCount: 1,
        headOid: "aaa",
        lastRepairedHeadOid: "aaa",
      }).action,
    ).toBe("exhausted");
  });

  it("retry-waits transient/flake", () => {
    expect(
      decideCiRepairAction({
        checksRollup: "failure",
        failureClass: "transient",
        attemptCount: 0,
      }).action,
    ).toBe("retry-wait");
  });

  it("classifies log evidence", () => {
    expect(classifyCiFailureEvidence({ logExcerpt: "ECONNRESET from api" })).toBe("transient");
    expect(classifyCiFailureEvidence({ logExcerpt: "error TS2304: Cannot find name" })).toBe(
      "deterministic",
    );
  });
});

describe("deriveTransitions checks edges", () => {
  it("emits checks-failed and checks-succeeded on rollup edges", () => {
    const prev = entity({ checksRollup: "pending" });
    const failed = deriveTransitions(prev, {
      exists: true,
      prState: "open",
      checksRollup: "failure",
    });
    expect(failed.map((t) => t.event)).toContain("checks-failed");
    expect(failed.find((t) => t.event === "checks-failed")?.tag).toBe("github:pr-checks-failed");

    const ok = deriveTransitions(entity({ checksRollup: "failure" }), {
      exists: true,
      prState: "open",
      checksRollup: "success",
    });
    expect(ok.map((t) => t.event)).toContain("checks-succeeded");
  });
});

describe("auto-merge gate ci-failed routing", () => {
  it("routes ci-failed for autoMerge + failure", () => {
    expect(autoMergeGateCiFailedValue(entity({ checksRollup: "failure", autoMerge: true }))).toBe(
      "ci-failed",
    );
    expect(autoMergeGateCiFailedValue(entity({ checksRollup: "failure", autoMerge: false }))).toBe(
      null,
    );
  });

  it("handler returns value ci-failed", async () => {
    const ent = entity({ checksRollup: "failure", autoMerge: true });
    const handler = createAutoMergeGateHandler({
      getStore: () =>
        ({
          getActivePrEntityBySource: async () => ent,
        }) as never,
      audit: vi.fn(),
    });
    const result = await handler(
      { id: "gate", kind: "gate" } as never,
      { task: { id: "FN-1" } as TaskDetail, context: {} },
    );
    expect(result).toEqual({ outcome: "success", value: "ci-failed" });
  });
});
