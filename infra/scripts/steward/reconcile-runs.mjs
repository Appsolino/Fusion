#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-02-04:55:
 * Authoritative hourly reconciliation using real handoff relationships.
 * Detects missing child, duplicate child, wrong SHA, parent/child and evidence disagreement.
 */
import { MISSING_CHILD_TIMEOUT_MS, TERMINAL_STATUS, FAILURE_CLASS } from "./policy.mjs";
import { normalizeEvidence } from "./normalize-evidence.mjs";

/**
 * @param {{
 *   nowMs?: number,
 *   handoffs?: Array<Record<string, unknown>>,
 *   recentRuns?: Array<Record<string, unknown>>,
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
    const evidenceTerminal = h.evidenceTerminal != null ? String(h.evidenceTerminal).toUpperCase() : null;
    const childRunId = h.childRunId ?? null;
    const childCount = Number(h.childCountForHandoff || 0);

    if (h.duplicateChildren === true || childCount > 1) {
      pushUnique(candidates, seenOccurrence, normalizeEvidence({
        workflowName: String(h.parentWorkflowName || "Upstream AUTO-3 Deploy"),
        workflowFamily: "auto3",
        runId: h.parentRunId,
        attempt: 1,
        parentRunId: h.parentRunId,
        childRunId,
        handoffId: h.handoffId,
        sourceSha: h.sourceSha,
        failureClass: FAILURE_CLASS.DUPLICATE_CHILD,
        errorMessage: "multiple AUTO-3 children for one handoff",
        terminalStatus: child || TERMINAL_STATUS.UNKNOWN,
        forceIncident: true,
      }));
    }

    if (
      h.expectedSourceSha
      && h.evidenceSourceSha
      && String(h.expectedSourceSha).toLowerCase() !== String(h.evidenceSourceSha).toLowerCase()
    ) {
      pushUnique(candidates, seenOccurrence, normalizeEvidence({
        workflowName: String(h.parentWorkflowName || "Upstream AUTO-2 Finalize"),
        workflowFamily: "auto2",
        runId: h.parentRunId,
        attempt: 1,
        parentRunId: h.parentRunId,
        childRunId,
        handoffId: h.handoffId,
        sourceSha: h.sourceSha,
        failureClass: FAILURE_CLASS.TERMINAL_EVIDENCE_DISAGREEMENT,
        errorMessage: "wrong source SHA between parent expectation and child evidence",
        terminalStatus: child || TERMINAL_STATUS.FAILED,
        forceIncident: true,
      }));
    }

    if (evidenceTerminal && child && evidenceTerminal !== child && isSuccessTerminal(child)) {
      // Child workflow conclusion looked successful but evidence terminal disagrees.
      pushUnique(candidates, seenOccurrence, normalizeEvidence({
        workflowName: String(h.parentWorkflowName || "Upstream AUTO-3 Deploy"),
        workflowFamily: "auto3",
        runId: childRunId || h.parentRunId,
        attempt: 1,
        parentRunId: h.parentRunId,
        childRunId,
        parentTerminal: parent,
        childTerminal: child,
        failureClass: FAILURE_CLASS.TERMINAL_EVIDENCE_DISAGREEMENT,
        errorMessage: `child=${child} evidence=${evidenceTerminal}`,
        terminalStatus: evidenceTerminal,
        forceIncident: true,
        evidenceArtifact: { terminal: evidenceTerminal },
      }));
    }

    if (isDeployClaim(parent) && child && !isSuccessTerminal(child)) {
      pushUnique(candidates, seenOccurrence, normalizeEvidence({
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
        failureClass: FAILURE_CLASS.PARENT_CHILD_DISAGREEMENT,
        errorMessage: `parent=${parent} child=${child}`,
        forceIncident: true,
      }));
      continue;
    }

    // Missing child only when AUTO-3 was expected AND a handoff / dispatch proof exists.
    const expectedChild = h.expectedAuto3Child === true
      || (h.expectedAuto3Child == null && Boolean(h.handoffId) && isDeployClaim(parent));
    if (expectedChild && h.handoffId && !childRunId) {
      const claimedMs = Date.parse(String(h.claimedAt || ""));
      if (Number.isFinite(claimedMs) && nowMs - claimedMs >= timeoutMs) {
        pushUnique(candidates, seenOccurrence, normalizeEvidence({
          workflowName: h.parentWorkflowName || "Upstream AUTO-2 Finalize",
          workflowFamily: "auto2",
          runId: h.parentRunId,
          attempt: 1,
          parentRunId: h.parentRunId,
          parentTerminal: parent,
          handoffId: h.handoffId,
          sourceSha: h.sourceSha,
          missingChild: true,
          failureClass: FAILURE_CLASS.MISSING_CHILD_TIMEOUT,
          errorMessage: "missing auto3 child after timeout",
          forceIncident: true,
        }));
      }
    } else if (h.expectedAuto3Child === null && h.finalizeAction && !childRunId) {
      // Unknown action with no child → needs-triage, never fabricate missing-child.
      pushUnique(candidates, seenOccurrence, normalizeEvidence({
        workflowName: h.parentWorkflowName || "Upstream AUTO-2 Finalize",
        workflowFamily: "auto2",
        runId: h.parentRunId,
        attempt: 1,
        parentRunId: h.parentRunId,
        parentTerminal: parent,
        handoffId: h.handoffId,
        sourceSha: h.sourceSha,
        failureClass: FAILURE_CLASS.NEEDS_TRIAGE,
        errorMessage: `unknown finalize action ${h.finalizeAction}`,
        forceIncident: true,
      }));
    }
  }

  for (const run of input.recentRuns || []) {
    const conclusion = String(run.conclusion || "").toLowerCase();
    const status = String(run.status || "").toLowerCase();
    if (status === "completed" && conclusion === "success") {
      const n = normalizeEvidence({
        workflowName: run.name || run.display_title || "",
        runId: run.id,
        attempt: run.run_attempt || 1,
        terminalStatus: TERMINAL_STATUS.SUCCESS,
        success: true,
        headSha: run.head_sha,
      });
      if (n.openIncident) pushUnique(candidates, seenOccurrence, n);
    }
  }

  return {
    candidates,
    candidateCount: candidates.length,
    reconciledAtMs: nowMs,
  };
}

/**
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

/** Parent terminals that claim a deploy / child relationship. */
function isDeployClaim(t) {
  const s = String(t || "").toUpperCase();
  return s === "DEPLOYED" || s === "DEPLOY_FAILED" || s === "ROLLED_BACK" || s === "CRITICAL";
}

function pushUnique(list, seen, normalized) {
  const oid = normalized?.instance?.occurrenceId;
  if (!oid || seen.has(oid)) return;
  if (!normalized.openIncident) return;
  seen.add(oid);
  list.push(normalized);
}
