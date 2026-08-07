#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-03:
 * Authoritative AUTO-2 finalize action → expected AUTO-3 child mapping.
 * Derived from infra/scripts/auto2-finalize.mjs action schema.
 *
 * expectedAuto3Child:
 *   true  — dispatch / wait for AUTO-3 was part of the finalized path
 *   false — intentional no-child control flow (ignore, approval, dry-run, …)
 *   null  — unknown action; do not invent missing-child-timeout
 */
export const AUTO2_ACTION_EXPECTED_CHILD = Object.freeze({
  ignored: false,
  "approval-required": false,
  "expert-resolving": false,
  "ai-verifying": false,
  "refresh-required": false,
  "blocked-policy": false,
  "blocked-unresolved": false,
  "already-merged-idempotent": false,
  "auto-merge-dry-run": false,
  blocked: false,
  // Merge without an AUTO-3 wait (non-main tip / dispatch disabled).
  "auto-merged": false,
  // AUTO-3 was part of the finalize outcome.
  "auto-merged-deployed": true,
  "auto-merged-deploy-failed": true,
  "auto-merged-deploy-rolled-back": true,
  "auto-merged-deploy-critical": true,
});

/**
 * @param {string|null|undefined} action
 * @returns {boolean|null}
 */
export function expectedAuto3ChildForAction(action) {
  if (action == null || String(action).trim() === "") return null;
  const key = String(action).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(AUTO2_ACTION_EXPECTED_CHILD, key)) {
    return AUTO2_ACTION_EXPECTED_CHILD[key];
  }
  return null;
}

/**
 * Semantic parent terminal from finalize action — never invent DEPLOYED for
 * ignored / approval-required / other non-deploy successes.
 * @param {string|null|undefined} action
 * @param {string|null|undefined} workflowConclusion
 */
export function parentSemanticTerminalFromAction(action, workflowConclusion) {
  const key = String(action || "").trim().toLowerCase();
  switch (key) {
    case "ignored":
      return "IGNORED";
    case "approval-required":
      return "APPROVAL_REQUIRED";
    case "expert-resolving":
      return "EXPERT_RESOLVING";
    case "ai-verifying":
      return "AI_VERIFYING";
    case "refresh-required":
      return "REFRESH_REQUIRED";
    case "blocked-policy":
      return "BLOCKED_POLICY";
    case "blocked-unresolved":
      return "BLOCKED_UNRESOLVED";
    case "already-merged-idempotent":
      return "IDEMPOTENT_NOOP";
    case "auto-merge-dry-run":
      return "DRY_RUN";
    case "blocked":
      return "BLOCKED";
    case "auto-merged":
      return "MERGED_NO_DEPLOY";
    case "auto-merged-deployed":
      return "DEPLOYED";
    case "auto-merged-deploy-failed":
      return "DEPLOY_FAILED";
    case "auto-merged-deploy-rolled-back":
      return "ROLLED_BACK";
    case "auto-merged-deploy-critical":
      return "CRITICAL";
    default:
      break;
  }
  const c = String(workflowConclusion || "").toLowerCase();
  if (c === "skipped" || c === "neutral") return "SKIPPED";
  if (c === "cancelled") return "CANCELLED";
  if (c === "success") return "SUCCESS";
  if (c === "failure" || c === "timed_out") return "FAILED";
  return "UNKNOWN";
}

/**
 * Extract finalize action / handoff / AUTO-3 ids from untrusted logs or JSON dump.
 * @param {string} text
 * @returns {{
 *   action: string|null,
 *   handoffId: string|null,
 *   auto3RunId: string|null,
 *   expectedAuto3Child: boolean|null,
 * }}
 */
export function parseAuto2FinalizeEvidence(text) {
  const src = String(text || "");
  let action = null;
  const patterns = [
    /"action"\s*:\s*"([^"]+)"/i,
    /- action:\s*`([^`]+)`/i,
    /\baction=([A-Za-z0-9_-]+)\b/i,
  ];
  for (const re of patterns) {
    const m = src.match(re);
    if (m) {
      action = m[1];
      break;
    }
  }

  let handoffId = null;
  const handoffPatterns = [
    /"handoffId"\s*:\s*"([^"]+)"/i,
    /- handoff_id:\s*`([^`]+)`/i,
    /\bhandoff(?:_id)?=([A-Za-z0-9_-]+)\b/i,
    /\b(auto2-[A-Za-z0-9_-]+)\b/,
  ];
  for (const re of handoffPatterns) {
    const m = src.match(re);
    if (m) {
      const cand = m[1];
      if (cand && cand !== "n/a") {
        handoffId = cand;
        break;
      }
    }
  }

  let auto3RunId = null;
  const runPatterns = [
    /"auto3RunId"\s*:\s*"?(null|\d+)"?/i,
    /- auto3_run_id:\s*`([^`]+)`/i,
    /\brun=(\d+)\b/i,
  ];
  for (const re of runPatterns) {
    const m = src.match(re);
    if (m && m[1] && m[1] !== "null" && m[1] !== "n/a") {
      auto3RunId = m[1];
      break;
    }
  }

  return {
    action,
    handoffId,
    auto3RunId,
    expectedAuto3Child: expectedAuto3ChildForAction(action),
  };
}

/**
 * Workflow conclusions that are expected non-incidents for AUTO-2 validation/control flow.
 * @param {string|null|undefined} conclusion
 */
export function isExpectedNonIncidentConclusion(conclusion) {
  const c = String(conclusion || "").toLowerCase();
  return c === "skipped" || c === "neutral" || c === "cancelled";
}
