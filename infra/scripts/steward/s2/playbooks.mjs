#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS2 2026-08-04:
 * Deterministic low-risk playbooks — always regenerate from the resolved tree.
 */
import { S2_PLAYBOOKS } from "./policy.mjs";

/**
 * @param {string} playbookId
 * @param {{ conflictPaths?: string[] }} [ctx]
 */
export function describePlaybook(playbookId, ctx = {}) {
  if (!S2_PLAYBOOKS.includes(playbookId)) {
    throw new Error(`unknown S2 playbook: ${playbookId}`);
  }
  const paths = ctx.conflictPaths || [];
  /** @type {Record<string, {regenCommand: string, never: string}>} */
  const table = {
    "generated-baselines": {
      regenCommand:
        "node scripts/... regenerate baseline from resolved merged tree (never hand-merge JSON)",
      never: "ours/theirs hand merge of generated JSON",
    },
    "generated-snapshots": {
      regenCommand: "re-run snapshot generators on final merged tree",
      never: "copy stale snapshot from either parent",
    },
    "lockfile-regen-unchanged-intent": {
      regenCommand: "pnpm install --lockfile-only (or package-manager equivalent) on merged tree",
      never: "manual lockfile conflict edits when dependency intent changed",
    },
    "formatting-lint-only": {
      regenCommand: "formatter/linter --fix on affected paths from merged tree",
      never: "semantic code edits under a format playbook",
    },
    "known-safe-workflow-metadata": {
      regenCommand: "apply documented metadata-only workflow patch checklist",
      never: "secret, permission, or runner trust expansions",
    },
    "stale-status-document-fields": {
      regenCommand: "rewrite status docs from live git + ledger (no self-invalidating current SHA)",
      never: "fabricate Host P or production claims",
    },
  };
  return {
    playbookId,
    matchedConflictPaths: paths,
    ...table[playbookId],
    sourceOfTruth: "final-merged-tree",
  };
}

/**
 * Map known generated conflict paths to a playbook.
 * @param {string[]} paths
 */
export function suggestPlaybooksForPaths(paths) {
  /** @type {string[]} */
  const out = [];
  for (const p of paths) {
    if (/baseline\.json$/i.test(p) || /census-baseline/i.test(p)) {
      out.push("generated-baselines");
    } else if (/\.snap(\.|$)/i.test(p) || /__snapshots__/.test(p)) {
      out.push("generated-snapshots");
    } else if (/pnpm-lock\.yaml$|package-lock\.json$|yarn\.lock$/.test(p)) {
      out.push("lockfile-regen-unchanged-intent");
    } else if (/CURRENT-STATE\.md$|ledger\.json$/.test(p)) {
      out.push("stale-status-document-fields");
    }
  }
  return [...new Set(out)];
}
