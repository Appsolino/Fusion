#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamSensitiveExpert 2026-08-07-04:10:
 * SENSITIVE no longer means "assign owner and stop".
 * It means stronger validation: deterministic suites → real AI expert → independent AI verifier
 * → expanded suites → isolated Host D proof when relevant.
 * Owner escalation only for genuine policy/authority (Host P, production, destructive data,
 * secret expansion, governing-policy change). Merge conflicts, failed tests, large diffs,
 * auth-file changes, and runtime changes are engineering problems for the AI expert.
 */
import { parseUpstreamShaFromBranch } from "./rolling-candidate.mjs";
import { assertFinalizerFreshness } from "./rolling-candidate.mjs";

export const LABEL_EXPERT_RESOLVING = "auto2:expert-resolving";
export const LABEL_AI_VERIFYING = "auto2:ai-verifying";
export const LABEL_REFRESH_REQUIRED = "auto2:refresh-required";
export const LABEL_BLOCKED_POLICY = "auto2:blocked-policy";

/**
 * Authority signals that legitimately require owner — not engineering difficulty.
 * @param {{
 *   hostP?: boolean,
 *   production?: boolean,
 *   destructiveData?: boolean,
 *   secretExpansion?: boolean,
 *   governingPolicyChange?: boolean,
 *   explicitUnresolvedSecurityAcceptance?: boolean,
 * }} auth
 */
export function isGenuineOwnerPolicyDecision(auth = {}) {
  return Boolean(
    auth.hostP ||
    auth.production ||
    auth.destructiveData ||
    auth.secretExpansion ||
    auth.governingPolicyChange ||
    auth.explicitUnresolvedSecurityAcceptance,
  );
}

/**
 * Map AUTO-2 sensitive/medium classification into next automation action.
 *
 * @param {{
 *   riskClass: string,
 *   ownerPolicy?: object,
 *   expertCompleted?: boolean,
 *   expertDecision?: string|null,
 *   verifierVerdict?: string|null,
 *   deterministicPassed?: boolean,
 *   liveUpstreamHead?: string|null,
 *   candidateUpstreamSha?: string|null,
 *   skipUpstreamFreshnessCheck?: boolean,
 *   legacyOwnerApprovalOk?: boolean,
 * }} input
 */
export function resolveSensitiveContinuation(input) {
  const risk = String(input.riskClass || "").toLowerCase();
  if (risk !== "sensitive" && risk !== "medium") {
    return { action: "continue-normal", reason: "not sensitive/medium" };
  }

  if (isGenuineOwnerPolicyDecision(input.ownerPolicy || {})) {
    return {
      action: "blocked-policy",
      reason: "genuine owner/policy authority decision required",
      label: LABEL_BLOCKED_POLICY,
    };
  }

  if (input.skipUpstreamFreshnessCheck !== true) {
    const fres = assertFinalizerFreshness({
      candidateUpstreamSha: input.candidateUpstreamSha,
      liveUpstreamHead: input.liveUpstreamHead,
      candidateBaseAppsolinoSha: input.candidateBaseAppsolinoSha,
      liveAppsolinoMain: input.liveAppsolinoMain,
    });
    if (!fres.ok && fres.action === "REFRESH_REQUIRED") {
      return {
        action: "refresh-required",
        reason: fres.reason,
        label: LABEL_REFRESH_REQUIRED,
        mismatch: fres.mismatch || null,
      };
    }
    if (!fres.ok) {
      return {
        action: "blocked-unresolved",
        reason: fres.reason,
        mismatch: fres.mismatch || null,
      };
    }
  }

  // Legacy owner APPROVED on exact head remains a valid fast-path (do not break existing approve workflow).
  if (input.legacyOwnerApprovalOk === true && input.deterministicPassed !== false) {
    return {
      action: "merge-eligible",
      reason: "verified exact-head owner approval (legacy sensitive path) with freshness OK",
    };
  }

  if (input.expertCompleted === true && input.verifierVerdict === "APPROVE" && input.deterministicPassed === true) {
    return {
      action: "merge-eligible",
      reason: "expert RESOLVED + independent verifier APPROVE + deterministic gates passed",
    };
  }

  if (input.expertCompleted === true && input.verifierVerdict === "REQUEST_CHANGES") {
    return {
      action: "expert-resolving",
      reason: "independent AI verifier REQUEST_CHANGES — return to expert repair loop",
      label: LABEL_EXPERT_RESOLVING,
    };
  }

  if (input.expertCompleted === true && input.verifierVerdict === "BLOCK_POLICY") {
    return {
      action: "blocked-policy",
      reason: "independent AI verifier BLOCK_POLICY",
      label: LABEL_BLOCKED_POLICY,
    };
  }

  if (input.expertCompleted === true && input.deterministicPassed === false) {
    return {
      action: "expert-resolving",
      reason: "deterministic gates still failing after expert claim — AI cannot bypass tests",
      label: LABEL_EXPERT_RESOLVING,
    };
  }

  if (input.expertCompleted !== true) {
    return {
      action: "expert-resolving",
      reason: "SENSITIVE/MEDIUM → real AI expert analysis (owner is not the technical fallback)",
      label: LABEL_EXPERT_RESOLVING,
    };
  }

  return {
    action: "ai-verifying",
    reason: "expert completed — independent AI verification required",
    label: LABEL_AI_VERIFYING,
  };
}

/**
 * @param {string} headRefName
 * @param {string|null|undefined} liveUpstreamHead
 */
export function candidateUpstreamFromHead(headRefName, liveUpstreamHead) {
  return parseUpstreamShaFromBranch(headRefName) || liveUpstreamHead || null;
}
