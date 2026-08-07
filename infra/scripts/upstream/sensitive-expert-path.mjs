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
export const LABEL_SENSITIVE_REVIEW = "auto2:sensitive-review";
export const LABEL_REFRESH_REQUIRED = "auto2:refresh-required";
export const LABEL_BLOCKED_POLICY = "auto2:blocked-policy";

/**
 * FNXC:UpstreamLatency 2026-08-07-13:50:
 * Split SENSITIVE continuation: deterministic PASS → read-only SENSITIVE_REVIEW
 * (independent verifier). Edit-capable resolver only for REPAIR_REQUIRED
 * (deterministic FAIL, conflict, or verifier REQUEST_CHANGES). Latency audit
 * showed most wall-clock burned by unnecessary edit agents on clean candidates.
 */
export function classifySensitiveWorkMode(input = {}) {
  if (input.deterministicPassed === false) return "REPAIR_REQUIRED";
  if (input.repairRequired === true) return "REPAIR_REQUIRED";
  if (input.hasMergeConflict === true || input.hasPatchConflict === true) return "REPAIR_REQUIRED";
  if (input.verifierVerdict === "REQUEST_CHANGES") return "REPAIR_REQUIRED";
  if (input.deterministicPassed === true) return "SENSITIVE_REVIEW";
  // Unknown deterministic outcome — fail closed to repair (do not invent green).
  return "REPAIR_REQUIRED";
}

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
 *   verifierCompleted?: boolean,
 *   deterministicPassed?: boolean,
 *   repairRequired?: boolean,
 *   hasMergeConflict?: boolean,
 *   hasPatchConflict?: boolean,
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

  if (
    (input.expertCompleted === true || input.verifierCompleted === true) &&
    input.verifierVerdict === "APPROVE" &&
    input.deterministicPassed === true
  ) {
    return {
      action: "merge-eligible",
      reason: "independent verifier APPROVE + deterministic gates passed",
    };
  }

  if (input.verifierVerdict === "REQUEST_CHANGES") {
    return {
      action: "expert-resolving",
      reason: "independent AI verifier REQUEST_CHANGES — targeted REPAIR_REQUIRED",
      label: LABEL_EXPERT_RESOLVING,
      workMode: "REPAIR_REQUIRED",
    };
  }

  if (input.verifierVerdict === "BLOCK_POLICY") {
    return {
      action: "blocked-policy",
      reason: "independent AI verifier BLOCK_POLICY",
      label: LABEL_BLOCKED_POLICY,
    };
  }

  if (input.deterministicPassed === false) {
    return {
      action: "expert-resolving",
      reason: "deterministic gates failing — REPAIR_REQUIRED (edit-capable resolver)",
      label: LABEL_EXPERT_RESOLVING,
      workMode: "REPAIR_REQUIRED",
    };
  }

  const workMode = classifySensitiveWorkMode(input);

  /*
  FNXC:UpstreamLatency 2026-08-07-13:50:
  Clean deterministic SENSITIVE candidates go to read-only sensitive-review first.
  Do not open an edit-capable resolver "to find a problem".
  */
  if (workMode === "SENSITIVE_REVIEW" && input.verifierCompleted !== true && input.expertCompleted !== true) {
    return {
      action: "sensitive-review",
      reason:
        "SENSITIVE_REVIEW — deterministic validation already PASS; read-only independent AI verifier (no edit agent)",
      label: LABEL_SENSITIVE_REVIEW,
      workMode: "SENSITIVE_REVIEW",
    };
  }

  if (workMode === "REPAIR_REQUIRED" && input.expertCompleted !== true) {
    return {
      action: "expert-resolving",
      reason: "REPAIR_REQUIRED — edit-capable AI expert for known failure/conflict",
      label: LABEL_EXPERT_RESOLVING,
      workMode: "REPAIR_REQUIRED",
    };
  }

  return {
    action: "ai-verifying",
    reason: "independent AI verification required",
    label: LABEL_AI_VERIFYING,
    workMode,
  };
}

/**
 * @param {string} headRefName
 * @param {string|null|undefined} liveUpstreamHead
 */
export function candidateUpstreamFromHead(headRefName, liveUpstreamHead) {
  return parseUpstreamShaFromBranch(headRefName) || liveUpstreamHead || null;
}
