#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-02-04:55:
 * Build real handoff relationships from AUTO-2/AUTO-3 GitHub Actions run metadata.
 * Live reconciliation must not pass handoffs:[].
 */
import { selectCorrelatedAuto3Run } from "../auto3-handoff.mjs";
import { parseLastTerminalMarker } from "./parse-deploy-evidence.mjs";
import {
  parseAuto2FinalizeEvidence,
  parentSemanticTerminalFromAction,
} from "./auto2-action-semantics.mjs";

const HANDOFF_RE = /\b(auto2-[A-Za-z0-9_-]+)\b/;
const SHA_RE = /\b([0-9a-f]{40})\b/i;

/**
 * @param {{ name?: string, display_title?: string }} run
 */
export function extractHandoffIdFromRun(run) {
  const title = `${run?.name || ""} ${run?.display_title || ""}`;
  const m = title.match(HANDOFF_RE);
  return m ? m[1] : null;
}

/**
 * @param {{ name?: string, display_title?: string, head_sha?: string }} run
 */
export function extractSourceShaFromRun(run) {
  const title = `${run?.name || ""} ${run?.display_title || ""}`;
  const m = title.match(SHA_RE);
  if (m) return m[1].toLowerCase();
  const head = String(run?.head_sha || "").toLowerCase();
  return /^[0-9a-f]{40}$/.test(head) ? head : null;
}

/**
 * @param {string} name
 */
export function isAuto2ParentWorkflow(name) {
  const n = String(name || "");
  return n.includes("AUTO-2 Finalize") || n.includes("AUTO-2 Approve Sensitive");
}

/**
 * @param {string} name
 */
export function isAuto3Workflow(name) {
  return String(name || "").includes("AUTO-3");
}

/**
 * Map a completed child run (+ optional evidence/marker) to a deploy terminal.
 * @param {{
 *   status?: string,
 *   conclusion?: string|null,
 *   evidenceTerminal?: string|null,
 *   logText?: string|null,
 * }} child
 */
export function childTerminalFromRun(child) {
  const ev = String(child.evidenceTerminal || "").toUpperCase();
  if (ev) return ev;
  const marker = parseLastTerminalMarker(child.logText || "");
  if (marker) return marker;
  const status = String(child.status || "").toLowerCase();
  if (status !== "completed") return "IN_PROGRESS";
  const c = String(child.conclusion || "").toLowerCase();
  if (c === "success") return "DEPLOYED";
  if (c === "failure") return "FAILED";
  if (c === "cancelled" || c === "timed_out") return "BLOCKED";
  return "UNKNOWN";
}

/**
 * Parent terminal from workflow conclusion and optional finalize action evidence.
 * Do not map bare success → DEPLOYED without deployment action proof.
 * @param {{
 *   conclusion?: string|null,
 *   status?: string,
 *   claimedTerminal?: string|null,
 *   finalizeAction?: string|null,
 *   logText?: string|null,
 * }} parent
 */
export function parentTerminalFromRun(parent) {
  if (parent.claimedTerminal) return String(parent.claimedTerminal).toUpperCase();
  const evidence = parseAuto2FinalizeEvidence(parent.logText || "");
  const action = parent.finalizeAction || evidence.action;
  if (action) {
    return parentSemanticTerminalFromAction(action, parent.conclusion);
  }
  const status = String(parent.status || "").toLowerCase();
  if (status !== "completed") return "IN_PROGRESS";
  const c = String(parent.conclusion || "").toLowerCase();
  if (c === "skipped" || c === "neutral") return "SKIPPED";
  if (c === "cancelled") return "CANCELLED";
  // Bare success without finalize action is not deployment proof.
  if (c === "success") return "SUCCESS";
  if (c === "failure") return "FAILED";
  return "UNKNOWN";
}

/**
 * @param {{
 *   auto2Runs?: Array<Record<string, unknown>>,
 *   auto3Runs?: Array<Record<string, unknown>>,
 *   evidenceByRunId?: Record<string, { terminal?: string|null, sourceSha?: string|null, releaseId?: string|null }>,
 *   logsByRunId?: Record<string, string>,
 *   nowMs?: number,
 * }} input
 */
