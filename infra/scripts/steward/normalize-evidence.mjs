#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Normalize untrusted AUTO evidence (logs, API fields, PR titles) into a stable
 * incident shape. Never execute candidate code; treat all inputs as hostile text.
 */
import {
  FAILURE_CLASS,
  NON_INCIDENT_TERMINALS,
  TERMINAL_STATUS,
  WORKFLOW_FAMILY,
  buildOccurrenceId,
  escapeMarkdown,
  workflowFamilyFromName,
} from "./policy.mjs";
import { buildFingerprintPayload, fingerprintIncident, normalizeErrorSignature } from "./fingerprint-incident.mjs";

/**
 * @typedef {import("./fingerprint-incident.mjs").FingerprintPayload} FingerprintPayload
 */

/**
 * Classify a known/playbook failure from structured hints + log text.
 * Fixtures may set failureClass explicitly; live path uses signatures.
 *
 * @param {{
 *   failureClass?: string,
 *   workflowName?: string,
 *   workflowFamily?: string,
 *   phase?: string,
 *   terminalStatus?: string,
 *   parentTerminal?: string|null,
 *   childTerminal?: string|null,
 *   logText?: string,
 *   errorMessage?: string,
 *   component?: string,
 *   missingChild?: boolean,
 *   conflictPaths?: string[],
 * }} raw
 */
export function classifyFailure(raw) {
  if (raw.failureClass) {
    return {
      failureClass: String(raw.failureClass),
      component: String(raw.component || componentForClass(raw.failureClass)),
      phase: String(raw.phase || phaseForClass(raw.failureClass)),
      errorSignature: normalizeErrorSignature(raw.errorMessage || raw.failureClass),
    };
  }

  const log = `${raw.logText || ""}\n${raw.errorMessage || ""}`;
  const parent = String(raw.parentTerminal || "").toUpperCase();
  const child = String(raw.childTerminal || "").toUpperCase();

  if (raw.missingChild) {
    return {
      failureClass: FAILURE_CLASS.MISSING_CHILD_TIMEOUT,
      component: "auto2-waiter",
      phase: "auto3-handoff-wait",
      errorSignature: normalizeErrorSignature("missing auto3 child after timeout"),
    };
  }

  if (parent && child && parent !== child && isDeployClaim(parent) && !isDeployClaim(child)) {
    return {
      failureClass: FAILURE_CLASS.PARENT_CHILD_DISAGREEMENT,
      component: "auto2-auto3-correlation",
      phase: "parent-child-reconcile",
      errorSignature: normalizeErrorSignature(`parent=${parent} child=${child}`),
    };
  }

  if (/version mismatch|expected '0\.\d+|AUTO3_APPLICATION_VERSION|package-version/i.test(log)) {
    return {
      failureClass: FAILURE_CLASS.VERSION_GATE_DRIFT,
      component: "installer",
      phase: "trusted-host-d-deploy",
      errorSignature: normalizeErrorSignature("package-version-mismatch"),
    };
  }

  if (/AUTO3_TERMINAL_STATUS=DEPLOYED[\s\S]*AUTO3_TERMINAL_STATUS=(FAILED|BLOCKED|ROLLED_BACK|CRITICAL)/i.test(log)
    || /false\s+DEPLOYED|first match.*DEPLOYED|script source.*AUTO3_TERMINAL/i.test(log)) {
    return {
      failureClass: FAILURE_CLASS.TERMINAL_MARKER_PARSE,
      component: "terminal-marker-parser",
      phase: "auto3-terminal-parse",
      errorSignature: normalizeErrorSignature("false-deployed-from-script-source"),
    };
  }

  if (/mapping values are not allowed|did not find expected|Invalid workflow file|workflow_dispatch.*not found|<<'PY'|heredoc/i.test(log)) {
    return {
      failureClass: FAILURE_CLASS.WORKFLOW_YAML_PARSE,
      component: "github-workflows",
      phase: "workflow-parse",
      errorSignature: normalizeErrorSignature("workflow-yaml-syntax"),
    };
  }

  if (/SyntaxError|python -c|summary.*failed|f-string|unterminated string/i.test(log)) {
    return {
      failureClass: FAILURE_CLASS.SUMMARY_SYNTAX,
      component: "workflow-summary",
      phase: "report-summary",
      errorSignature: normalizeErrorSignature("summary-python-syntaxerror"),
    };
  }

  if (/selectCorrelated|wrong.?child|newest-run|display_title|handoff|ISS-AUTO-003|unrelated older/i.test(log)) {
    return {
      failureClass: FAILURE_CLASS.CORRELATION_RACE,
      component: "auto3-handoff",
      phase: "auto3-run-selection",
      errorSignature: normalizeErrorSignature("wrong-auto3-child-selected"),
    };
  }

  if (/lifecycle-column-census-baseline|CONFLICT|generated.?file|Both modified/i.test(log)
    || (raw.conflictPaths || []).some((p) => /census-baseline|generated/i.test(p))) {
    return {
      failureClass: FAILURE_CLASS.GENERATED_FILE_CONFLICT,
      component: "generated-baseline",
      phase: "auto1-merge",
      errorSignature: normalizeErrorSignature("generated-file-conflict"),
    };
  }

  return {
    failureClass: FAILURE_CLASS.NEEDS_TRIAGE,
    component: String(raw.component || "unknown"),
    phase: String(raw.phase || "unknown"),
    errorSignature: normalizeErrorSignature(raw.errorMessage || log.slice(0, 200) || "unclassified"),
  };
}

