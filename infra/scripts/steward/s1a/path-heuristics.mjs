#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Pure path heuristics shared by fixture-engine and reviewer.
 * ZERO assessment generation — classification only.
 */
import { FILE_KIND } from "./policy.mjs";

/**
 * @typedef {{
 *   path: string,
 *   kind: string,
 *   playbook: string,
 *   notes: string,
 * }} FileAnalysis
 */

/**
 * Classify a conflicted / changed file path for advisory playbooks.
 * @param {string} filePath
 * @returns {FileAnalysis}
 */
export function classifyConflictFile(filePath) {
  const path = String(filePath || "").replace(/\\/g, "/");
  const base = path.split("/").pop() || path;

  if (
    /lifecycle-column-census-baseline\.json$/i.test(path) ||
    /-baseline\.json$/i.test(base) ||
    /(^|\/)generated\//i.test(path)
  ) {
    return {
      path,
      kind: FILE_KIND.GENERATED_BASELINE,
      playbook: "regeneration",
      notes:
        "Generated baseline: re-run the producer script (e.g. lifecycle-column-census --strict --update-baseline) on the intended merge base; do not hand-merge JSON.",
    };
  }

  if (
    /(^|\/)\.github\/workflows\//.test(path) ||
    (/\.ya?ml$/i.test(path) && /workflow/i.test(path))
  ) {
    return {
      path,
      kind: FILE_KIND.WORKFLOW,
      playbook: "owner-sensitive-review",
      notes: "Workflow YAML change — SENSITIVE; owner review required before any repair.",
    };
  }

  if (/migration/i.test(path) || /\/migrations?\//i.test(path)) {
    return {
      path,
      kind: FILE_KIND.MIGRATION,
      playbook: "owner-sensitive-review",
      notes: "Migration/schema touch — SENSITIVE; freeze automation until owner guidance.",
    };
  }

  if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb)$/i.test(path)) {
    return {
      path,
      kind: FILE_KIND.LOCKFILE,
      playbook: "owner-sensitive-review",
      notes: "Lockfile conflict — SENSITIVE; regenerate lock via package manager after semantic resolve.",
    };
  }

  if (
    /(^|\/)packages\//.test(path) ||
    /executor\.ts$/i.test(path) ||
    /\.(ts|tsx|js|mjs|cjs)$/i.test(path)
  ) {
    return {
      path,
      kind: FILE_KIND.SEMANTIC_SOURCE,
      playbook: "history-and-tests",
      notes:
        "Semantic source conflict: inspect git history on both sides, resolve with intent, run targeted unit/integration tests. S1A does not apply the patch.",
    };
  }

  return {
    path,
    kind: FILE_KIND.OTHER,
    playbook: "manual-triage",
    notes: "Unclassified path — request owner/file-owner context before repair.",
  };
}
