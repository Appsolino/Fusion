#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Steward S1A Expert Advisory Mode — policy constants.
 * Advice only: no repair branch, no AUTO dispatch, no Host D/P.
 */

/** @typedef {"S0"|"S1A"|"S1B"|"S2"|"S3"} StewardPhase */

export const STEWARD_PHASE = /** @type {StewardPhase} */ ("S1A");

/** Phase gates — S1A authorised; S1B still prohibited. */
export const PHASE_GATE = Object.freeze({
  S0: true,
  S1A: true,
  S1B: false,
  S2: false,
  S3: false,
});

export const ALLOWED_REPO = "Appsolino/Fusion";

export const STEWARD_ISSUE_LABEL = "appsolino-steward";

/**
 * S1A label taxonomy (GitHub labels; create via API or owner).
 */
export const S1A_LABELS = Object.freeze({
  NEEDS_EXPERT: "steward/needs-expert",
  EXPERT_RUNNING: "steward/expert-running",
  ADVICE_READY: "steward/advice-ready",
  NEEDS_EVIDENCE: "steward/needs-evidence",
  REPAIR_RECOMMENDED: "steward/repair-recommended",
  OWNER_REQUIRED: "steward/owner-required",
  EXPERT_FAILED: "steward/expert-failed",
});

export const S1A_LABEL_LIST = Object.freeze(Object.values(S1A_LABELS));

/**
 * Hidden assessment comment marker (idempotency key = fingerprint + occurrence).
 * @example
 * <!-- appsolino-s1a-assessment:
 * fingerprint=abc...
 * occurrence=workflow-run:1:attempt:1
 * assessment-version=1 -->
 */
export const ASSESSMENT_MARKER_PREFIX = "<!-- appsolino-s1a-assessment:";

export const ASSESSMENT_MARKER_RE =
  /<!--\s*appsolino-s1a-assessment:\s*\n\s*fingerprint=([a-f0-9]{64})\s*\n\s*occurrence=([^\n]+?)\s*\n\s*assessment-version=(\d+)\s*-->/i;

/** Runtime bounds (deterministic engine: tokens N/A → 0). */
export const S1A_BOUNDS = Object.freeze({
  maxAttempts: 2,
  maxRuntimeMs: 600_000,
  maxTokens: 0,
  assessmentVersion: 1,
});

/**
 * Pinned default provider/model. Explicitly named — NOT a silent fallback.
 * Cursor engine is opt-in via S1A_ENGINE=cursor and fails closed without key.
 */
export const PINNED_PROVIDER = "appsolino-s1a-deterministic";
export const PINNED_MODEL = "appsolino-s1a-deterministic-v1";

export const REVIEW_VERDICT = Object.freeze({
  ACCEPT: "ACCEPT",
  REJECT: "REJECT",
  NEEDS_MORE_EVIDENCE: "NEEDS_MORE_EVIDENCE",
});

export const RISK_LEVEL = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  SENSITIVE: "SENSITIVE",
  CRITICAL: "CRITICAL",
});

export const CONFIDENCE = Object.freeze({
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
});

export const FILE_KIND = Object.freeze({
  GENERATED_BASELINE: "generated-baseline",
  SEMANTIC_SOURCE: "semantic-source",
  WORKFLOW: "workflow",
  MIGRATION: "migration",
  LOCKFILE: "lockfile",
  OTHER: "other",
});

/**
 * S1A forbidden capabilities (inherits S0 + mutation).
 */
export const S1A_FORBIDDEN = Object.freeze([
  "repair-code-generation",
  "repair-branch",
  "repair-pr",
  "workflow-dispatch-auto",
  "workflow-rerun",
  "auto-merge",
  "auto3-deploy",
  "host-d-ssh-install",
  "host-p-access",
  "candidate-checkout",
  "candidate-script-execution",
  "owner-oauth-as-routine-identity",
  "silent-provider-fallback",
]);

/** Env that enables optional S0 → S1A handoff label on new incidents (default OFF). */
export const S0_HANDOFF_ENV = "STEWARD_S0_HANDOFF_S1A";

/** Repo variable / env that enables labeled-event auto launch (default OFF). */
export const S1A_AUTO_HANDOFF_ENV = "S1A_AUTO_HANDOFF";

/**
 * @param {string} fingerprint
 * @param {string} occurrence
 * @param {number} [version]
 */
export function assessmentMarkerHtml(fingerprint, occurrence, version = S1A_BOUNDS.assessmentVersion) {
  const fp = String(fingerprint || "").toLowerCase();
  const occ = String(occurrence || "").trim();
  if (!/^[a-f0-9]{64}$/.test(fp)) {
    throw new Error("assessment marker requires sha256 hex fingerprint");
  }
  if (!occ) throw new Error("assessment marker requires occurrence id");
  return [
    ASSESSMENT_MARKER_PREFIX,
    `fingerprint=${fp}`,
    `occurrence=${occ}`,
    `assessment-version=${Number(version) || 1}`,
    "-->",
  ].join("\n");
}

/**
 * @param {string} body
 * @returns {{ fingerprint: string, occurrence: string, assessmentVersion: number } | null}
 */
export function extractAssessmentMarker(body) {
  const m = String(body || "").match(ASSESSMENT_MARKER_RE);
  if (!m) return null;
  return {
    fingerprint: m[1].toLowerCase(),
    occurrence: m[2].trim(),
    assessmentVersion: Number(m[3]) || 1,
  };
}

/**
 * Preferred worktree root for advice-only investigation notes.
 * Never used to push or open repair PRs in S1A.
 * @param {string|number} incidentId
 * @param {{ worktreeRoot?: string|null, runnerTemp?: string|null }} [env]
 */
export function resolveWorktreePath(incidentId, env = {}) {
  const id = String(incidentId || "unknown").replace(/[^0-9A-Za-z_-]/g, "") || "unknown";
  const preferred = env.worktreeRoot || process.env.S1A_WORKTREE_ROOT || "";
  if (preferred) {
    return `${String(preferred).replace(/\/$/, "")}/repair-${id}`;
  }
  const temp = env.runnerTemp || process.env.RUNNER_TEMP || "/tmp";
  return `${String(temp).replace(/\/$/, "")}/repair-${id}`;
}
