#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-19:56:
 * Single candidate-generation lease: one automation/upstream-* head SHA may own at most
 * one expensive AI operation (sensitive-review XOR repair). Prevents duplicate finalize
 * dispatches and concurrent review+repair for the same generation.
 */
import { spawnSync } from "node:child_process";

export const LEASE_LABEL_SENSITIVE = "auto2:sensitive-review";
export const LEASE_LABEL_REPAIR = "auto2:expert-resolving";
export const LEASE_LABEL_VERIFYING = "auto2:ai-verifying";
export const EXPENSIVE_AI_LABELS = Object.freeze([
  LEASE_LABEL_SENSITIVE,
  LEASE_LABEL_REPAIR,
  LEASE_LABEL_VERIFYING,
]);

/**
 * @param {{ labels?: Array<{name?: string}|string>, headRefOid?: string, expectedHead?: string }} pr
 */
export function readCandidateLease(pr) {
  const labels = new Set(
    (pr.labels || []).map((l) => (typeof l === "string" ? l : String(l?.name || ""))).filter(Boolean),
  );
  const active = EXPENSIVE_AI_LABELS.filter((l) => labels.has(l));
  const head = String(pr.headRefOid || "").toLowerCase();
  const expected = String(pr.expectedHead || "").toLowerCase();
  const headMatches = !expected || !head || head === expected;
  return {
    held: active.length > 0,
    activeLabels: active,
    headMatches,
    head,
    exclusiveOk: active.length <= 1,
  };
}

/**
 * Decide whether a new expensive AI mode may start for this PR/head.
 * @param {{
 *   labels?: Array<{name?: string}|string>,
 *   headRefOid?: string,
 *   requestedMode: "sensitive-review"|"repair"|"ai-verifying",
 *   validatedHead: string,
 * }} input
 */
export function canAcquireCandidateLease(input) {
  const lease = readCandidateLease({
    labels: input.labels,
    headRefOid: input.headRefOid,
    expectedHead: input.validatedHead,
  });
  if (!lease.headMatches) {
    return {
      ok: false,
      reason: "candidate head moved — REFRESH_REQUIRED before new AI work",
      lease,
      action: "REFRESH_REQUIRED",
    };
  }
  const mode = String(input.requestedMode || "").toLowerCase();
  const want =
    mode === "repair"
      ? LEASE_LABEL_REPAIR
      : mode === "ai-verifying"
        ? LEASE_LABEL_VERIFYING
        : LEASE_LABEL_SENSITIVE;

  // Same mode already held → idempotent continue.
  if (lease.activeLabels.length === 1 && lease.activeLabels[0] === want) {
    return { ok: true, reason: "lease already held for requested mode", lease, action: "CONTINUE" };
  }
  // sensitive-review → repair is the only allowed hand-off (REQUEST_CHANGES).
  if (
    want === LEASE_LABEL_REPAIR &&
    lease.activeLabels.length === 1 &&
    lease.activeLabels[0] === LEASE_LABEL_SENSITIVE
  ) {
    return {
      ok: true,
      reason: "hand-off sensitive-review → repair after REQUEST_CHANGES",
      lease,
      action: "HANDOFF",
    };
  }
  if (lease.held) {
    return {
      ok: false,
      reason: `expensive AI lease held by ${lease.activeLabels.join(",")} — refuse concurrent ${want}`,
      lease,
      action: "LEASE_HELD",
    };
  }
  return { ok: true, reason: "lease free", lease, action: "ACQUIRE" };
}

/**
 * Best-effort gh label mutate for lease transfer.
 * @param {(args: string[]) => {status:number,stdout:string,stderr:string}} runGh
 * @param {string} repo
 * @param {string|number} prNumber
 * @param {{ acquire?: string|null, release?: string[] }} ops
 */
export function applyCandidateLeaseLabels(runGh, repo, prNumber, ops) {
  for (const lab of ops.release || []) {
    runGh(["api", "-X", "DELETE", `repos/${repo}/issues/${prNumber}/labels/${encodeURIComponent(lab)}`]);
  }
  if (ops.acquire) {
    runGh([
      "api",
      "-X",
      "POST",
      `repos/${repo}/issues/${prNumber}/labels`,
      "-f",
      `labels[]=${ops.acquire}`,
    ]);
  }
}

/**
 * CLI helper for workflows.
 */
function main() {
  const mode = process.argv[2] || "sensitive-review";
  const head = process.env.VALIDATED_HEAD || "";
  const labelsRaw = process.env.PR_LABELS_JSON || "[]";
  let labels = [];
  try {
    labels = JSON.parse(labelsRaw);
  } catch {
    labels = [];
  }
  const r = canAcquireCandidateLease({
    labels,
    headRefOid: process.env.PR_HEAD || head,
    requestedMode: /** @type {*} */ (mode),
    validatedHead: head,
  });
  process.stdout.write(`${JSON.stringify(r)}\n`);
  process.exit(r.ok ? 0 : 2);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("candidate-lease.mjs")) {
  // Only run main when executed directly — keep import-safe for tests.
  if (process.argv[1] && String(process.argv[1]).includes("candidate-lease.mjs") && process.env.CANDIDATE_LEASE_CLI === "1") {
    main();
  }
}

export { spawnSync };
