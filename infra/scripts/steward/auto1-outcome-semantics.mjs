#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-03:
 * Authoritative AUTO-1 structured result → steward treatment.
 * Derived from infra/scripts/auto1-upstream-sync.mjs return / status shape.
 *
 * Outcome table:
 *   no-change → no incident
 *   merged    → no incident (AUTO-2 continues)
 *   conflict  → upstream-merge-conflict
 *   unknown   → needs-triage (never invent correlation-race)
 */
import { FAILURE_CLASS, TERMINAL_STATUS, WORKFLOW_FAMILY } from "./policy.mjs";

export const AUTO1_OUTCOME = Object.freeze({
  NO_CHANGE: "no-change",
  MERGED: "merged",
  CONFLICT: "conflict",
});

/**
 * @param {string|null|undefined} outcome
 * @returns {"no-incident"|"upstream-merge-conflict"|"needs-triage"|null}
 */
export function treatmentForAuto1Outcome(outcome) {
  const key = String(outcome || "").trim().toLowerCase();
  switch (key) {
    case AUTO1_OUTCOME.NO_CHANGE:
    case AUTO1_OUTCOME.MERGED:
      return "no-incident";
    case AUTO1_OUTCOME.CONFLICT:
      return "upstream-merge-conflict";
    case "":
      return null;
    default:
      return "needs-triage";
  }
}

/**
 * Explicit AUTO-3 handoff / child-selection evidence (not bare "handoff" in paths).
 * @param {string} text
 */
export function hasExplicitAuto3HandoffEvidence(text) {
  const src = String(text || "");
  return /selectCorrelated|wrong-?auto3-?child|wrong.?child.?selected|newest-run|ISS-AUTO-003|unrelated older|auto3-run-selection/i.test(
    src,
  );
}

/**
 * Extract AUTO-1 structured result from untrusted logs or JSON dump.
 * @param {string} text
 * @returns {{
 *   outcome: string|null,
 *   conflict: boolean|null,
 *   upstreamSha: string|null,
 *   prUrl: string|null,
 *   conflictedFiles: string[],
 *   touchesWorkflows: boolean|null,
 *   touchesMigrations: boolean|null,
 *   touchesLockfile: boolean|null,
 *   mutatedMain: boolean|null,
 *   deployedHostD: boolean|null,
 * }}
 */
export function parseAuto1ResultEvidence(text) {
  const src = String(text || "");

  let outcome = null;
  const outcomePatterns = [
    /"outcome"\s*:\s*"(no-change|merged|conflict)"/i,
    /\boutcome=(no-change|merged|conflict)\b/i,
  ];
  for (const re of outcomePatterns) {
    const m = src.match(re);
    if (m) {
      outcome = m[1].toLowerCase();
      break;
    }
  }

  let conflict = null;
  const conflictMatch = src.match(/"conflict"\s*:\s*(true|false)\b/i);
  if (conflictMatch) conflict = conflictMatch[1].toLowerCase() === "true";
  else if (outcome === AUTO1_OUTCOME.CONFLICT) conflict = true;
  else if (outcome === AUTO1_OUTCOME.MERGED || outcome === AUTO1_OUTCOME.NO_CHANGE) conflict = false;

  let upstreamSha = null;
  const shaMatch = src.match(/"upstreamSha"\s*:\s*"([0-9a-f]{7,40})"/i);
  if (shaMatch) upstreamSha = shaMatch[1];

  let prUrl = null;
  const prPatterns = [
    /"prUrl"\s*:\s*"(https:\/\/github\.com\/[^"]+\/pull\/\d+)"/i,
    /\bprUrl=(https:\/\/github\.com\/\S+\/pull\/\d+)/i,
  ];
  for (const re of prPatterns) {
    const m = src.match(re);
    if (m) {
      prUrl = m[1];
      break;
    }
  }

  /** @type {string[]} */
  let conflictedFiles = [];
  const filesBlock = src.match(
    /"conflictedFiles"\s*:\s*\[([\s\S]*?)\]/,
  );
  if (filesBlock) {
    const quoted = filesBlock[1].matchAll(/"([^"\n]+)"/g);
    for (const m of quoted) conflictedFiles.push(m[1]);
  }

  /**
   * @param {string} key
   * @returns {boolean|null}
   */
  function boolField(key) {
    const m = src.match(new RegExp(`"${key}"\\s*:\\s*(true|false)\\b`, "i"));
    if (!m) return null;
    return m[1].toLowerCase() === "true";
  }

  return {
    outcome,
    conflict,
    upstreamSha,
    prUrl,
    conflictedFiles,
    touchesWorkflows: boolField("touchesWorkflows"),
    touchesMigrations: boolField("touchesMigrations"),
    touchesLockfile: boolField("touchesLockfile"),
    mutatedMain: boolField("mutatedMain"),
    deployedHostD: boolField("deployedHostD"),
  };
}

/**
 * Map parsed AUTO-1 result to normalizeEvidence input fields.
 * @param {ReturnType<typeof parseAuto1ResultEvidence>} result
 * @param {{ workflowName?: string, runId?: string|number, attempt?: string|number, conclusion?: string|null, logText?: string, sourceSha?: string|null }} ctx
 */
export function normalizeInputFromAuto1Result(result, ctx = {}) {
  const treatment = treatmentForAuto1Outcome(result.outcome);
  const base = {
    workflowName: ctx.workflowName || "Upstream AUTO-1 Sync",
    workflowFamily: WORKFLOW_FAMILY.auto1,
    runId: ctx.runId ?? "0",
    attempt: ctx.attempt || 1,
    logText: ctx.logText || "",
    sourceSha: ctx.sourceSha ?? null,
    conflictPaths: result.conflictedFiles || [],
    auto1Result: result,
  };

  if (treatment === "no-incident") {
    return {
      ...base,
      success: true,
      terminalStatus: result.outcome === AUTO1_OUTCOME.NO_CHANGE
        ? TERMINAL_STATUS.IDEMPOTENT_NOOP
        : TERMINAL_STATUS.SUCCESS,
      errorMessage: `auto1 outcome ${result.outcome}`,
    };
  }

  if (treatment === "upstream-merge-conflict") {
    return {
      ...base,
      success: false,
      forceIncident: true,
      failureClass: FAILURE_CLASS.UPSTREAM_MERGE_CONFLICT,
      terminalStatus: TERMINAL_STATUS.CONFLICT,
      component: "upstream-sync",
      phase: "auto1-merge",
      errorMessage: "upstream-merge-conflict",
    };
  }

  // Unknown / absent structured outcome with failed conclusion → needs-triage.
  const conclusion = String(ctx.conclusion || "").toLowerCase();
  const failed = conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled";
  if (treatment === "needs-triage" || (treatment == null && failed)) {
    return {
      ...base,
      success: false,
      forceIncident: true,
      failureClass: FAILURE_CLASS.NEEDS_TRIAGE,
      terminalStatus: TERMINAL_STATUS.FAILED,
      errorMessage: result.outcome
        ? `unknown auto1 outcome ${result.outcome}`
        : "auto1 failed without structured outcome",
    };
  }

  return null;
}

/**
 * @param {string|null|undefined} workflowName
 * @param {string|null|undefined} workflowFamily
 */
export function isAuto1Workflow(workflowName, workflowFamily) {
  if (String(workflowFamily || "").toLowerCase() === WORKFLOW_FAMILY.auto1) return true;
  return /AUTO-1/i.test(String(workflowName || ""));
}
