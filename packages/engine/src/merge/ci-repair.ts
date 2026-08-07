/**
 * FNXC:FullAutonomy 2026-08-07-21:04:
 * Pure CI-repair decision surface for PR-backed Fusion tasks.
 * Complements pr-respond (review-comment rework). Failed checks must not park
 * forever as auto-off without a bounded repair path.
 *
 * Does not call GitHub or agents — callers inject evidence + dispatch.
 */
import type { PrEntity } from "@fusion/core";

export const DEFAULT_CI_REPAIR_MAX_ATTEMPTS = 3;

export type CiFailureClass =
  | "transient"
  | "deterministic"
  | "flake-suspected"
  | "out-of-scope"
  | "unknown";

export type CiRepairAction = "wait" | "repair" | "retry-wait" | "exhausted" | "ignore" | "ready";

export interface CiRepairDecisionInput {
  checksRollup?: "success" | "failure" | "pending" | "none" | null;
  attemptCount?: number;
  maxAttempts?: number;
  failureClass?: CiFailureClass;
  headOid?: string | null;
  lastRepairedHeadOid?: string | null;
  /** Current failure fingerprint (check names + normalized log). */
  failureFingerprint?: string | null;
  /** Fingerprint already repaired on lastRepairedHeadOid without a new head. */
  lastFailureFingerprint?: string | null;
}

export interface CiRepairDecision {
  action: CiRepairAction;
  reason: string;
  attempts: number;
  maxAttempts: number;
}

export function decideCiRepairAction(input: CiRepairDecisionInput): CiRepairDecision {
  const rollup = input.checksRollup ?? "none";
  const attempts = Number(input.attemptCount ?? 0);
  const max = Number(input.maxAttempts ?? DEFAULT_CI_REPAIR_MAX_ATTEMPTS);
  const klass = input.failureClass || "unknown";

  if (rollup === "success") {
    return { action: "ready", reason: "checks succeeded", attempts, maxAttempts: max };
  }
  if (rollup === "pending" || rollup === "none") {
    return { action: "wait", reason: "checks not concluded", attempts, maxAttempts: max };
  }
  if (klass === "out-of-scope") {
    return {
      action: "ignore",
      reason: "failure classified out-of-scope for this change",
      attempts,
      maxAttempts: max,
    };
  }
  if (attempts >= max) {
    return {
      action: "exhausted",
      reason: `CI repair budget exhausted (${attempts}/${max})`,
      attempts,
      maxAttempts: max,
    };
  }
  if (
    input.headOid &&
    input.lastRepairedHeadOid &&
    String(input.headOid) === String(input.lastRepairedHeadOid) &&
    klass !== "transient"
  ) {
    return {
      action: "exhausted",
      reason: "same head already repaired without new commits — refuse blind retry",
      attempts,
      maxAttempts: max,
    };
  }
  /*
  FNXC:FullAutonomy 2026-08-07-21:21:
  Even across a head change that did not actually alter the failure, refuse
  re-repair when the fingerprint is unchanged and we already spent an attempt
  on that fingerprint. Prevents log-spam loops that keep "fixing" the same error.
  */
  if (
    input.failureFingerprint &&
    input.lastFailureFingerprint &&
    String(input.failureFingerprint) === String(input.lastFailureFingerprint) &&
    attempts > 0 &&
    klass !== "transient"
  ) {
    return {
      action: "exhausted",
      reason: "identical CI failure fingerprint already repaired — refuse repeated repair",
      attempts,
      maxAttempts: max,
    };
  }
  if (klass === "transient" || klass === "flake-suspected") {
    return {
      action: "retry-wait",
      reason: `classified ${klass} — wait/re-poll before edit repair`,
      attempts,
      maxAttempts: max,
    };
  }
  return {
    action: "repair",
    reason: `deterministic CI failure — repair attempt ${attempts + 1}/${max}`,
    attempts,
    maxAttempts: max,
  };
}

export function classifyCiFailureEvidence(evidence: {
  checkNames?: string[];
  logExcerpt?: string;
} = {}): CiFailureClass {
  const names = (evidence.checkNames || []).map((s) => String(s).toLowerCase());
  const log = String(evidence.logExcerpt || "").toLowerCase();
  const blob = `${names.join(" ")} ${log}`;

  if (/econnreset|etimedout|503|502|rate.?limit|temporary|try again|network/i.test(blob)) {
    return "transient";
  }
  if (/flaky|intermittent|timing|race condition/i.test(blob)) {
    return "flake-suspected";
  }
  if (/unrelated|upstream.*fail|infra.*outage|actions runner offline/i.test(blob)) {
    return "out-of-scope";
  }
  if (/error ts\d+|typeerror|lint|eslint|vitest|failing|assertion|expected/i.test(blob)) {
    return "deterministic";
  }
  return "unknown";
}

/**
 * Distinct auto-merge gate value when checks failed so workflows can edge to CI repair.
 * Returns null when the caller should use the normal ready/auto-off path.
 */
export function autoMergeGateCiFailedValue(
  entity: Pick<PrEntity, "checksRollup" | "autoMerge"> | { checksRollup?: string | null; autoMerge?: boolean },
): "ci-failed" | null {
  if (entity?.checksRollup !== "failure") return null;
  // Only auto-merge-opted entities enter the CI repair route; others stay auto-off.
  if (entity.autoMerge !== true) return null;
  return "ci-failed";
}
