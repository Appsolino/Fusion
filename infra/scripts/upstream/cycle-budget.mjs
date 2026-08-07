#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamLatency 2026-08-07-14:05:
 * Total cycle wall-clock budget for expert/sensitive maintenance.
 * Per-child 15m timeouts must not multiply into hour-long loops.
 * Nested retries receive min(phaseBudget, remainingCycleBudget).
 * Calibrated from MAINTENANCE-LATENCY-AUDIT.md (hard ≤20m).
 */

/** @typedef {'probe'|'expert'|'verifier'|'schema-repair'|'sensitive-review'|'targeted-repair'} PhaseKind */

export const LATENCY_TAXONOMY = Object.freeze([
  "RUNNER_QUEUE",
  "WORKFLOW_DISPATCH_DELAY",
  "SETUP_IO",
  "AI_EXPERT_REASONING",
  "AI_EXPERT_TOOL_EXECUTION",
  "AI_VERIFIER_REASONING",
  "AI_PROVIDER_STALL",
  "AI_PROVIDER_EXIT",
  "AI_TIMEOUT",
  "AI_PROTOCOL_RETRY",
  "AI_SCHEMA_REPAIR",
  "VERIFIER_REQUEST_CHANGES",
  "REPAIR_NON_CONVERGENCE",
  "DETERMINISTIC_TESTS",
  "FULL_CI",
  "STALE_UPSTREAM",
  "STALE_APPSOLINO_BASE",
  "UNNECESSARY_EXPERT_INVOCATION",
  "LATENCY_BUDGET_EXHAUSTED",
  "UNKNOWN_LATENCY",
]);

/** Proposed SLOs from historical audit (ms). Overridable via env. */
export const DEFAULT_CYCLE_BUDGET_MS = Number(process.env.UPSTREAM_CYCLE_BUDGET_MS || 20 * 60_000);
export const DEFAULT_PHASE_BUDGETS_MS = Object.freeze({
  probe: Number(process.env.UPSTREAM_BUDGET_PROBE_MS || 60_000),
  expert: Number(process.env.UPSTREAM_BUDGET_EXPERT_MS || 6 * 60_000),
  verifier: Number(process.env.UPSTREAM_BUDGET_VERIFIER_MS || 8 * 60_000),
  "schema-repair": Number(process.env.UPSTREAM_BUDGET_SCHEMA_REPAIR_MS || 90_000),
  "sensitive-review": Number(process.env.UPSTREAM_BUDGET_SENSITIVE_REVIEW_MS || 8 * 60_000),
  "targeted-repair": Number(process.env.UPSTREAM_BUDGET_TARGETED_REPAIR_MS || 6 * 60_000),
});
/*
FNXC:UpstreamLatency 2026-08-07-16:15:
Live #135 repair runs showed verifier exit 143 after ~4m under the initial 4m
verifier phase budget (opus needed ~5.4m on sensitive-review). Calibrate verifier
to 8m — still under the 20m cycle hard wall; nested children remain capped by remaining.
*/

/**
 * @param {{
 *   cycleBudgetMs?: number,
 *   phaseBudgetsMs?: Partial<Record<PhaseKind, number>>,
 *   startedAt?: number,
 *   nowFn?: () => number,
 * }} [opts]
 */
export function createCycleBudget(opts = {}) {
  const startedAt = opts.startedAt ?? Date.now();
  // Explicit budgets may be tiny in tests; only floor the default production budget.
  const rawBudget = opts.cycleBudgetMs != null ? Number(opts.cycleBudgetMs) : DEFAULT_CYCLE_BUDGET_MS;
  const cycleBudgetMs = Math.max(1, Number.isFinite(rawBudget) ? rawBudget : DEFAULT_CYCLE_BUDGET_MS);
  const phaseBudgets = { ...DEFAULT_PHASE_BUDGETS_MS, ...(opts.phaseBudgetsMs || {}) };
  const nowFn = opts.nowFn || Date.now;

  return {
    startedAt,
    cycleBudgetMs,
    phaseBudgets,
    /** @returns {number} */
    elapsedMs() {
      return Math.max(0, nowFn() - startedAt);
    },
    /** @returns {number} */
    remainingMs() {
      return Math.max(0, cycleBudgetMs - (nowFn() - startedAt));
    },
    /** @returns {boolean} */
    exhausted() {
      return this.remainingMs() <= 0;
    },
    /**
     * Child timeout = min(phase budget, remaining cycle). Never resets the cycle clock.
     * @param {PhaseKind} phase
     * @returns {number}
     */
    childTimeoutMs(phase) {
      const phaseCap = Math.max(1_000, Number(phaseBudgets[phase] ?? phaseBudgets.expert));
      const remaining = this.remainingMs();
      if (remaining <= 0) return 0;
      return Math.min(phaseCap, remaining);
    },
    /**
     * @returns {{ ok: true } | { ok: false, next: string, reason: string, classification: string }}
     */
    assertNotExhausted() {
      if (!this.exhausted()) return { ok: true };
      return {
        ok: false,
        next: "LATENCY_BUDGET_EXHAUSTED",
        reason: `cycle wall-clock budget exhausted (${cycleBudgetMs}ms)`,
        classification: "LATENCY_BUDGET_EXHAUSTED",
      };
    },
    snapshot() {
      return {
        cycleStartedAt: new Date(startedAt).toISOString().replace(/\.\d{3}Z$/, "Z"),
        cycleBudgetMs,
        elapsedMs: this.elapsedMs(),
        remainingBudgetMs: this.remainingMs(),
        phaseBudgetsMs: { ...phaseBudgets },
      };
    },
  };
}
