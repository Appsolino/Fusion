#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Steward S1A Expert Advisory Mode — policy constants.
 * Advice only: no repair branch, no AUTO dispatch, no Host D/P.
 */
import { existsSync, statSync } from "node:fs";

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

/** Canonical host worktree parent (fusion-owned). */
export const CANONICAL_WORKTREE_ROOT = "/srv/appsolino-fusion/phase-1/worktrees";

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
 */
export const ASSESSMENT_MARKER_PREFIX = "<!-- appsolino-s1a-assessment:";

export const ASSESSMENT_MARKER_RE =
  /<!--\s*appsolino-s1a-assessment:\s*\n\s*fingerprint=([a-f0-9]{64})\s*\n\s*occurrence=([^\n]+?)\s*\n\s*assessment-version=(\d+)\s*-->/i;

/** Runtime bounds. */
export const S1A_BOUNDS = Object.freeze({
  maxAttempts: 2,
  maxRuntimeMs: 600_000,
  maxTokens: 0,
  assessmentVersion: 1,
  artifactSchemaVersion: 1,
  maxWorkflowLogBytes: 256_000,
});

/**
 * Live AI provider/model (authorised — no silent fallback).
 */
export const LIVE_PROVIDER = "cursor-cli";
export const LIVE_MODEL = "composer-2.5";

/**
 * Fixture / CI engine ids — NEVER report as AI provider/model in live artifacts.
 */
export const FIXTURE_PROVIDER = "appsolino-s1a-fixture";
export const FIXTURE_MODEL = "appsolino-s1a-fixture-v1";

/** Alias — live pins (not fixture). */
export const PINNED_PROVIDER = LIVE_PROVIDER;
export const PINNED_MODEL = LIVE_MODEL;

/** Cursor agent binary. */
export const CURSOR_AGENT_BIN =
  process.env.S1A_CURSOR_AGENT_BIN ||
  "/home/fusion/.local/bin/cursor-agent";

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

export const S0_HANDOFF_ENV = "STEWARD_S0_HANDOFF_S1A";
export const S1A_AUTO_HANDOFF_ENV = "S1A_AUTO_HANDOFF";

/**
 * @param {string} repo
 */
export function assertRepoAllowed(repo) {
  const r = String(repo || "");
  if (r !== ALLOWED_REPO) {
    throw new Error(`repo-not-allowed:${r || "(empty)"} (only ${ALLOWED_REPO})`);
  }
  return r;
}

/**
 * Resolve engine id. Live MUST be cursor-cli; fixture/deterministic forbidden in live.
 * @param {string} mode
 * @param {string} [envEngine]
 * @returns {"fixture"|"cursor-cli"}
 */
export function resolveEngineId(mode, envEngine) {
  const m = String(mode || "").toLowerCase();
  const e = String(envEngine ?? process.env.S1A_ENGINE ?? "").toLowerCase().trim();

  if (m === "live") {
    if (!e || e === "cursor-cli" || e === "cursor") return "cursor-cli";
    if (e === "fixture" || e === "deterministic") {
      throw new Error(
        "live mode rejects fixture/deterministic engine (S1A_ENGINE must be cursor-cli)",
      );
    }
    throw new Error(`unsupported live S1A_ENGINE=${e}; require cursor-cli`);
  }

  // fixture / fixture-replay / test
  if (!e || e === "fixture" || e === "deterministic") return "fixture";
  if (e === "cursor-cli" || e === "cursor") return "cursor-cli";
  throw new Error(`unsupported S1A_ENGINE=${e}`);
}

/**
 * Provider/model pins for a resolved engine.
 * @param {"fixture"|"cursor-cli"} engineId
 */
export function pinsForEngine(engineId) {
  if (engineId === "fixture") {
    return { provider: FIXTURE_PROVIDER, model: FIXTURE_MODEL };
  }
  return { provider: LIVE_PROVIDER, model: LIVE_MODEL };
}

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
 * Preferred worktree path for advice-only investigation notes.
 * Never used to push or open repair PRs in S1A.
 * @param {string|number} incidentId
 * @param {{ worktreeRoot?: string|null, runnerTemp?: string|null, mode?: string }} [env]
 */
export function resolveWorktreePath(incidentId, env = {}) {
  const id = String(incidentId || "unknown").replace(/[^0-9A-Za-z_-]/g, "") || "unknown";
  const root = resolveAuthorizedWorktreeRoot(env);
  return `${root}/repair-${id}`;
}

/**
 * Resolve authorised worktree parent.
 * Live fail-closed unless explicit S1A_WORKTREE_ROOT or canonical fusion root exists.
 * @param {{ worktreeRoot?: string|null, runnerTemp?: string|null, mode?: string }} [env]
 */
export function resolveAuthorizedWorktreeRoot(env = {}) {
  const mode = String(env.mode || process.env.S1A_MODE || "").toLowerCase();
  const preferred = env.worktreeRoot || process.env.S1A_WORKTREE_ROOT || "";
  if (preferred) {
    return String(preferred).replace(/\/$/, "");
  }
  try {
    if (existsSync(CANONICAL_WORKTREE_ROOT)) {
      const st = statSync(CANONICAL_WORKTREE_ROOT);
      if (st.isDirectory()) {
        return CANONICAL_WORKTREE_ROOT;
      }
    }
  } catch {
    /* fall through */
  }
  if (mode === "live") {
    throw new Error(
      "live mode fail-closed: set S1A_WORKTREE_ROOT to an authorised writable root " +
        `(canonical ${CANONICAL_WORKTREE_ROOT}/repair-<id>)`,
    );
  }
  const temp = env.runnerTemp || process.env.RUNNER_TEMP || "/tmp";
  return String(temp).replace(/\/$/, "");
}