export function buildHandoffsFromRuns(input) {
  const auto3Runs = input.auto3Runs || [];
  const auto2Runs = input.auto2Runs || [];
  const evidenceByRunId = input.evidenceByRunId || {};
  const logsByRunId = input.logsByRunId || {};
  /** @type {Map<string, object[]>} */
  const childrenByHandoff = new Map();

  for (const run of auto3Runs) {
    const handoffId = extractHandoffIdFromRun(run);
    if (!handoffId) continue;
    const list = childrenByHandoff.get(handoffId) || [];
    list.push(run);
    childrenByHandoff.set(handoffId, list);
  }

  /** @type {Array<Record<string, unknown>>} */
  const handoffs = [];

  for (const parent of auto2Runs) {
    if (!isAuto2ParentWorkflow(String(parent.name || parent.display_title || ""))) continue;
    const parentLogs = logsByRunId[String(parent.id)] || "";
    const finalize = parseAuto2FinalizeEvidence(parentLogs);
    const handoffFromLog = finalize.handoffId || parentLogs.match(HANDOFF_RE)?.[1] || null;
    const sourceSha = extractSourceShaFromRun(parent)
      || (parentLogs.match(SHA_RE)?.[1] || "").toLowerCase()
      || null;

    // Prefer exact correlated child via handoff in logs; else best-effort by source sha + time.
    let handoffId = handoffFromLog;
    /** @type {object|null} */
    let child = null;
    /** @type {object[]} */
    let siblings = [];

    if (handoffId && childrenByHandoff.has(handoffId)) {
      siblings = childrenByHandoff.get(handoffId) || [];
      const dispatchStartedAtMs = Date.parse(String(parent.created_at || parent.run_started_at || "")) || 0;
      child = selectCorrelatedAuto3Run(siblings, {
        handoffId,
        dispatchStartedAtMs,
        sourceSha: sourceSha || undefined,
      });
    } else if (sourceSha && finalize.expectedAuto3Child === true) {
      // Fallback SHA match only when AUTO-3 was actually expected.
      const parentMs = Date.parse(String(parent.created_at || "")) || 0;
      const matches = auto3Runs.filter((r) => {
        const sha = extractSourceShaFromRun(r);
        const created = Date.parse(String(r.created_at || "")) || 0;
        return sha === sourceSha && created + 5000 >= parentMs;
      });
      if (matches.length === 1) {
        child = matches[0];
        handoffId = extractHandoffIdFromRun(child);
        siblings = matches;
      } else if (matches.length > 1) {
        siblings = matches;
        child = matches[0];
        handoffId = extractHandoffIdFromRun(child);
      }
    }

    const childId = child ? String(child.id) : (finalize.auto3RunId || null);
    const evidence = childId ? evidenceByRunId[childId] : null;
    const childLogs = childId ? logsByRunId[childId] || "" : "";
    const childTerminal = child
      ? childTerminalFromRun({
        status: String(child.status || ""),
        conclusion: child.conclusion ?? null,
        evidenceTerminal: evidence?.terminal ?? null,
        logText: childLogs,
      })
      : null;

    const expectedAuto3Child = finalize.action != null
      ? finalize.expectedAuto3Child
      : (handoffId ? true : false);

    handoffs.push({
      parentRunId: parent.id,
      parentWorkflowName: parent.name || parent.display_title || "",
      parentTerminal: parentTerminalFromRun({
        status: String(parent.status || ""),
        conclusion: parent.conclusion ?? null,
        finalizeAction: finalize.action,
        logText: parentLogs,
      }),
      finalizeAction: finalize.action,
      expectedAuto3Child,
      childRunId: child ? String(child.id) : null,
      childTerminal,
      handoffId,
      sourceSha,
      expectedSourceSha: sourceSha,
      claimedAt: parent.updated_at || parent.created_at || null,
      childCountForHandoff: handoffId ? (childrenByHandoff.get(handoffId) || siblings).length : siblings.length,
      evidenceTerminal: evidence?.terminal ?? null,
      evidenceSourceSha: evidence?.sourceSha ?? null,
      evidenceReleaseId: evidence?.releaseId ?? null,
    });
  }

  // Orphan AUTO-3 handoffs with duplicate children
  for (const [handoffId, kids] of childrenByHandoff) {
    if (kids.length <= 1) continue;
    const already = handoffs.some((h) => h.handoffId === handoffId && Number(h.childCountForHandoff) > 1);
    if (already) continue;
    handoffs.push({
      parentRunId: `orphan-${handoffId}`,
      parentWorkflowName: "Upstream AUTO-3 Deploy",
      parentTerminal: "UNKNOWN",
      childRunId: String(kids[0].id),
      childTerminal: childTerminalFromRun({
        status: String(kids[0].status || ""),
        conclusion: kids[0].conclusion ?? null,
        evidenceTerminal: evidenceByRunId[String(kids[0].id)]?.terminal ?? null,
      }),
      handoffId,
      sourceSha: extractSourceShaFromRun(kids[0]),
      claimedAt: kids[0].created_at || null,
      childCountForHandoff: kids.length,
      duplicateChildren: true,
    });
  }

  return handoffs;
}
