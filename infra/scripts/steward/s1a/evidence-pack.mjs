#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Build an S1A evidence pack from a steward incident issue body (+ optional PR fields).
 * Physical state: NEVER invent safe defaults. Unknown → null.
 */
import { extractFingerprintFromIssueBody } from "../policy.mjs";

/**
 * @typedef {{
 *   fingerprint: string,
 *   failureClass: string|null,
 *   workflowFamily: string|null,
 *   phase: string|null,
 *   component: string|null,
 *   terminalStatus: string|null,
 *   errorSignature: string|null,
 *   occurrenceIds: string[],
 *   latestOccurrenceId: string|null,
 *   auto1: {
 *     outcome: string|null,
 *     upstreamSha: string|null,
 *     prUrl: string|null,
 *     conflictedFiles: string[],
 *     touchesWorkflows: boolean|null,
 *     touchesMigrations: boolean|null,
 *     touchesLockfile: boolean|null,
 *     mutatedMain: boolean|null,
 *     deployedHostD: boolean|null,
 *   },
 *   relatedPr: {
 *     number: number|null,
 *     url: string|null,
 *     title: string|null,
 *     changedFiles: string[],
 *     patchExcerpt: string|null,
 *     touchesWorkflows: boolean|null,
 *     touchesMigrations: boolean|null,
 *     touchesLockfile: boolean|null,
 *   } | null,
 *   physical: {
 *     mutatedMain: boolean|null,
 *     deployedHostD: boolean|null,
 *     hostPAccessed: boolean|null,
 *     enginePaused: boolean|null,
 *   },
 *   comments: Array<{ id?: number, user?: string, bodyExcerpt?: string }>|null,
 *   workflowLogs: { runId: string|null, excerpt: string|null, truncated: boolean }|null,
 *   conflictFileSides: Record<string, object>|null,
 *   gitPathLog: string|null,
 *   auto3Evidence: object|null,
 *   worktreePath: string|null,
 *   issueNumber: number|null,
 *   issueTitle: string|null,
 * }} EvidencePack
 */

/**
 * @param {string} body
 * @returns {string[]}
 */
