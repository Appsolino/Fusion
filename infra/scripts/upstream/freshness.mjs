#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamFreshness 2026-08-07-03:50:
 * Explicit freshness invariant for Appsolino↔Runfusion upstream absorption.
 * Workflow success alone is never FRESH. FRESH requires integratedUpstreamSha == upstreamHead
 * (or an accepted zero-distance policy) with no stale open automation candidate.
 * Owner is not the normal fallback for technical lag — STALE / REFRESH_REQUIRED / EXPERT_RESOLVING
 * are first-class unhealthy or in-progress states.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export const FRESHNESS_SCHEMA_VERSION = 1;
export const FRESHNESS_STATUS_PATH = ".appsolino/upstream-freshness.json";

/** @typedef {(
 *   "FRESH" |
 *   "UPSTREAM_CHANGED" |
 *   "CANDIDATE_BUILDING" |
 *   "PATCH_RECONCILING" |
 *   "CANDIDATE_VALIDATING" |
 *   "EXPERT_RESOLVING" |
 *   "AI_VERIFYING" |
 *   "HOST_D_VERIFYING" |
 *   "REFRESH_REQUIRED" |
 *   "BLOCKED_POLICY" |
 *   "BLOCKED_UNRESOLVED" |
 *   "STALE"
 * )} FreshnessState */

export const FRESHNESS_STATES = Object.freeze([
  "FRESH",
  "UPSTREAM_CHANGED",
  "CANDIDATE_BUILDING",
  "PATCH_RECONCILING",
  "CANDIDATE_VALIDATING",
  "EXPERT_RESOLVING",
  "AI_VERIFYING",
  "HOST_D_VERIFYING",
  "REFRESH_REQUIRED",
  "BLOCKED_POLICY",
  "BLOCKED_UNRESOLVED",
  "STALE",
]);

/** States that must never be reported as overall automation-healthy / green. */
export const UNHEALTHY_FRESHNESS_STATES = Object.freeze([
  "UPSTREAM_CHANGED",
  "REFRESH_REQUIRED",
  "BLOCKED_POLICY",
  "BLOCKED_UNRESOLVED",
  "STALE",
]);

/** In-progress states — not FRESH, not terminal failure. */
export const IN_PROGRESS_FRESHNESS_STATES = Object.freeze([
  "CANDIDATE_BUILDING",
  "PATCH_RECONCILING",
  "CANDIDATE_VALIDATING",
  "EXPERT_RESOLVING",
  "AI_VERIFYING",
  "HOST_D_VERIFYING",
]);

/**
 * @param {string|null|undefined} sha
 * @returns {boolean}
 */
export function isFullSha(sha) {
  return typeof sha === "string" && /^[0-9a-f]{40}$/i.test(sha.trim());
}

/**
 * Normalize short or long SHAs for equality when both sides available.
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 */
export function shaEquals(a, b) {
  if (!a || !b) return false;
  const x = String(a).trim().toLowerCase();
  const y = String(b).trim().toLowerCase();
  if (x === y) return true;
  const n = Math.min(x.length, y.length);
  if (n < 7) return false;
  return x.slice(0, n) === y.slice(0, n) || y.startsWith(x) || x.startsWith(y);
}

/**
 * Pure freshness evaluation. Never invents SHAs.
 *
 * @param {{
 *   upstreamHead: string|null,
 *   integratedUpstreamSha: string|null,
 *   candidateUpstreamSha?: string|null,
 *   candidateAppsolinoSha?: string|null,
 *   commitsBehindIntegrated?: number|null,
 *   commitsBehindCandidate?: number|null,
 *   activeCandidatePr?: number|null,
 *   activeCandidateState?: string|null,
 *   expertActive?: boolean,
 *   aiVerifierActive?: boolean,
 *   hostDProofRequired?: boolean,
 *   hostDProofComplete?: boolean,
 *   blockedPolicy?: boolean,
 *   blockedUnresolved?: boolean,
 *   blockedReason?: string|null,
 *   lastCheckedAt?: string|null,
 *   lastIntegratedAt?: string|null,
 *   auto1Outcome?: string|null,
 *   auto2Action?: string|null,
 * }} input
 */
