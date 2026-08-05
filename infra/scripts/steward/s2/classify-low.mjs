#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS2 2026-08-05:
 * Refuse to treat semantic/workflow/migration/permission/deployment/dependency-intent as LOW.
 */
import { classifyConflictFile } from "../s1a/path-heuristics.mjs";
import { FILE_KIND } from "../s1a/policy.mjs";
import { S2_PLAYBOOKS, S2_FORBIDDEN_LOW_CLASSES } from "./policy.mjs";
import { suggestPlaybooksForPaths } from "./playbooks.mjs";

/**
 * Extra path classes beyond S1A FILE_KIND that must never be S2 LOW.
 * @param {string} filePath
 * @returns {string|null} forbidden class id or null
 */
export function detectForbiddenLowClass(filePath) {
  const path = String(filePath || "").replace(/\\/g, "/");
  if (
    /permission/i.test(path) ||
    /github.?app.?permission/i.test(path) ||
    /(^|\/)appsolino.*permission/i.test(path) ||
    /\.github\/.*permission/i.test(path)
  ) {
    return "permission";
  }
  if (
    /auto3-hostd-deploy/i.test(path) ||
    /host[-_]?[dp]/i.test(path) ||
    /(^|\/)deploy(ment)?s?\//i.test(path) ||
    /deploy-host/i.test(path)
  ) {
    return "deployment";
  }
  return null;
}

/**
 * @param {string} playbookId
 * @param {string} path
 * @param {{ dependencyIntentUnchanged?: boolean, formatOnly?: boolean, workflowMetadataOnly?: boolean }} [flags]
 */
export function pathCompatibleWithPlaybook(playbookId, path, flags = {}) {
  const p = String(path || "").replace(/\\/g, "/");
  const classified = classifyConflictFile(p);
  const extra = detectForbiddenLowClass(p);

  if (extra === "permission" || extra === "deployment") {
    return { ok: false, reason: `not-low:${extra}`, kind: extra };
  }
  if (classified.kind === FILE_KIND.MIGRATION) {
    return { ok: false, reason: "not-low:migration", kind: FILE_KIND.MIGRATION };
  }
  if (classified.kind === FILE_KIND.SEMANTIC_SOURCE) {
    if (playbookId === "formatting-lint-only" && flags.formatOnly === true) {
      return { ok: true, reason: "format-only-attested", kind: classified.kind };
    }
    return {
      ok: false,
      reason: "not-low:semantic-source",
      kind: FILE_KIND.SEMANTIC_SOURCE,
    };
  }
  if (classified.kind === FILE_KIND.WORKFLOW) {
    if (
      playbookId === "known-safe-workflow-metadata" &&
      flags.workflowMetadataOnly === true
    ) {
      return {
        ok: true,
        reason: "workflow-metadata-only-attested",
        kind: classified.kind,
      };
    }
    return { ok: false, reason: "not-low:workflow", kind: FILE_KIND.WORKFLOW };
  }
  if (classified.kind === FILE_KIND.LOCKFILE) {
    if (playbookId !== "lockfile-regen-unchanged-intent") {
      return {
        ok: false,
        reason: "lockfile-requires-lockfile-playbook",
        kind: FILE_KIND.LOCKFILE,
      };
    }
    if (flags.dependencyIntentUnchanged !== true) {
      return {
        ok: false,
        reason: "not-low:dependency-intent",
        kind: "dependency-intent",
      };
    }
    return { ok: true, reason: "lockfile-unchanged-intent", kind: FILE_KIND.LOCKFILE };
  }

  switch (playbookId) {
    case "generated-baselines":
      if (
        /baseline\.json$/i.test(p) ||
        /census-baseline/i.test(p) ||
        /(^|\/)generated\//i.test(p)
      ) {
        return { ok: true, reason: "baseline-path", kind: classified.kind };
      }
      return { ok: false, reason: "path-not-baseline", kind: classified.kind };
    case "generated-snapshots":
      if (/\.snap(\.|$)/i.test(p) || /__snapshots__/.test(p)) {
        return { ok: true, reason: "snapshot-path", kind: classified.kind };
      }
      return { ok: false, reason: "path-not-snapshot", kind: classified.kind };
    case "stale-status-document-fields":
      if (/CURRENT-STATE\.md$/i.test(p) || /ledger\.json$/i.test(p)) {
        return { ok: true, reason: "status-doc-path", kind: classified.kind };
      }
      return { ok: false, reason: "path-not-status-doc", kind: classified.kind };
    case "formatting-lint-only":
      return {
        ok: flags.formatOnly === true,
        reason: flags.formatOnly === true ? "format-only" : "format-only-attestation-required",
        kind: classified.kind,
      };
    case "known-safe-workflow-metadata":
      return {
        ok: false,
        reason: "workflow-metadata-attestation-required",
        kind: classified.kind,
      };
    case "lockfile-regen-unchanged-intent":
      return { ok: false, reason: "path-not-lockfile", kind: classified.kind };
    default:
      return { ok: false, reason: "unknown-playbook", kind: classified.kind };
  }
}

