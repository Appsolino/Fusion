#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamPatchRegistry 2026-08-07-04:15:
 * Operational Appsolino product-patch registry. Identity is the defect (FIX-*), not the
 * implementation. Revisions adapt across upstream versions; retirement requires
 * regression proof on clean upstream + Finding Comparison evidence — never title similarity alone.
 * Ops/steward/AUTO automation is NOT a product patch against Runfusion.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

export const PATCH_REGISTRY_SCHEMA_VERSION = 1;
export const PATCH_REGISTRY_DIR = ".appsolino/patches";
export const PATCH_REGISTRY_INDEX = ".appsolino/patches/registry.json";

export const PATCH_CLASSIFICATIONS = Object.freeze([
  "UPSTREAM_RECORDED",
  "UPSTREAM_RELATED",
  "UPSTREAM_FIXED",
  "APPSOLINO_ONLY",
  "NEW_UPSTREAM_CANDIDATE",
  "NOT_REPRODUCIBLE",
  "DUPLICATE_LOCAL",
  "RESOLVED",
]);

export const PATCH_STATUSES = Object.freeze([
  "ACTIVE",
  "ADAPTING",
  "RETIRED",
  "SUPERSEDED",
  "DRAFT",
]);

/**
 * @param {unknown} raw
 */
export function validatePatchRecord(raw) {
  /** @type {string[]} */
  const errors = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["patch must be object"], patch: null };
  const p = /** @type {Record<string, any>} */ (raw);
  if (!/^FIX-[A-Z0-9][-A-Z0-9]*$/i.test(String(p.id || ""))) errors.push("id must match FIX-*");
  if (!p.defect || typeof p.defect.description !== "string" || !p.defect.description.trim()) {
    errors.push("defect.description required");
  }
  if (!Array.isArray(p.regressionTests) || p.regressionTests.length < 1) {
    errors.push("regressionTests must be non-empty array");
  }
  if (!Array.isArray(p.revisions)) errors.push("revisions must be array");
  const status = String(p.status || "DRAFT").toUpperCase();
  if (!PATCH_STATUSES.includes(/** @type {*} */ (status))) errors.push("invalid status");
  const cls = p.upstreamComparison?.classification
    ? String(p.upstreamComparison.classification).toUpperCase()
    : null;
  if (cls && !PATCH_CLASSIFICATIONS.includes(/** @type {*} */ (cls))) {
    errors.push(`invalid classification ${cls}`);
  }
  if (errors.length) return { ok: false, errors, patch: null };
  return {
    ok: true,
    errors: [],
    patch: {
      schemaVersion: PATCH_REGISTRY_SCHEMA_VERSION,
      id: String(p.id).toUpperCase(),
      status,
      defect: {
        description: String(p.defect.description),
        reproduction: String(p.defect.reproduction || ""),
        affectedSubsystem: String(p.defect.affectedSubsystem || ""),
      },
      introducedAgainst: {
        upstreamSha: p.introducedAgainst?.upstreamSha || null,
      },
      regressionTests: p.regressionTests.map(String),
      upstreamComparison: {
        classification: cls,
        comparedAgainstSha: p.upstreamComparison?.comparedAgainstSha || null,
        relatedIssue: p.upstreamComparison?.relatedIssue || null,
        relatedPr: p.upstreamComparison?.relatedPr || null,
        relatedCommit: p.upstreamComparison?.relatedCommit || null,
        evidence: p.upstreamComparison?.evidence || null,
        comparedAt: p.upstreamComparison?.comparedAt || null,
      },
      localAction: {
        patchRequired: p.localAction?.patchRequired !== false,
        applyPaths: Array.isArray(p.localAction?.applyPaths) ? p.localAction.applyPaths.map(String) : [],
      },
      retirementCondition: {
        regressionTestPassesOnCleanUpstream:
          p.retirementCondition?.regressionTestPassesOnCleanUpstream !== false,
        notes: p.retirementCondition?.notes || null,
      },
      revisions: (p.revisions || []).map((r, i) => ({
        revision: Number(r.revision ?? i + 1),
        againstUpstreamSha: r.againstUpstreamSha || null,
        summary: String(r.summary || ""),
        files: Array.isArray(r.files) ? r.files.map(String) : [],
        createdAt: r.createdAt || null,
      })),
      updatedUtc: p.updatedUtc || null,
    },
  };
}

/**
 * @param {string} repoRoot
 */
