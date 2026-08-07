#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-20:04:
 * Single candidate-generation lease: one automation/upstream-* head SHA may own at most
 * one expensive AI operation (sensitive-review XOR repair).
 *
 * Same mode + active corresponding workflow → ALREADY_RUNNING (no redispatch thrash).
 * Same mode + label held but no active run → RETRY_AFTER_TERMINAL (may redispatch).
 * sensitive-review → repair handoff remains allowed after REQUEST_CHANGES.
 */
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
 * @param {{
 *   labels?: Array<{name?: string}|string>,
 *   headRefOid?: string,
 *   requestedMode: "sensitive-review"|"repair"|"ai-verifying",
 *   validatedHead: string,
 *   activeSameModeRun?: boolean,
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
      dispatch: false,
    };
  }
  const mode = String(input.requestedMode || "").toLowerCase();
  const want =
    mode === "repair"
      ? LEASE_LABEL_REPAIR
      : mode === "ai-verifying"
        ? LEASE_LABEL_VERIFYING
        : LEASE_LABEL_SENSITIVE;

  if (lease.activeLabels.length === 1 && lease.activeLabels[0] === want) {
    /*
    FNXC:AutomationGovernance 2026-08-07-20:04:
    Anti-thrash: duplicate finalize while same-mode expert/sensitive run is in_progress
    must NOT redispatch (cancel-in-progress would restart and burn latency budget).
    */
    if (input.activeSameModeRun === true) {
      return {
        ok: false,
        reason: `same head+mode already running (${want}) — ALREADY_RUNNING / NO_DISPATCH`,
        lease,
        action: "ALREADY_RUNNING",
        dispatch: false,
      };
    }
    return {
      ok: true,
      reason: "lease label held but no active run — prior operation terminal; may redispatch",
      lease,
      action: "RETRY_AFTER_TERMINAL",
      dispatch: true,
    };
  }
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
      dispatch: true,
    };
  }
  if (lease.held) {
    return {
      ok: false,
      reason: `expensive AI lease held by ${lease.activeLabels.join(",")} — refuse concurrent ${want}`,
      lease,
      action: "LEASE_HELD",
      dispatch: false,
    };
  }
  return { ok: true, reason: "lease free", lease, action: "ACQUIRE", dispatch: true };
}

/**
 * Query whether expert-resolve already has an in-progress/queued run for this PR+mode+head.
 * @param {(args: string[]) => {status:number,stdout:string,stderr:string}} runGh
 * @param {{ repo: string, prNumber: string|number, mode: string, validatedHead: string }} q
 */
export function hasActiveExpertSameModeRun(runGh, q) {
  const mode = String(q.mode || "sensitive-review");
  const head = String(q.validatedHead || "").toLowerCase();
  const pr = String(q.prNumber);
  // List recent runs; match display title / inputs via API is limited — use workflow runs + jobs filter.
  const list = runGh([
    "api",
    `repos/${q.repo}/actions/workflows/upstream-auto2-expert-resolve.yml/runs?per_page=15&status=in_progress`,
    "--jq",
    "[.workflow_runs[] | {id, status, name, head_sha, display_title}]",
  ]);
  if (list.status !== 0) {
    // Fail soft: unknown activity → treat as not active so terminal retry remains possible.
    return { active: false, reason: "could not list expert runs", runs: [] };
  }
  let runs = [];
  try {
    runs = JSON.parse(list.stdout || "[]");
  } catch {
    runs = [];
  }
  const queued = runGh([
    "api",
    `repos/${q.repo}/actions/workflows/upstream-auto2-expert-resolve.yml/runs?per_page=10&status=queued`,
    "--jq",
    "[.workflow_runs[] | {id, status, name, head_sha, display_title}]",
  ]);
  if (queued.status === 0) {
    try {
      runs = [...runs, ...JSON.parse(queued.stdout || "[]")];
    } catch {
      /* ignore */
    }
  }
  const matched = runs.filter((r) => {
    const sha = String(r.head_sha || "").toLowerCase();
    const title = String(r.display_title || r.name || "");
    const headOk = !head || sha === head || sha.startsWith(head.slice(0, 12));
    const prOk = title.includes(`#${pr}`) || title.includes(`pr ${pr}`) || title.includes(`PR ${pr}`);
    // Mode often appears in run name / job; also accept any in-progress for same head on this workflow.
    const modeOk = title.toLowerCase().includes(mode) || true;
    return headOk && (prOk || headOk) && modeOk;
  });
  // Prefer head match alone when PR is embedded poorly in titles.
  const byHead = runs.filter((r) => String(r.head_sha || "").toLowerCase() === head);
  const active = (head ? byHead : matched).length > 0;
  return { active, reason: active ? "in_progress/queued expert run for head" : "none", runs: head ? byHead : matched };
}

/**
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
