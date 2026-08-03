#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Upstream Reliability Steward S0 policy constants. Observation only: fingerprint,
 * evidence, and GitHub issue upsert. No repair, dispatch, merge, or Host D deploy.
 * Fingerprints exclude volatile run/job/attempt/timestamp/nonce/path/runner fields.
 */

/** @typedef {"S0"|"S1"|"S2"|"S3"} StewardPhase */

export const STEWARD_PHASE = /** @type {StewardPhase} */ ("S0");

export const FINGERPRINT_MARKER_HTML =
  "<!-- appsolino-steward-fingerprint: sha256:__FINGERPRINT__ -->";

export const FINGERPRINT_MARKER_RE =
  /<!--\s*appsolino-steward-fingerprint:\s*sha256:([a-f0-9]{64})\s*-->/i;

/** Fields that must never enter the fingerprint payload. */
export const VOLATILE_FINGERPRINT_EXCLUSIONS = Object.freeze([
  "runId",
  "runIds",
  "jobId",
  "jobIds",
  "timestamp",
  "timestamps",
  "attempt",
  "attemptNumber",
  "handoffNonce",
  "handoffId",
  "temporaryPath",
  "tempPath",
  "runnerName",
  "runner",
  "createdAt",
  "recordedUtc",
  "occurrenceId",
]);

/**
 * Known AUTO workflow display names watched by the steward fast path.
 * Must match `name:` on default-branch workflow files.
 */
export const WATCHED_WORKFLOW_NAMES = Object.freeze([
  "Upstream AUTO-1 Sync",
  "Upstream AUTO-2 Validate",
  "Upstream AUTO-2 Finalize",
  "Upstream AUTO-2 Approve Sensitive",
  "Upstream AUTO-3 Deploy",
]);

export const WORKFLOW_FAMILY = Object.freeze({
  auto1: "auto1",
  auto2: "auto2",
  auto3: "auto3",
  unknown: "unknown",
});

/**
 * Stable failure classes. Playbooks map fixtures → these ids.
 * Unknown live failures become needs-triage.
 */
export const FAILURE_CLASS = Object.freeze({
  CORRELATION_RACE: "correlation-race",
  WORKFLOW_YAML_PARSE: "workflow-yaml-parse",
  SUMMARY_SYNTAX: "summary-syntax",
  TERMINAL_MARKER_PARSE: "terminal-marker-parse",
  VERSION_GATE_DRIFT: "version-gate-drift",
  GENERATED_FILE_CONFLICT: "generated-file-conflict",
  /** AUTO-1 structured outcome=conflict (authoritative sync result). */
  UPSTREAM_MERGE_CONFLICT: "upstream-merge-conflict",
  PARENT_CHILD_DISAGREEMENT: "parent-child-disagreement",
  TERMINAL_EVIDENCE_DISAGREEMENT: "terminal-evidence-disagreement",
  MISSING_CHILD_TIMEOUT: "missing-child-timeout",
  DUPLICATE_CHILD: "duplicate-child",
  NEEDS_TRIAGE: "needs-triage",
});

export const TERMINAL_STATUS = Object.freeze({
  DEPLOYED: "DEPLOYED",
  IDEMPOTENT_NOOP: "IDEMPOTENT_NOOP",
  ROLLED_BACK: "ROLLED_BACK",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  CRITICAL: "CRITICAL",
  CONFLICT: "CONFLICT",
  SUCCESS: "SUCCESS",
  IN_PROGRESS: "IN_PROGRESS",
  UNKNOWN: "UNKNOWN",
});

/** Success / no-change terminals that must not open incidents. */
export const NON_INCIDENT_TERMINALS = Object.freeze([
  TERMINAL_STATUS.DEPLOYED,
  TERMINAL_STATUS.IDEMPOTENT_NOOP,
  TERMINAL_STATUS.SUCCESS,
]);

/**
 * Missing AUTO-3 child after parent claimed deploy handoff (minutes).
 * Reconciliation is authoritative; this is not a precise SLA.
 */
export const MISSING_CHILD_TIMEOUT_MS = 45 * 60 * 1000;

/** AUTO-3 physical evidence artifact schema (published by trusted AUTO-3 only). */
export const AUTO3_EVIDENCE_SCHEMA_VERSION = 1;

/**
 * S0 forbidden capabilities — enforced in policy checks and documented in STEWARD-POLICY.
 */
export const S0_FORBIDDEN = Object.freeze([
  "repair-code-generation",
  "repair-branch",
  "workflow-dispatch",
  "workflow-rerun",
  "auto-merge",
  "auto3-deploy",
  "host-d-ssh-install",
  "host-p-access",
  "candidate-checkout",
  "candidate-script-execution",
  "owner-oauth-as-routine-identity",
]);

/**
 * @param {string|number} runId
 * @param {string|number} [attempt]
 */
export function buildOccurrenceId(runId, attempt = 1) {
  const r = String(runId ?? "").replace(/[^0-9A-Za-z_-]/g, "");
  const a = String(attempt ?? "1").replace(/[^0-9]/g, "") || "1";
  if (!r) throw new Error("occurrenceId requires runId");
  return `workflow-run:${r}:attempt:${a}`;
}

/**
 * Map GitHub workflow display name → family.
 * @param {string} name
 */
export function workflowFamilyFromName(name) {
  const n = String(name || "");
  if (n.includes("AUTO-1")) return WORKFLOW_FAMILY.auto1;
  if (n.includes("AUTO-3")) return WORKFLOW_FAMILY.auto3;
  if (n.includes("AUTO-2")) return WORKFLOW_FAMILY.auto2;
  return WORKFLOW_FAMILY.unknown;
}

/**
 * Escape untrusted text for Markdown issue bodies.
 * @param {unknown} value
 */
export function escapeMarkdown(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {string} fingerprintSha256
 */
export function fingerprintMarkerHtml(fingerprintSha256) {
  const fp = String(fingerprintSha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fp)) {
    throw new Error("fingerprint marker requires sha256 hex digest");
  }
  return FINGERPRINT_MARKER_HTML.replace("__FINGERPRINT__", fp);
}

/**
 * @param {string} body
 * @returns {string|null}
 */
export function extractFingerprintFromIssueBody(body) {
  const m = String(body || "").match(FINGERPRINT_MARKER_RE);
  return m ? m[1].toLowerCase() : null;
}
