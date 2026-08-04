#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Build an S1A evidence pack from a steward incident issue body (+ optional PR fields).
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
 *     touchesWorkflows: boolean|null,
 *     touchesMigrations: boolean|null,
 *     touchesLockfile: boolean|null,
 *   } | null,
 *   physical: {
 *     mutatedMain: boolean,
 *     deployedHostD: boolean,
 *     hostPAccessed: boolean,
 *     enginePaused: boolean,
 *   },
 *   issueNumber: number|null,
 *   issueTitle: string|null,
 * }} EvidencePack
 */

/**
 * Extract occurrence ids from issue body detail blocks.
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
 * @param {string} key like "auto1.upstreamSha"
 */
function bulletField(body, key) {
  const re = new RegExp(`-\\s*${key.replace(/\./g, "\\.")}:\\s*\`([^\`]*)\``, "i");
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
 * Parse conflicted files from table or bullet.
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
 * Infer workflow/migration/lockfile touch flags from file paths when PR metadata absent.
 * @param {string[]} files
 */
export function inferSensitiveTouches(files) {
  let touchesWorkflows = false;
  let touchesMigrations = false;
  let touchesLockfile = false;
  for (const f of files || []) {
    const p = String(f).replace(/\\/g, "/");
    if (/(^|\/)\.github\/workflows\//.test(p) || /\.ya?ml$/i.test(p) && p.includes("workflow")) {
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
 * Build evidence pack.
 * @param {{
 *   issue?: { number?: number, title?: string, body?: string } | null,
 *   relatedPr?: {
 *     number?: number,
 *     url?: string,
 *     title?: string,
 *     changedFiles?: string[],
 *     touchesWorkflows?: boolean|null,
 *     touchesMigrations?: boolean|null,
 *     touchesLockfile?: boolean|null,
 *   } | null,
 *   physicalOverrides?: Partial<EvidencePack["physical"]>,
 *   allowUnknownNullDefaults?: boolean,
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

  const allowDefaults = input.allowUnknownNullDefaults !== false;
  /** @type {EvidencePack["physical"]} */
  const physical = {
    mutatedMain:
      input.physicalOverrides?.mutatedMain ??
      (mutatedMainRaw != null ? mutatedMainRaw : allowDefaults ? false : /** @type {any} */ (null)),
    deployedHostD:
      input.physicalOverrides?.deployedHostD ??
      (deployedHostDRaw != null ? deployedHostDRaw : allowDefaults ? false : /** @type {any} */ (null)),
    hostPAccessed: input.physicalOverrides?.hostPAccessed ?? (allowDefaults ? false : /** @type {any} */ (null)),
    enginePaused: input.physicalOverrides?.enginePaused ?? (allowDefaults ? true : /** @type {any} */ (null)),
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
    issueNumber: issue.number ?? null,
    issueTitle: issue.title ?? null,
  };
}