export function extractOccurrenceIds(body) {
  const ids = [];
  const re = /occurrence-id:\s*([^\n<]+)/gi;
  let m;
  while ((m = re.exec(String(body || ""))) !== null) {
    const id = m[1].trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * @param {string} body
 * @param {string} field
 */
function tableField(body, field) {
  const re = new RegExp(
    `\\|\\s*${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|\\s*([^|]+)\\s*\\|`,
    "i",
  );
  const m = String(body || "").match(re);
  if (!m) return null;
  return m[1].replace(/`/g, "").trim() || null;
}

/**
 * @param {string} body
 * @param {string} key
 */
function bulletField(body, key) {
  const re = new RegExp(`-\\s*${key.replace(/\\./g, "\\.")}:\\s*\`([^\`]*)\``, "i");
  const m = String(body || "").match(re);
  return m ? m[1] : null;
}

/**
 * @param {string|null|undefined} raw
 * @returns {boolean|null}
 */
function parseTriBool(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "unknown") return null;
  return null;
}

/**
 * @param {string} body
 * @returns {string[]}
 */
export function extractConflictedFiles(body) {
  const fromBullet = bulletField(body, "auto1.conflictedFiles");
  if (fromBullet) {
    return fromBullet
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const cell = tableField(body, "Conflicted files");
  if (!cell) return [];
  return cell
    .split(",")
    .map((s) => s.replace(/`/g, "").trim())
    .filter(Boolean);
}

/**
 * @param {string[]} files
 */
export function inferSensitiveTouches(files) {
  let touchesWorkflows = false;
  let touchesMigrations = false;
  let touchesLockfile = false;
  for (const f of files || []) {
    const p = String(f).replace(/\\/g, "/");
    if (/(^|\/)\.github\/workflows\//.test(p) || (/\.ya?ml$/i.test(p) && p.includes("workflow"))) {
      touchesWorkflows = true;
    }
    if (/migration/i.test(p) || /\/migrations?\//i.test(p) || /schema.*\.sql$/i.test(p)) {
      touchesMigrations = true;
    }
    if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb)$/i.test(p)) {
      touchesLockfile = true;
    }
  }
  return { touchesWorkflows, touchesMigrations, touchesLockfile };
}

/**
 * Parse workflow run id from occurrence id like workflow-run:30805433281:attempt:1
 * @param {string|null|undefined} occurrence
 */
export function parseRunIdFromOccurrence(occurrence) {
  const m = String(occurrence || "").match(/workflow-run:(\d+)/i);
  return m ? m[1] : null;
}

/**
 * Build evidence pack. Unknown physical → null (never invent).
 * @param {{
 *   issue?: { number?: number, title?: string, body?: string } | null,
 *   relatedPr?: object | null,
 *   physicalOverrides?: Partial<EvidencePack["physical"]>,
 *   comments?: EvidencePack["comments"],
 *   workflowLogs?: EvidencePack["workflowLogs"],
 *   conflictFileSides?: EvidencePack["conflictFileSides"],
 *   gitPathLog?: string|null,
 *   auto3Evidence?: object|null,
 *   worktreePath?: string|null,
 * }} input
 * @returns {EvidencePack}
 */
export function buildEvidencePack(input = {}) {
  const issue = input.issue || {};
  const body = String(issue.body || "");
  const fingerprint = extractFingerprintFromIssueBody(body);
  if (!fingerprint) {
    throw new Error("evidence pack requires fingerprint marker in issue body");
  }

  const occurrenceIds = extractOccurrenceIds(body);
  const latestOccurrenceId = occurrenceIds.length
    ? occurrenceIds[occurrenceIds.length - 1]
    : null;

  const conflictedFiles = extractConflictedFiles(body);
  const auto1TouchesRaw = tableField(body, "Workflows / migrations / lockfile");
  let touchesWorkflows = parseTriBool(bulletField(body, "auto1.touchesWorkflows"));
  let touchesMigrations = parseTriBool(bulletField(body, "auto1.touchesMigrations"));
  let touchesLockfile = parseTriBool(bulletField(body, "auto1.touchesLockfile"));
  if (auto1TouchesRaw && touchesWorkflows == null) {
    const parts = auto1TouchesRaw.split("/").map((p) => p.trim());
    if (parts.length >= 3) {
      touchesWorkflows = parseTriBool(parts[0]);
      touchesMigrations = parseTriBool(parts[1]);
      touchesLockfile = parseTriBool(parts[2]);
    }
  }

  const inferred = inferSensitiveTouches(conflictedFiles);
  if (touchesWorkflows == null) touchesWorkflows = inferred.touchesWorkflows ? true : null;
  if (touchesMigrations == null) touchesMigrations = inferred.touchesMigrations ? true : null;
  if (touchesLockfile == null) touchesLockfile = inferred.touchesLockfile ? true : null;

  const mutatedMainRaw =
    parseTriBool(bulletField(body, "auto1.mutatedMain")) ??
    parseTriBool(tableField(body, "mutatedMain"));
  const deployedHostDRaw =
    parseTriBool(bulletField(body, "auto1.deployedHostD")) ??
    parseTriBool(tableField(body, "deployedHostD"));

  /** @type {EvidencePack["relatedPr"]} */
  let relatedPr = null;
  if (input.relatedPr) {
    const changed = input.relatedPr.changedFiles || [];
    const prInf = inferSensitiveTouches(changed);
    relatedPr = {
      number: input.relatedPr.number ?? null,
      url: input.relatedPr.url ?? null,
      title: input.relatedPr.title ?? null,
      changedFiles: changed,
      patchExcerpt: input.relatedPr.patchExcerpt ?? null,
      touchesWorkflows:
        input.relatedPr.touchesWorkflows ?? (prInf.touchesWorkflows ? true : null),
      touchesMigrations:
        input.relatedPr.touchesMigrations ?? (prInf.touchesMigrations ? true : null),
      touchesLockfile:
        input.relatedPr.touchesLockfile ?? (prInf.touchesLockfile ? true : null),
    };
    if (relatedPr.touchesWorkflows === true) touchesWorkflows = true;
    if (relatedPr.touchesMigrations === true) touchesMigrations = true;
    if (relatedPr.touchesLockfile === true) touchesLockfile = true;
  }

  // Physical: never invent. hostPAccessed/enginePaused stay null unless authoritative artifact.
  const auto3 = input.auto3Evidence && typeof input.auto3Evidence === "object"
    ? input.auto3Evidence
    : null;
  /** @type {EvidencePack["physical"]} */
  const physical = {
    mutatedMain:
      input.physicalOverrides?.mutatedMain !== undefined
        ? input.physicalOverrides.mutatedMain
        : mutatedMainRaw,
    deployedHostD:
      input.physicalOverrides?.deployedHostD !== undefined
        ? input.physicalOverrides.deployedHostD
        : deployedHostDRaw,
    hostPAccessed:
      input.physicalOverrides?.hostPAccessed !== undefined
        ? input.physicalOverrides.hostPAccessed
        : auto3 && typeof auto3.hostPAccessed === "boolean"
          ? auto3.hostPAccessed
          : null,
    enginePaused:
      input.physicalOverrides?.enginePaused !== undefined
        ? input.physicalOverrides.enginePaused
        : auto3 && typeof auto3.enginePaused === "boolean"
          ? auto3.enginePaused
          : null,
  };

  const prUrl =
    bulletField(body, "auto1.prUrl") ||
    tableField(body, "Sync PR") ||
    relatedPr?.url ||
    null;

  return {
    fingerprint,
    failureClass: tableField(body, "Class"),
    workflowFamily: tableField(body, "Workflow"),
    phase: tableField(body, "Phase"),
    component: tableField(body, "Component"),
    terminalStatus: tableField(body, "Terminal"),
    errorSignature: tableField(body, "Error signature"),
    occurrenceIds,
    latestOccurrenceId,
    auto1: {
      outcome: bulletField(body, "auto1.outcome") || tableField(body, "AUTO-1 outcome"),
      upstreamSha:
        bulletField(body, "auto1.upstreamSha") || tableField(body, "Upstream SHA"),
      prUrl,
      conflictedFiles,
      touchesWorkflows,
      touchesMigrations,
      touchesLockfile,
      mutatedMain: mutatedMainRaw,
      deployedHostD: deployedHostDRaw,
    },
    relatedPr,
    physical,
    comments: input.comments ?? null,
    workflowLogs: input.workflowLogs ?? null,
    conflictFileSides: input.conflictFileSides ?? null,
    gitPathLog: input.gitPathLog ?? null,
    auto3Evidence: auto3,
    worktreePath: input.worktreePath ?? null,
    issueNumber: issue.number ?? null,
    issueTitle: issue.title ?? null,
  };
}