export function loadPatchRegistry(repoRoot) {
  const indexPath = join(repoRoot, PATCH_REGISTRY_INDEX);
  /** @type {ReturnType<typeof validatePatchRecord>["patch"][]} */
  const patches = [];
  if (existsSync(indexPath)) {
    const idx = JSON.parse(readFileSync(indexPath, "utf8"));
    for (const id of idx.patchIds || []) {
      const p = loadPatch(repoRoot, id);
      if (p) patches.push(p);
    }
  } else {
    const dir = join(repoRoot, PATCH_REGISTRY_DIR);
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json") || name === "registry.json") continue;
        const p = loadPatch(repoRoot, name.replace(/\.json$/i, ""));
        if (p) patches.push(p);
      }
    }
  }
  return {
    schemaVersion: PATCH_REGISTRY_SCHEMA_VERSION,
    patches,
    active: patches.filter((p) => p && p.status === "ACTIVE"),
  };
}

/**
 * @param {string} repoRoot
 * @param {string} id
 */
export function loadPatch(repoRoot, id) {
  const path = join(repoRoot, PATCH_REGISTRY_DIR, `${String(id).toUpperCase()}.json`);
  if (!existsSync(path)) return null;
  const v = validatePatchRecord(JSON.parse(readFileSync(path, "utf8")));
  return v.ok ? v.patch : null;
}

/**
 * @param {string} repoRoot
 * @param {object} patchInput
 */