/**
 * @param {{
 *   playbookId: string,
 *   paths?: string[],
 *   classifiedFiles?: Array<{ path: string, kind?: string }>,
 *   dependencyIntentUnchanged?: boolean,
 *   formatOnly?: boolean,
 *   workflowMetadataOnly?: boolean,
 * }} input
 */
export function evaluateS2LowRiskClassification(input) {
  const reasons = [];
  const playbookId = String(input.playbookId || "");
  if (!S2_PLAYBOOKS.includes(playbookId)) {
    return {
      ok: false,
      reasons: ["unknown-playbook"],
      forbiddenClasses: [...S2_FORBIDDEN_LOW_CLASSES],
    };
  }

  const paths =
    input.paths ||
    (input.classifiedFiles || []).map((f) => f.path).filter(Boolean);
  if (!paths.length) reasons.push("paths-missing");

  /** @type {Array<{ path: string, ok: boolean, reason: string, kind: string }>} */
  const perPath = [];
  for (const path of paths) {
    const row = pathCompatibleWithPlaybook(playbookId, path, {
      dependencyIntentUnchanged: input.dependencyIntentUnchanged,
      formatOnly: input.formatOnly,
      workflowMetadataOnly: input.workflowMetadataOnly,
    });
    perPath.push({ path, ...row });
    if (!row.ok) reasons.push(`${row.reason}:${path}`);
  }

  // Explicit claim of a forbidden class on input classifiedFiles.
  for (const f of input.classifiedFiles || []) {
    const kind = String(f.kind || "");
    if (S2_FORBIDDEN_LOW_CLASSES.includes(kind)) {
      const allowedOverride =
        (kind === "workflow" &&
          playbookId === "known-safe-workflow-metadata" &&
          input.workflowMetadataOnly === true) ||
        (kind === "semantic-source" &&
          playbookId === "formatting-lint-only" &&
          input.formatOnly === true) ||
        (kind === "dependency-intent" &&
          playbookId === "lockfile-regen-unchanged-intent" &&
          input.dependencyIntentUnchanged === true);
      if (!allowedOverride) {
        reasons.push(`not-low:${kind}:${f.path || "?"}`);
      }
    }
  }

  const suggested = suggestPlaybooksForPaths(paths);
  if (suggested.length && !suggested.includes(playbookId)) {
    // Soft signal — only fail when playbook is clearly mismatched to path suggestions
    // and no path passed compatibility (already covered). Keep as advisory reason when mixed.
  }

  const uniq = [...new Set(reasons)];
  return {
    ok: uniq.length === 0,
    reasons: uniq,
    perPath,
    playbookId,
    forbiddenClasses: [...S2_FORBIDDEN_LOW_CLASSES],
  };
}