export function evaluateFreshness(input) {
  const upstreamHead = input.upstreamHead ? String(input.upstreamHead).trim().toLowerCase() : null;
  const integrated = input.integratedUpstreamSha
    ? String(input.integratedUpstreamSha).trim().toLowerCase()
    : null;
  const candidateUpstream = input.candidateUpstreamSha
    ? String(input.candidateUpstreamSha).trim().toLowerCase()
    : null;

  const behindIntegrated =
    input.commitsBehindIntegrated != null
      ? Number(input.commitsBehindIntegrated)
      : upstreamHead && integrated && !shaEquals(upstreamHead, integrated)
        ? null
        : upstreamHead && integrated && shaEquals(upstreamHead, integrated)
          ? 0
          : null;

  const behindCandidate =
    input.commitsBehindCandidate != null
      ? Number(input.commitsBehindCandidate)
      : upstreamHead && candidateUpstream && !shaEquals(upstreamHead, candidateUpstream)
        ? null
        : upstreamHead && candidateUpstream && shaEquals(upstreamHead, candidateUpstream)
          ? 0
          : null;

  /** @type {string[]} */
  const reasons = [];
  /** @type {FreshnessState} */
  let state;

  if (input.blockedPolicy === true) {
    state = "BLOCKED_POLICY";
    reasons.push(input.blockedReason || "policy authority required");
  } else if (input.blockedUnresolved === true) {
    state = "BLOCKED_UNRESOLVED";
    reasons.push(input.blockedReason || "engineering problem unresolved after bounded expert loop");
  } else if (!upstreamHead) {
    state = "BLOCKED_UNRESOLVED";
    reasons.push("upstreamHead missing — cannot assert freshness");
  } else if (!integrated) {
    state = "STALE";
    reasons.push("integratedUpstreamSha not tracked");
  } else if (behindIntegrated != null && behindIntegrated > 0) {
    // Upstream moved past what Appsolino has integrated.
    if (candidateUpstream && !shaEquals(candidateUpstream, upstreamHead)) {
      state = "REFRESH_REQUIRED";
      reasons.push(
        `active candidate targets ${candidateUpstream.slice(0, 12)} but upstreamHead is ${upstreamHead.slice(0, 12)}`,
      );
    } else if (candidateUpstream && shaEquals(candidateUpstream, upstreamHead)) {
      if (input.hostDProofRequired && !input.hostDProofComplete) {
        state = "HOST_D_VERIFYING";
        reasons.push("candidate matches upstream; Host D proof required");
      } else if (input.aiVerifierActive) {
        state = "AI_VERIFYING";
        reasons.push("independent AI verification in progress");
      } else if (input.expertActive || input.auto2Action === "expert-resolving") {
        state = "EXPERT_RESOLVING";
        reasons.push("AI expert resolving engineering problems on current candidate");
      } else if (input.auto2Action === "patch-reconciling" || input.activeCandidateState === "patch-reconciling") {
        state = "PATCH_RECONCILING";
        reasons.push("reconciling Appsolino product patches against clean upstream");
      } else if (
        input.auto2Action === "approval-required" ||
        input.activeCandidateState === "validating"
      ) {
        // FNXC:UpstreamFreshness 2026-08-07-03:50:
        // approval-required without expert handoff is STALE unhealthy — not a healthy parked state.
        if (input.auto2Action === "approval-required" && !input.expertActive) {
          state = "STALE";
          reasons.push(
            "SENSITIVE/approval-required parked without AI expert continuation while Appsolino is behind upstream",
          );
        } else {
          state = "CANDIDATE_VALIDATING";
          reasons.push("candidate matches upstream; validation in progress");
        }
      } else if (input.auto1Outcome === "merged" || input.activeCandidateState === "building") {
        state = "CANDIDATE_BUILDING";
        reasons.push("candidate matches upstream; build/PR preparation");
      } else {
        state = "UPSTREAM_CHANGED";
        reasons.push(
          `integrated ${integrated.slice(0, 12)} is ${behindIntegrated} commit(s) behind upstream ${upstreamHead.slice(0, 12)}`,
        );
      }
    } else {
      // Behind, no current candidate for live tip.
      state = behindIntegrated >= 5 ? "STALE" : "UPSTREAM_CHANGED";
      reasons.push(
        `integrated ${integrated.slice(0, 12)} is ${behindIntegrated} commit(s) behind upstream ${upstreamHead.slice(0, 12)}; no current rolling candidate`,
      );
    }
  } else if (candidateUpstream && upstreamHead && !shaEquals(candidateUpstream, upstreamHead)) {
    // Integrated is current, but a leftover candidate is obsolete.
    state = "REFRESH_REQUIRED";
    reasons.push("obsolete automation candidate targets an older upstream SHA");
  } else if (shaEquals(upstreamHead, integrated) && (behindIntegrated === 0 || behindIntegrated == null)) {
    state = "FRESH";
    reasons.push("integratedUpstreamSha matches upstreamHead");
  } else {
    state = "STALE";
    reasons.push("unable to prove FRESH from available SHA/distance inputs");
  }

  const overallHealthy = state === "FRESH";
  const overallUnhealthy = UNHEALTHY_FRESHNESS_STATES.includes(state);

  return {
    schemaVersion: FRESHNESS_SCHEMA_VERSION,
    upstreamHead,
    integratedUpstreamSha: integrated,
    candidateUpstreamSha: candidateUpstream,
    candidateAppsolinoSha: input.candidateAppsolinoSha
      ? String(input.candidateAppsolinoSha).trim().toLowerCase()
      : null,
    commitsBehindIntegrated: behindIntegrated,
    commitsBehindCandidate: behindCandidate,
    state,
    overallHealthy,
    overallUnhealthy,
    inProgress: IN_PROGRESS_FRESHNESS_STATES.includes(state),
    activeCandidatePr: input.activeCandidatePr ?? null,
    reasons,
    lastCheckedAt: input.lastCheckedAt || new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    lastIntegratedAt: input.lastIntegratedAt || null,
    expertActive: Boolean(input.expertActive),
    aiVerifierActive: Boolean(input.aiVerifierActive),
    auto1Outcome: input.auto1Outcome || null,
    auto2Action: input.auto2Action || null,
    blockedReason: input.blockedReason || null,
  };
}