export function upsertPatch(repoRoot, patchInput) {
  const v = validatePatchRecord(patchInput);
  if (!v.ok) throw new Error(`invalid patch: ${v.errors.join("; ")}`);
  const patch = {
    ...v.patch,
    updatedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  const dir = join(repoRoot, PATCH_REGISTRY_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${patch.id}.json`), `${JSON.stringify(patch, null, 2)}\n`);
  const registry = loadPatchRegistry(repoRoot);
  const ids = [...new Set([...registry.patches.map((p) => p.id), patch.id])].sort();
  writeFileSync(
    join(repoRoot, PATCH_REGISTRY_INDEX),
    `${JSON.stringify({ schemaVersion: PATCH_REGISTRY_SCHEMA_VERSION, patchIds: ids, updatedUtc: patch.updatedUtc }, null, 2)}\n`,
  );
  return patch;
}

/**
 * Pure reconciliation decision for one patch against clean-upstream regression result.
 *
 * @param {{
 *   patch: NonNullable<ReturnType<typeof validatePatchRecord>["patch"]>,
 *   cleanUpstreamSha: string,
 *   regressionPassesOnCleanUpstream: boolean|null,
 *   classification: string|null,
 *   comparisonEvidence?: string|null,
 * }} input
 */
export function decidePatchReconciliation(input) {
  const patch = input.patch;
  const cls = input.classification ? String(input.classification).toUpperCase() : null;

  // Cannot retire without deterministic proof when retirementCondition requires it.
  if (input.regressionPassesOnCleanUpstream === true) {
    if (cls === "UPSTREAM_FIXED" || cls === "RESOLVED" || cls === "NOT_REPRODUCIBLE") {
      return {
        action: "RETIRE",
        status: "RETIRED",
        classification: cls,
        reason: "defect no longer reproduces on clean upstream with supporting classification",
        patchRequired: false,
      };
    }
    if (cls == null) {
      return {
        action: "NEEDS_COMPARISON",
        status: patch.status,
        classification: null,
        reason: "regression passes on clean upstream but Finding Comparison classification missing — refuse blind retire",
        patchRequired: true,
      };
    }
  }

  if (input.regressionPassesOnCleanUpstream === false) {
    if (cls === "UPSTREAM_FIXED") {
      return {
        action: "KEEP_ACTIVE_CONFLICT",
        status: "ACTIVE",
        classification: cls,
        reason: "classification claims UPSTREAM_FIXED but regression still fails — refuse incorrect retirement",
        patchRequired: true,
      };
    }
    return {
      action: "RETAIN_OR_ADAPT",
      status: "ACTIVE",
      classification: cls || "APPSOLINO_ONLY",
      reason: "defect still reproduces on clean upstream — retain/adapt patch identity",
      patchRequired: true,
    };
  }

  return {
    action: "NEEDS_EVIDENCE",
    status: patch.status,
    classification: cls,
    reason: "missing clean-upstream regression result — fail closed",
    patchRequired: true,
  };
}

/**
 * Apply reconciliation decision onto a patch record (returns new object).
 * @param {NonNullable<ReturnType<typeof validatePatchRecord>["patch"]>} patch
 * @param {ReturnType<typeof decidePatchReconciliation>} decision
 * @param {{ againstUpstreamSha: string, summary?: string, files?: string[] }} [rev]
 */
export function applyReconciliationToPatch(patch, decision, rev) {
  /*
   FNXC:UpstreamPatchRegistry 2026-08-07-04:20:
   Avoid structuredClone — eslint no-undef under Node flat config without that global.
   JSON round-trip is enough for plain patch registry records.
   */
  const next = JSON.parse(JSON.stringify(patch));
  next.upstreamComparison = {
    ...next.upstreamComparison,
    classification: decision.classification,
    comparedAgainstSha: rev?.againstUpstreamSha || next.upstreamComparison.comparedAgainstSha,
    comparedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    evidence: decision.reason,
  };
  next.localAction.patchRequired = decision.patchRequired;
  next.status = /** @type {*} */ (decision.status);
  if (decision.action === "RETAIN_OR_ADAPT" && rev) {
    const revision = (next.revisions?.length || 0) + 1;
    next.revisions = [
      ...(next.revisions || []),
      {
        revision,
        againstUpstreamSha: rev.againstUpstreamSha,
        summary: rev.summary || `adapt revision ${revision}`,
        files: rev.files || [],
        createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      },
    ];
    next.status = "ACTIVE";
  }
  if (decision.action === "RETIRE") {
    next.revisions = [
      ...(next.revisions || []),
      {
        revision: (next.revisions?.length || 0) + 1,
        againstUpstreamSha: rev?.againstUpstreamSha || null,
        summary: `retired: ${decision.reason}`,
        files: [],
        createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      },
    ];
  }
  next.updatedUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return next;
}

/**
 * Seed bootstrap patches for Appsolino product defects that are not ops automation.
 * @param {string} repoRoot
 */
export function seedInitialProductPatches(repoRoot) {
  const seeds = [
    {
      id: "FIX-ISS-UI-001",
      status: "ACTIVE",
      defect: {
        description: "Settings non-identity fields hijacked by browser credential autofill",
        reproduction: "Open Settings; browser autofills path/API-key fields with credentials",
        affectedSubsystem: "dashboard/settings",
      },
      introducedAgainst: { upstreamSha: null },
      regressionTests: [
        "packages/dashboard/app/__tests__/settings-autofill-invariant.test.ts",
      ],
      upstreamComparison: {
        classification: "APPSOLINO_ONLY",
        comparedAgainstSha: null,
        relatedIssue: "https://github.com/Appsolino/Fusion/issues/23",
        relatedPr: "https://github.com/Appsolino/Fusion/pull/28",
        relatedCommit: null,
        evidence: "Appsolino Host D operator UX; not known fixed upstream",
      },
      localAction: {
        patchRequired: true,
        applyPaths: [
          "packages/dashboard/app/components/SettingsModal.tsx",
          "packages/dashboard/app/components/SettingsView.tsx",
        ],
      },
      retirementCondition: {
        regressionTestPassesOnCleanUpstream: true,
        notes: "Retire only when Settings autofill invariant passes on clean upstream",
      },
      revisions: [
        {
          revision: 1,
          againstUpstreamSha: null,
          summary: "initial Appsolino autofill hardening candidate",
          files: [],
          createdAt: "2026-07-31T00:00:00Z",
        },
      ],
    },
    {
      id: "FIX-ISS-GIT-007",
      status: "ACTIVE",
      defect: {
        description: "Auto-merge / integration assumes branch name main while default may differ",
        reproduction: "Disposable repo default master; integration resolution fails or wrong tip",
        affectedSubsystem: "git/integration",
      },
      introducedAgainst: { upstreamSha: null },
      regressionTests: [
        "infra/scripts/__tests__/auto1-upstream-sync.test.mjs",
      ],
      upstreamComparison: {
        classification: "APPSOLINO_ONLY",
        comparedAgainstSha: null,
        relatedIssue: null,
        relatedPr: null,
        relatedCommit: null,
        evidence: "Appsolino AUTO-1 resolveIntegrationBranch (origin/HEAD)",
      },
      localAction: {
        patchRequired: true,
        applyPaths: [
          "infra/scripts/auto1-upstream-sync.mjs",
          "packages/engine/src/merge/pr-nodes.ts",
          "packages/engine/src/merge/integration-branch.ts",
          "packages/engine/src/merge/group-merge-coordinator.ts",
        ],
      },
      retirementCondition: {
        regressionTestPassesOnCleanUpstream: true,
        notes: "Retire if upstream Fusion permanently resolves default-branch without hardcoding main",
      },
      revisions: [
        {
          revision: 1,
          againstUpstreamSha: null,
          summary: "ISS-GIT-007 origin/HEAD resolution",
          files: ["infra/scripts/auto1-upstream-sync.mjs"],
          createdAt: "2026-07-31T12:40:00Z",
        },
      ],
    },
  ];
  return seeds.map((s) => upsertPatch(repoRoot, s));
}
