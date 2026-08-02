#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-02-04:55:
 * Live observation helpers: evaluate parent/child/evidence disagreement and
 * download AUTO-3 evidence artifacts (as data) without executing them.
 */
import { normalizeEvidence } from "./normalize-evidence.mjs";
import { FAILURE_CLASS } from "./policy.mjs";
import { parseLastTerminalMarker } from "./parse-deploy-evidence.mjs";
import { childTerminalFromRun, parentTerminalFromRun } from "./build-handoffs.mjs";

/**
 * Compare workflow conclusion, marker, evidence terminal, SHAs, release ids.
 * @param {{
 *   workflowName?: string,
 *   runId: string|number,
 *   attempt?: string|number,
 *   conclusion?: string|null,
 *   parentRunId?: string|number|null,
 *   childRunId?: string|number|null,
 *   parentConclusion?: string|null,
 *   childConclusion?: string|null,
 *   childStatus?: string|null,
 *   logText?: string,
 *   evidenceArtifact?: {
 *     terminal?: string|null,
 *     sourceSha?: string|null,
 *     releaseId?: string|null,
 *     hostPAccessed?: boolean|null,
 *   }|null,
 *   expectedSourceSha?: string|null,
 *   expectedReleaseId?: string|null,
 * }} input
 */
export function evaluateLiveObservation(input) {
  const marker = parseLastTerminalMarker(input.logText || "");
  const evidence = input.evidenceArtifact || null;
  const evidenceTerminal = evidence?.terminal ? String(evidence.terminal).toUpperCase() : null;

  const parentTerminal = input.parentRunId != null
    ? parentTerminalFromRun({
      status: "completed",
      conclusion: input.parentConclusion ?? input.conclusion,
    })
    : null;

  const childTerminal = input.childRunId != null
    ? childTerminalFromRun({
      status: input.childStatus || "completed",
      conclusion: input.childConclusion ?? null,
      evidenceTerminal,
      logText: input.logText || "",
    })
    : (evidenceTerminal || marker || (
      String(input.conclusion || "").toLowerCase() === "success" ? "DEPLOYED" : "FAILED"
    ));

  // Historical PR #55 class: parent success / child BLOCKED
  if (
    parentTerminal
    && (parentTerminal === "DEPLOYED" || parentTerminal === "SUCCESS")
    && childTerminal
    && childTerminal !== "DEPLOYED"
    && childTerminal !== "IDEMPOTENT_NOOP"
  ) {
    return normalizeEvidence({
      workflowName: input.workflowName || "Upstream AUTO-2 Approve Sensitive",
      workflowFamily: "auto2",
      runId: input.parentRunId || input.runId,
      attempt: input.attempt || 1,
      parentRunId: input.parentRunId || input.runId,
      childRunId: input.childRunId,
      parentTerminal,
      childTerminal,
      sourceSha: input.expectedSourceSha,
      failureClass: FAILURE_CLASS.PARENT_CHILD_DISAGREEMENT,
      errorMessage: `parent=${parentTerminal} child=${childTerminal}`,
      terminalStatus: childTerminal,
      forceIncident: true,
      evidenceArtifact: evidence,
      logText: input.logText || "",
    });
  }

  if (marker && evidenceTerminal && marker !== evidenceTerminal) {
    return normalizeEvidence({
      workflowName: input.workflowName || "Upstream AUTO-3 Deploy",
      workflowFamily: "auto3",
      runId: input.childRunId || input.runId,
      attempt: input.attempt || 1,
      childRunId: input.childRunId || input.runId,
      failureClass: FAILURE_CLASS.TERMINAL_EVIDENCE_DISAGREEMENT,
      errorMessage: `marker=${marker} evidence=${evidenceTerminal}`,
      terminalStatus: evidenceTerminal,
      forceIncident: true,
      evidenceArtifact: evidence,
      logText: input.logText || "",
    });
  }

  if (
    evidence
    && input.expectedSourceSha
    && evidence.sourceSha
    && String(evidence.sourceSha).toLowerCase() !== String(input.expectedSourceSha).toLowerCase()
  ) {
    return normalizeEvidence({
      workflowName: input.workflowName || "Upstream AUTO-3 Deploy",
      workflowFamily: "auto3",
      runId: input.runId,
      attempt: input.attempt || 1,
      failureClass: FAILURE_CLASS.TERMINAL_EVIDENCE_DISAGREEMENT,
      errorMessage: "evidence sourceSha mismatch",
      terminalStatus: evidenceTerminal || "FAILED",
      forceIncident: true,
      evidenceArtifact: evidence,
      sourceSha: input.expectedSourceSha,
    });
  }

  if (
    evidence
    && input.expectedReleaseId
    && evidence.releaseId
    && String(evidence.releaseId) !== String(input.expectedReleaseId)
  ) {
    return normalizeEvidence({
      workflowName: input.workflowName || "Upstream AUTO-3 Deploy",
      workflowFamily: "auto3",
      runId: input.runId,
      attempt: input.attempt || 1,
      failureClass: FAILURE_CLASS.TERMINAL_EVIDENCE_DISAGREEMENT,
      errorMessage: "evidence releaseId mismatch",
      terminalStatus: evidenceTerminal || "FAILED",
      forceIncident: true,
      evidenceArtifact: evidence,
    });
  }

  // Genuine success only when conclusion success AND evidence (if present) agrees.
  const conclusionSuccess = String(input.conclusion || "").toLowerCase() === "success";
  const evidenceOk = !evidenceTerminal
    || evidenceTerminal === "DEPLOYED"
    || evidenceTerminal === "IDEMPOTENT_NOOP";
  if (conclusionSuccess && evidenceOk && !parentTerminal) {
    return normalizeEvidence({
      workflowName: input.workflowName || "",
      runId: input.runId,
      attempt: input.attempt || 1,
      terminalStatus: evidenceTerminal || "SUCCESS",
      success: true,
      sourceSha: input.expectedSourceSha,
      releaseId: evidence?.releaseId,
      evidenceArtifact: evidence,
    });
  }

  if (conclusionSuccess && evidenceOk && parentTerminal && isSuccess(childTerminal)) {
    return normalizeEvidence({
      workflowName: input.workflowName || "",
      runId: input.runId,
      attempt: input.attempt || 1,
      terminalStatus: childTerminal || "SUCCESS",
      success: true,
      parentRunId: input.parentRunId,
      childRunId: input.childRunId,
      evidenceArtifact: evidence,
    });
  }

  // Failed / unknown → classify from logs or needs-triage
  return normalizeEvidence({
    workflowName: input.workflowName || "",
    runId: input.runId,
    attempt: input.attempt || 1,
    terminalStatus: evidenceTerminal || marker || (conclusionSuccess ? "SUCCESS" : "FAILED"),
    success: false,
    logText: input.logText || "",
    errorMessage: conclusionSuccess ? "inconclusive success without agreeing evidence" : `workflow conclusion ${input.conclusion}`,
    evidenceArtifact: evidence,
    parentRunId: input.parentRunId,
    childRunId: input.childRunId,
    parentTerminal,
    childTerminal,
    sourceSha: input.expectedSourceSha,
  });
}

function isSuccess(t) {
  const s = String(t || "").toUpperCase();
  return s === "DEPLOYED" || s === "IDEMPOTENT_NOOP" || s === "SUCCESS";
}