/**
 * Architectural guard: AUTO-1/AUTO-2 success must not imply FRESH when behind.
 * @param {{ auto1Success?: boolean, auto2Success?: boolean, commitsBehindIntegrated: number, state?: FreshnessState }} input
 */
export function assertNoFalseGreen(input) {
  const behind = Number(input.commitsBehindIntegrated || 0);
  const state = input.state;
  if (behind > 0 && state === "FRESH") {
    return {
      ok: false,
      violation: "false-green-fresh-while-behind",
      detail: `state=FRESH but commitsBehindIntegrated=${behind}`,
    };
  }
  if (behind > 0 && input.auto1Success === true && input.auto2Success === true && state === "FRESH") {
    return {
      ok: false,
      violation: "false-green-workflows-while-behind",
      detail: "AUTO-1 and AUTO-2 success cannot yield FRESH while behind upstream",
    };
  }
  if (behind >= 5 && !UNHEALTHY_FRESHNESS_STATES.includes(/** @type {FreshnessState} */ (state)) && state !== "EXPERT_RESOLVING" && state !== "AI_VERIFYING" && state !== "CANDIDATE_VALIDATING" && state !== "CANDIDATE_BUILDING" && state !== "PATCH_RECONCILING" && state !== "HOST_D_VERIFYING") {
    return {
      ok: false,
      violation: "stale-not-marked-unhealthy",
      detail: `behind=${behind} state=${state}`,
    };
  }
  return { ok: true, violation: null, detail: null };
}

/**
 * @param {string} path
 * @param {ReturnType<typeof evaluateFreshness>} status
 */
export function writeFreshnessStatus(path, status) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`);
  return path;
}

/**
 * @param {string} path
 */
export function readFreshnessStatus(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Build a concise human status report (Phase 13).
 * @param {ReturnType<typeof evaluateFreshness> & {
 *   expertModel?: string|null,
 *   verifierModel?: string|null,
 *   verifierVerdict?: string|null,
 *   patchesRetained?: string[],
 *   patchesRetired?: string[],
 *   suitesPassed?: string[],
 *   hostDProof?: string|null,
 * }} status
 */
export function formatFreshnessReport(status) {
  const lines = [
    "## Upstream freshness",
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| State | **${status.state}** |`,
    `| Overall healthy | ${status.overallHealthy ? "YES" : "NO"} |`,
    `| Upstream HEAD | \`${status.upstreamHead || "n/a"}\` |`,
    `| Integrated upstream | \`${status.integratedUpstreamSha || "n/a"}\` |`,
    `| Candidate upstream | \`${status.candidateUpstreamSha || "n/a"}\` |`,
    `| Candidate Appsolino base | \`${status.candidateAppsolinoSha || "n/a"}\` |`,
    `| Commits behind (integrated) | ${status.commitsBehindIntegrated ?? "n/a"} |`,
    `| Commits behind (candidate) | ${status.commitsBehindCandidate ?? "n/a"} |`,
    `| Active candidate PR | ${status.activeCandidatePr ?? "none"} |`,
    `| AI expert active | ${status.expertActive ? "YES" : "NO"} |`,
    `| Expert model | \`${status.expertModel || "n/a"}\` |`,
    `| AI verifier active | ${status.aiVerifierActive ? "YES" : "NO"} |`,
    `| Verifier model | \`${status.verifierModel || "n/a"}\` |`,
    `| Verifier verdict | ${status.verifierVerdict || "n/a"} |`,
    `| Host D proof | ${status.hostDProof || "n/a"} |`,
    `| Last checked | ${status.lastCheckedAt || "n/a"} |`,
    `| Last integrated | ${status.lastIntegratedAt || "n/a"} |`,
    "",
    "### Why",
    ...(status.reasons || []).map((r) => `- ${r}`),
    "",
    "### Patches retained",
    ...((status.patchesRetained && status.patchesRetained.length)
      ? status.patchesRetained.map((p) => `- ${p}`)
      : ["- _none listed_"]),
    "",
    "### Patches retired",
    ...((status.patchesRetired && status.patchesRetired.length)
      ? status.patchesRetired.map((p) => `- ${p}`)
      : ["- _none listed_"]),
    "",
    "### Deterministic suites passed",
    ...((status.suitesPassed && status.suitesPassed.length)
      ? status.suitesPassed.map((s) => `- ${s}`)
      : ["- _none listed_"]),
  ];
  return `${lines.join("\n")}\n`;
}
