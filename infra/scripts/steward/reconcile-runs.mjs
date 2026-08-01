#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Authoritative hourly reconciliation. Catches missed workflow_run events,
 * parent/child disagreement, missing children after timeout, and abandoned state.
 * S0: emits incident candidates only — no dispatch/rerun/repair.
 */
import { MISSING_CHILD_TIMEOUT_MS, TERMINAL_STATUS } from "./policy.mjs";
import { normalizeEvidence } from "./normalize-evidence.mjs";

/**
 * @typedef {{
 *   id: string|number,
 *   name?: string,
 *   display_title?: string,
 *   status?: string,
 *   conclusion?: string|null,
 *   created_at?: string,
 *   updated_at?: string,
 *   head_sha?: string,
 *   event?: string,
 *   run_attempt?: number,
 *   path?: string,
 * }} GhRun
 */

/**
 * @typedef {{
 *   parentRunId: string|number,
 *   parentTerminal: string,
 *   childRunId?: string|number|null,
 *   childTerminal?: string|null,
 *   handoffId?: string|null,
 *   sourceSha?: string|null,
 *   claimedAt?: string|null,
 *   parentWorkflowName?: string,
 * }} HandoffRecord
 */

/**
 * Reconcile recent runs + known handoff records into incident candidates.
 *
 * @param {{
 *   nowMs?: number,
 *   handoffs?: HandoffRecord[],
 *   recentRuns?: GhRun[],
 *   missingChildTimeoutMs?: number,
 * }} input
 */
export function reconcileRuns(input) {
  const nowMs = Number(input.nowMs ?? Date.now());
  const timeoutMs = Number(input.missingChildTimeoutMs ?? MISSING_CHILD_TIMEOUT_MS);
  const candidates = [];
  const seenOccurrence = new Set();

  for (const h of input.handoffs || []) {
    const parent = String(h.parentTerminal || "").toUpperCase();
    const child = h.childTerminal != null ? String(h.childTerminal).toUpperCase() : null;
    const childRunId = h.childRunId ?? null;

    if (isSuccessTerminal(parent) && child && !isSuccessTerminal(child)) {
      const raw = {
        workflowName: h.parentWorkflowName || "Upstream AUTO-2 Finalize",
        workflowFamily: "auto2",
        runId: h.parentRunId,
        attempt: 1,
        parentRunId: h.parentRunId,
        childRunId,
        parentTerminal: parent,
        childTerminal: child,
        handoffId: h.handoffId,
        sourceSha: h.sourceSha,
        failureClass: "parent-child-disagreement",
        errorMessage: `parent=${parent} child=${child}`,
        forceIncident: true,
      };
      pushUnique(candidates, seenOccurrence, normalizeEvidence(raw));
      continue;
    }

    if (isSuccessTerminal(parent) && !childRunId) {
      const claimedMs = Date.parse(String(h.claimedAt || ""));
      if (Number.isFinite(claimedMs) && nowMs - claimedMs >= timeoutMs) {
        const raw = {
          workflowName: h.parentWorkflowName || "Upstream AUTO-2 Finalize",
          workflowFamily: "auto2",
          runId: h.parentRunId,
          attempt: 1,
          parentRunId: h.parentRunId,
          parentTerminal: parent,
          handoffId: h.handoffId,
          sourceSha: h.sourceSha,
          missingChild: true,
          failureClass: "missing-child-timeout",
          errorMessage: "missing auto3 child after timeout",
          forceIncident: true,
        };
        pushUnique(candidates, seenOccurrence, normalizeEvidence(raw));
      }
    }
  }

  // Successful completed AUTO runs with no failure signal → no incident.
  for (const run of input.recentRuns || []) {
    const conclusion = String(run.conclusion || "").toLowerCase();
    const status = String(run.status || "").toLowerCase();
    if (status === "completed" && conclusion === "success") {
      const raw = {
        workflowName: run.name || run.display_title || "",
        runId: run.id,
        attempt: run.run_attempt || 1,
        terminalStatus: TERMINAL_STATUS.SUCCESS,
        success: true,
        headSha: run.head_sha,
      };
      const n = normalizeEvidence(raw);
      if (n.openIncident) {
        pushUnique(candidates, seenOccurrence, n);
      }
    }
  }

  return {
    candidates,
    candidateCount: candidates.length,
    reconciledAtMs: nowMs,
  };
}

/**
 * Idempotent merge of two reconciliation results by occurrenceId.
 * @param {ReturnType<typeof normalizeEvidence>[]} a
 * @param {ReturnType<typeof normalizeEvidence>[]} b
 */
export function mergeCandidatesIdempotent(a, b) {
  const map = new Map();
  for (const c of [...(a || []), ...(b || [])]) {
    const oid = c?.instance?.occurrenceId;
    if (!oid) continue;
    if (!map.has(oid)) map.set(oid, c);
  }
  return [...map.values()];
}

function isSuccessTerminal(t) {
  const s = String(t || "").toUpperCase();
  return s === "DEPLOYED" || s === "IDEMPOTENT_NOOP" || s === "SUCCESS";
}

function pushUnique(list, seen, normalized) {
  const oid = normalized?.instance?.occurrenceId;
  if (!oid || seen.has(oid)) return;
  if (!normalized.openIncident) return;
  seen.add(oid);
  list.push(normalized);
}
