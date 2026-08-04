#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Validate whether an issue is eligible for S1A expert advisory.
 */
import { extractFingerprintFromIssueBody } from "../policy.mjs";
import {
  ALLOWED_REPO,
  S1A_LABELS,
  STEWARD_ISSUE_LABEL,
} from "./policy.mjs";

/**
 * @typedef {{
 *   number: number,
 *   state: string,
 *   body?: string,
 *   labels?: Array<string|{name:string}>,
 * }} IssueLike
 */

/**
 * Normalize label names from GitHub issue payload.
 * @param {IssueLike} issue
 * @returns {string[]}
 */
export function labelNames(issue) {
  const raw = issue?.labels || [];
  return raw.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);
}

/**
 * @param {{
 *   repo: string,
 *   issue: IssueLike | null | undefined,
 * }} input
 * @returns {{
 *   eligible: boolean,
 *   reason: string,
 *   fingerprint: string|null,
 *   labels: string[],
 * }}
 */
export function checkEligibility(input) {
  const repo = String(input.repo || "");
  if (repo !== ALLOWED_REPO) {
    return {
      eligible: false,
      reason: `repo-not-allowed:${repo || "(empty)"}`,
      fingerprint: null,
      labels: [],
    };
  }

  const issue = input.issue;
  if (!issue || !issue.number) {
    return {
      eligible: false,
      reason: "issue-missing",
      fingerprint: null,
      labels: [],
    };
  }

  if (String(issue.state || "").toLowerCase() !== "open") {
    return {
      eligible: false,
      reason: "issue-not-open",
      fingerprint: null,
      labels: labelNames(issue),
    };
  }

  const labels = labelNames(issue);
  if (!labels.includes(STEWARD_ISSUE_LABEL)) {
    return {
      eligible: false,
      reason: "missing-steward-label",
      fingerprint: null,
      labels,
    };
  }

  const fingerprint = extractFingerprintFromIssueBody(issue.body || "");
  if (!fingerprint) {
    return {
      eligible: false,
      reason: "invalid-or-missing-fingerprint",
      fingerprint: null,
      labels,
    };
  }

  if (!labels.includes(S1A_LABELS.NEEDS_EXPERT)) {
    return {
      eligible: false,
      reason: "missing-needs-expert-label",
      fingerprint,
      labels,
    };
  }

  if (labels.includes(S1A_LABELS.EXPERT_RUNNING)) {
    return {
      eligible: false,
      reason: "active-expert-lock",
      fingerprint,
      labels,
    };
  }

  return {
    eligible: true,
    reason: "ok",
    fingerprint,
    labels,
  };
}
