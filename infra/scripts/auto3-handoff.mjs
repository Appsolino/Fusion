#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto3Handoff 2026-08-01-06:45:
 * Exact AUTO-2 → AUTO-3 run correlation. The prior waiter selected an unrelated
 * older completed AUTO-3 run when a newly dispatched child was not yet visible
 * (`or .display_title != null` + unconditional newest-run fallback). That made
 * approve-sensitive exit nonzero after a successful merge even though the real
 * child later DEPLOYED (AUTO-4 PR #47 / run 30687790065).
 *
 * Correlation contract: unique handoff_id in the AUTO-3 run-name; poll only
 * workflow_dispatch runs whose name contains that id and were created after
 * dispatch began; never attach to another run.
 */
import { randomBytes } from "node:crypto";

/**
 * @param {{ githubRunId?: string|number, attempt?: string|number, sourceSha: string, nonce?: string }} input
 */
export function buildAuto3HandoffId(input) {
  const sourceSha = String(input.sourceSha || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error("handoff sourceSha must be a full 40-char SHA");
  }
  const runId = String(input.githubRunId ?? process.env.GITHUB_RUN_ID ?? "local").replace(/[^A-Za-z0-9_-]/g, "");
  const attempt = String(input.attempt ?? process.env.GITHUB_RUN_ATTEMPT ?? "1").replace(/[^0-9]/g, "") || "1";
  const nonce = String(input.nonce ?? randomBytes(4).toString("hex")).replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  return `auto2-${runId}-${attempt}-${sourceSha.slice(0, 12)}-${nonce}`;
}

/**
 * Legacy unsafe selector — retained only so the regression proves the race.
 * DO NOT use in production paths.
 *
 * @param {Array<{id:number|string, head_sha?:string, display_title?:string, name?:string, status?:string, conclusion?:string|null, created_at?:string, event?:string}>} runs
 * @param {{ sourceSha: string }} opts
 */
export function selectAuto3RunIdLegacyUnsafe(runs, opts) {
  const sourceSha = String(opts.sourceSha || "").toLowerCase();
  const matched = (runs || []).filter(
    (r) => String(r.head_sha || "").toLowerCase() === sourceSha || r.display_title != null,
  );
  if (matched.length) return String(matched[0].id);
  if (runs?.length) return String(runs[0].id);
  return "";
}

/**
 * Exact handoff correlation. Returns "" until the matching child is visible.
 *
 * @param {Array<{id:number|string, name?:string, display_title?:string, event?:string, created_at?:string, head_branch?:string, head_sha?:string}>} runs
 * @param {{ handoffId: string, dispatchStartedAtMs: number, sourceSha?: string }} opts
 */
export function selectCorrelatedAuto3Run(runs, opts) {
  const handoffId = String(opts.handoffId || "");
  if (!handoffId) return null;
  const startedMs = Number(opts.dispatchStartedAtMs);
  const candidates = [];
  for (const run of runs || []) {
    if (String(run.event || "") !== "workflow_dispatch") continue;
    // Expected main ref when the API reports a branch (workflow_dispatch on main).
    const branch = String(run.head_branch || "");
    if (branch && branch !== "main") continue;
    const title = `${run.name || ""} ${run.display_title || ""}`;
    if (!title.includes(handoffId)) continue;
    const createdMs = Date.parse(String(run.created_at || ""));
    if (!Number.isFinite(createdMs)) continue;
    // Allow a small clock skew window (5s) so API timestamps just before local Date.now() still match.
    if (createdMs + 5000 < startedMs) continue;
    candidates.push(run);
  }
  if (!candidates.length) return null;
  // Prefer earliest matching run for this handoff (stable attachment).
  candidates.sort((a, b) => Date.parse(String(a.created_at)) - Date.parse(String(b.created_at)));
  return candidates[0];
}

/**
 * Map a completed GitHub Actions run (+ optional terminal marker) to AUTO-3 status.
 *
 * @param {{ status: string, conclusion?: string|null, terminalMarker?: string|null }} input
 */
export function mapAuto3RunToTerminal(input) {
  const status = String(input.status || "").toLowerCase();
  if (status !== "completed") {
    return { terminal: false, deploymentStatus: "IN_PROGRESS", conclusion: input.conclusion ?? null };
  }
  const marker = String(input.terminalMarker || "").toUpperCase();
  if (marker === "DEPLOYED" || marker === "IDEMPOTENT_NOOP" || marker === "ROLLED_BACK"
    || marker === "FAILED" || marker === "CRITICAL" || marker === "BLOCKED") {
    return { terminal: true, deploymentStatus: marker, conclusion: input.conclusion ?? null };
  }
  const conclusion = String(input.conclusion || "").toLowerCase();
  if (conclusion === "success") {
    // Without a marker, success is treated as DEPLOYED (includes IDEMPOTENT_NOOP exit 0).
    return { terminal: true, deploymentStatus: "DEPLOYED", conclusion };
  }
  if (conclusion === "failure") {
    return { terminal: true, deploymentStatus: "FAILED", conclusion };
  }
  if (conclusion === "cancelled" || conclusion === "timed_out") {
    return { terminal: true, deploymentStatus: "BLOCKED", conclusion };
  }
  return { terminal: true, deploymentStatus: "BLOCKED", conclusion };
}

/**
 * Parse AUTO3_TERMINAL_STATUS=... from workflow logs.
 * Prefer the LAST marker. GitHub Actions --log includes the script source that
 * echoes candidate markers (DEPLOYED/IDEMPOTENT/…); taking the first match made
 * parent waiters report DEPLOYED after a real FAILED/BLOCKED deploy (PR #55 child
 * 30705088925).
 * @param {string} logText
 */
export function parseAuto3TerminalMarker(logText) {
  const matches = [...String(logText || "").matchAll(/AUTO3_TERMINAL_STATUS=([A-Z_]+)/g)];
  if (!matches.length) return null;
  return matches[matches.length - 1][1];
}

/**
 * Parent workflow exit policy for AUTO-3 terminals.
 * @param {string} deploymentStatus
 */
export function auto3ParentExitCode(deploymentStatus) {
  const s = String(deploymentStatus || "").toUpperCase();
  if (s === "DEPLOYED" || s === "IDEMPOTENT_NOOP") return 0;
  return 2;
}
