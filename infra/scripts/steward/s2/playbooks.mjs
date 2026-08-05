#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS2 2026-08-05:
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
 * Never suggests playbooks for semantic-source / migration / permission / deployment.
 * @param {string[]} paths
 */
export function suggestPlaybooksForPaths(paths) {
  /** @type {string[]} */
  const out = [];
  for (const p of paths) {
    const path = String(p || "").replace(/\\/g, "/");
    if (
      /permission/i.test(path) ||
      /auto3-hostd-deploy/i.test(path) ||
      /host[-_]?[dp]/i.test(path) ||
      /migration/i.test(path) ||
      /(^|\/)packages\//.test(path) ||
      /executor\.ts$/i.test(path)
    ) {
      // Explicitly no LOW suggestion — escalate to S3 / owner.
      continue;
    }
    if (/baseline\.json$/i.test(path) || /census-baseline/i.test(path)) {
      out.push("generated-baselines");
    } else if (/\.snap(\.|$)/i.test(path) || /__snapshots__/.test(path)) {
      out.push("generated-snapshots");
    } else if (/pnpm-lock\.yaml$|package-lock\.json$|yarn\.lock$/.test(path)) {
      out.push("lockfile-regen-unchanged-intent");
    } else if (/CURRENT-STATE\.md$|ledger\.json$/.test(path)) {
      out.push("stale-status-document-fields");
    } else if (/(^|\/)\.github\/workflows\//.test(path)) {
      // Metadata-only candidates only — still requires attestation at eligibility time.
      out.push("known-safe-workflow-metadata");
    }
  }
  return [...new Set(out)];
}

/**
 * Hard allowlist check.
 * @param {string} playbookId
 */
export function assertPlaybookAllowlisted(playbookId) {
  if (!S2_PLAYBOOKS.includes(String(playbookId || ""))) {
    throw new Error(`S2 playbook not allowlisted: ${playbookId}`);
  }
  return true;
}
