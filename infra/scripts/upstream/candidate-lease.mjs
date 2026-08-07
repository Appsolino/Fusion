#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-20:15:
 * Single candidate-generation lease + expert-run identity via workflow run-name.
 * Do NOT correlate activity using workflow_dispatch head_sha (that is main/ref SHA).
 *
 * run-name format:
 *   AUTO2 Expert PR#<n> mode=<mode> candidate=<validated_head>
 */
export const LEASE_LABEL_SENSITIVE = "auto2:sensitive-review";
export const LEASE_LABEL_REPAIR = "auto2:expert-resolving";
export const LEASE_LABEL_VERIFYING = "auto2:ai-verifying";
export const EXPENSIVE_AI_LABELS = Object.freeze([
  LEASE_LABEL_SENSITIVE,
  LEASE_LABEL_REPAIR,
  LEASE_LABEL_VERIFYING,
]);

export const EXPERT_RUN_NAME_RE =
  /AUTO2 Expert PR#(\d+)\s+mode=([^\s]+)\s+candidate=([0-9a-f]{7,40})/i;

/**
 * @param {string|null|undefined} displayTitle
 * @returns {{ pr: string, mode: string, candidate: string }|null}
 */
export function parseExpertRunIdentity(displayTitle) {
  const m = String(displayTitle || "").match(EXPERT_RUN_NAME_RE);
  if (!m) return null;
  return { pr: m[1], mode: m[2].toLowerCase(), candidate: m[3].toLowerCase() };
}

/**
 * @param {string} a
 * @param {string} b
 */
export function candidateShaMatches(a, b) {
  const x = String(a || "").toLowerCase();
  const y = String(b || "").toLowerCase();
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/**
 * Match an expert workflow run by run-name identity — never by workflow head_sha.
 * Fixture shape (real run 31210745085): event=workflow_dispatch, head_branch=main,
 * head_sha=main tip, display_title must carry candidate via run-name.
 *
 * @param {{ display_title?: string, name?: string, head_sha?: string, status?: string }} run
 * @param {{ prNumber: string|number, mode: string, validatedHead: string }} q
 */
export function matchExpertRunByIdentity(run, q) {
  const title = String(run.display_title || run.name || "");
  const id = parseExpertRunIdentity(title);
  if (!id) return false;
  const mode = String(q.mode || "").toLowerCase();
  if (id.pr !== String(q.prNumber)) return false;
  if (id.mode !== mode) return false;
  return candidateShaMatches(id.candidate, q.validatedHead);
}

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
    FNXC:AutomationGovernance 2026-08-07-20:15:
    Anti-thrash: duplicate finalize while same-mode expert run is queued/in_progress
    must NOT redispatch.
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
 * @param {(args: string[]) => {status:number,stdout:string,stderr:string}} runGh
 * @param {{ repo: string, prNumber: string|number, mode: string, validatedHead: string }} q
 */
export function hasActiveExpertSameModeRun(runGh, q) {
  const mode = String(q.mode || "sensitive-review").toLowerCase();
  const head = String(q.validatedHead || "").toLowerCase();
  const pr = String(q.prNumber);

  /** @type {object[]} */
  let runs = [];
  for (const status of ["in_progress", "queued"]) {
    const list = runGh([
      "api",
      `repos/${q.repo}/actions/workflows/upstream-auto2-expert-resolve.yml/runs?per_page=20&status=${status}`,
      "--jq",
      "[.workflow_runs[] | {id, status, name, head_sha, head_branch, display_title, event}]",
    ]);
    if (list.status !== 0) continue;
    try {
      runs = [...runs, ...JSON.parse(list.stdout || "[]")];
    } catch {
      /* ignore */
    }
  }

  const matched = runs.filter((r) =>
    matchExpertRunByIdentity(r, { prNumber: pr, mode, validatedHead: head }),
  );
  return {
    active: matched.length > 0,
    reason: matched.length
      ? "in_progress/queued expert run matched run-name PR+mode+candidate"
      : "no matching expert run-name",
    runs: matched,
  };
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