/**
 * @param {Record<string, unknown>} rawEvidence
 * Untrusted. Expected keys documented in STEWARD-POLICY / fixtures.
 */
export function normalizeEvidence(rawEvidence) {
  const raw = rawEvidence && typeof rawEvidence === "object" ? rawEvidence : {};
  const workflowName = String(raw.workflowName || "");
  const workflowFamily =
    String(raw.workflowFamily || "") || workflowFamilyFromName(workflowName) || WORKFLOW_FAMILY.unknown;

  if (raw.success === true) {
    const runId = raw.runId ?? raw.workflowRunId ?? "0";
    const attempt = raw.attempt ?? raw.runAttempt ?? 1;
    return {
      workflowFamily,
      phase: "none",
      failureClass: "none",
      errorSignature: "none",
      component: "none",
      terminalStatus: String(raw.terminalStatus || TERMINAL_STATUS.SUCCESS).toUpperCase(),
      openIncident: false,
      instance: {
        occurrenceId: String(raw.occurrenceId || buildOccurrenceId(runId, attempt)),
        runId: String(runId),
        attempt: String(attempt),
        parentRunId: null,
        childRunId: null,
        sourceSha: raw.sourceSha != null ? String(raw.sourceSha) : null,
        headSha: raw.headSha != null ? String(raw.headSha) : null,
        handoffId: null,
        releaseId: raw.releaseId != null ? String(raw.releaseId) : null,
        recordedUtc: raw.recordedUtc != null ? String(raw.recordedUtc) : null,
        parentTerminal: null,
        childTerminal: null,
        evidenceArtifact: null,
        logExcerpt: "",
        workflowName: escapeMarkdown(workflowName),
      },
      fingerprintPayload: null,
      fingerprint: null,
      fingerprintCanonical: null,
    };
  }

  const classified = classifyFailure({
    failureClass: raw.failureClass ? String(raw.failureClass) : undefined,
    workflowName,
    workflowFamily,
    phase: raw.phase ? String(raw.phase) : undefined,
    terminalStatus: raw.terminalStatus ? String(raw.terminalStatus) : undefined,
    parentTerminal: raw.parentTerminal != null ? String(raw.parentTerminal) : null,
    childTerminal: raw.childTerminal != null ? String(raw.childTerminal) : null,
    logText: String(raw.logText || ""),
    errorMessage: String(raw.errorMessage || ""),
    component: raw.component ? String(raw.component) : undefined,
    missingChild: raw.missingChild === true,
    conflictPaths: Array.isArray(raw.conflictPaths) ? raw.conflictPaths.map(String) : [],
  });

  const terminalStatus = String(
    raw.terminalStatus || raw.childTerminal || raw.parentTerminal || TERMINAL_STATUS.UNKNOWN,
  ).toUpperCase();

  const runId = raw.runId ?? raw.workflowRunId ?? "0";
  const attempt = raw.attempt ?? raw.runAttempt ?? 1;
  const occurrenceId = String(raw.occurrenceId || buildOccurrenceId(runId, attempt));

  const openIncident = shouldOpenIncident({
    terminalStatus,
    failureClass: classified.failureClass,
    forceIncident: raw.forceIncident === true,
    success: raw.success === true,
  });

  /** Instance fields — evidence only, never hashed into fingerprint. */
  const instance = {
    occurrenceId,
    runId: String(runId),
    attempt: String(attempt),
    parentRunId: raw.parentRunId != null ? String(raw.parentRunId) : null,
    childRunId: raw.childRunId != null ? String(raw.childRunId) : null,
    sourceSha: raw.sourceSha != null ? String(raw.sourceSha) : null,
    headSha: raw.headSha != null ? String(raw.headSha) : null,
    handoffId: raw.handoffId != null ? String(raw.handoffId) : null,
    releaseId: raw.releaseId != null ? String(raw.releaseId) : null,
    recordedUtc: raw.recordedUtc != null ? String(raw.recordedUtc) : null,
    parentTerminal: raw.parentTerminal != null ? String(raw.parentTerminal).toUpperCase() : null,
    childTerminal: raw.childTerminal != null ? String(raw.childTerminal).toUpperCase() : null,
    evidenceArtifact: raw.evidenceArtifact && typeof raw.evidenceArtifact === "object"
      ? raw.evidenceArtifact
      : null,
    logExcerpt: escapeMarkdown(String(raw.logText || raw.errorMessage || "").slice(0, 1500)),
    workflowName: escapeMarkdown(workflowName),
  };

  const normalized = {
    workflowFamily,
    phase: classified.phase,
    failureClass: classified.failureClass,
    errorSignature: classified.errorSignature,
    component: classified.component,
    terminalStatus,
    openIncident,
    instance,
  };

  let fingerprint = null;
  let payload = null;
  if (openIncident) {
    payload = buildFingerprintPayload(normalized);
    fingerprint = fingerprintIncident(payload);
  }

  return {
    ...normalized,
    fingerprintPayload: payload,
    fingerprint: fingerprint?.fingerprint ?? null,
    fingerprintCanonical: fingerprint?.canonical ?? null,
  };
}

/**
 * @param {{ terminalStatus: string, failureClass: string, forceIncident?: boolean, success?: boolean }} opts
 */
export function shouldOpenIncident(opts) {
  // FNXC:AppsolinoStewardS0 2026-08-02-04:55: Only literal boolean true means success/force.
  if (opts.success === true) return false;
  if (opts.forceIncident === true) return true;
  if (opts.failureClass === FAILURE_CLASS.NEEDS_TRIAGE) return true;
  if (opts.failureClass === FAILURE_CLASS.PARENT_CHILD_DISAGREEMENT) return true;
  if (opts.failureClass === FAILURE_CLASS.TERMINAL_EVIDENCE_DISAGREEMENT) return true;
  if (opts.failureClass === FAILURE_CLASS.MISSING_CHILD_TIMEOUT) return true;
  if (opts.failureClass === FAILURE_CLASS.DUPLICATE_CHILD) return true;
  if (NON_INCIDENT_TERMINALS.includes(opts.terminalStatus)) {
    // Known failure classes still open even if someone stamped SUCCESS incorrectly.
    const noisy = new Set([
      FAILURE_CLASS.CORRELATION_RACE,
      FAILURE_CLASS.TERMINAL_MARKER_PARSE,
      FAILURE_CLASS.VERSION_GATE_DRIFT,
      FAILURE_CLASS.WORKFLOW_YAML_PARSE,
      FAILURE_CLASS.SUMMARY_SYNTAX,
      FAILURE_CLASS.GENERATED_FILE_CONFLICT,
      FAILURE_CLASS.PARENT_CHILD_DISAGREEMENT,
      FAILURE_CLASS.TERMINAL_EVIDENCE_DISAGREEMENT,
      FAILURE_CLASS.MISSING_CHILD_TIMEOUT,
      FAILURE_CLASS.DUPLICATE_CHILD,
    ]);
    return noisy.has(opts.failureClass);
  }
  return true;
}

function isDeployClaim(t) {
  return t === TERMINAL_STATUS.DEPLOYED || t === TERMINAL_STATUS.IDEMPOTENT_NOOP;
}

function componentForClass(c) {
  const map = {
    [FAILURE_CLASS.CORRELATION_RACE]: "auto3-handoff",
    [FAILURE_CLASS.WORKFLOW_YAML_PARSE]: "github-workflows",
    [FAILURE_CLASS.SUMMARY_SYNTAX]: "workflow-summary",
    [FAILURE_CLASS.TERMINAL_MARKER_PARSE]: "terminal-marker-parser",
    [FAILURE_CLASS.VERSION_GATE_DRIFT]: "installer",
    [FAILURE_CLASS.GENERATED_FILE_CONFLICT]: "generated-baseline",
    [FAILURE_CLASS.PARENT_CHILD_DISAGREEMENT]: "auto2-auto3-correlation",
    [FAILURE_CLASS.TERMINAL_EVIDENCE_DISAGREEMENT]: "auto3-evidence",
    [FAILURE_CLASS.MISSING_CHILD_TIMEOUT]: "auto2-waiter",
    [FAILURE_CLASS.DUPLICATE_CHILD]: "auto3-handoff",
    [FAILURE_CLASS.NEEDS_TRIAGE]: "unknown",
  };
  return map[c] || "unknown";
}

function phaseForClass(c) {
  const map = {
    [FAILURE_CLASS.CORRELATION_RACE]: "auto3-run-selection",
    [FAILURE_CLASS.WORKFLOW_YAML_PARSE]: "workflow-parse",
    [FAILURE_CLASS.SUMMARY_SYNTAX]: "report-summary",
    [FAILURE_CLASS.TERMINAL_MARKER_PARSE]: "auto3-terminal-parse",
    [FAILURE_CLASS.VERSION_GATE_DRIFT]: "trusted-host-d-deploy",
    [FAILURE_CLASS.GENERATED_FILE_CONFLICT]: "auto1-merge",
    [FAILURE_CLASS.PARENT_CHILD_DISAGREEMENT]: "parent-child-reconcile",
    [FAILURE_CLASS.TERMINAL_EVIDENCE_DISAGREEMENT]: "evidence-reconcile",
    [FAILURE_CLASS.MISSING_CHILD_TIMEOUT]: "auto3-handoff-wait",
    [FAILURE_CLASS.DUPLICATE_CHILD]: "auto3-run-selection",
    [FAILURE_CLASS.NEEDS_TRIAGE]: "unknown",
  };
  return map[c] || "unknown";
}
