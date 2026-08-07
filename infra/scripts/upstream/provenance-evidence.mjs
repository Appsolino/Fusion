#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-20:15:
 * Durable AUTO-1 provenance evidence. Object-shaped sync-status alone is NOT complete.
 * Require provenanceEvidenceVersion + completion flags. Separate MAINTENANCE_METADATA
 * from APPSOLINO_PRODUCT_DELTA so routine proof/status refresh does not force MIXED.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { SYNC_STATUS_PATH, loadUpstreamSyncStatus } from "./sensitive-review-package.mjs";

/*
FNXC:AutomationGovernance 2026-08-07-20:24:
Expert repair must restamp localDelta before push so Appsolino-authored product
edits cannot remain EXACT_UPSTREAM under a stale NONE stamp.
*/

export const PROVENANCE_EVIDENCE_VERSION = 1;

/**
 * Build the provenance completion block AUTO-1 must stamp on sync-status.
 * @param {{
 *   conflictReconciliationComplete: boolean,
 *   patchReconciliationComplete: boolean,
 *   localDeltaClassificationComplete: boolean,
 *   appsolinoProductPaths?: string[],
 *   adaptedPaths?: string[],
 *   localDeltaKind?: "NONE"|"ADAPTED"|"INTRODUCED"|"MODIFIED",
 * }} opts
 */
export function buildProvenanceEvidenceBlock(opts) {
  return {
    provenanceEvidenceVersion: PROVENANCE_EVIDENCE_VERSION,
    conflictReconciliationComplete: opts.conflictReconciliationComplete === true,
    patchReconciliationComplete: opts.patchReconciliationComplete === true,
    localDeltaClassificationComplete: opts.localDeltaClassificationComplete === true,
    localDelta: {
      kind: opts.localDeltaKind || "NONE",
      appsolinoProductPaths: Array.isArray(opts.appsolinoProductPaths)
        ? opts.appsolinoProductPaths.map(String)
        : [],
      adaptedPaths: Array.isArray(opts.adaptedPaths) ? opts.adaptedPaths.map(String) : [],
    },
  };
}

/**
 * @param {object|null|undefined} status
 */
export function isProvenanceEvidenceComplete(status) {
  if (!status || typeof status !== "object") return false;
  if (Number(status.provenanceEvidenceVersion) !== PROVENANCE_EVIDENCE_VERSION) return false;
  return (
    status.conflictReconciliationComplete === true &&
    status.patchReconciliationComplete === true &&
    status.localDeltaClassificationComplete === true
  );
}

/**
 * Path role for provenance. Maintenance metadata never alone forces MIXED.
 * @param {string} file
 * @param {{ hasLocalPatchAdaptation?: boolean }} [opts]
 * @returns {"MAINTENANCE_METADATA"|"APPSOLINO_PRODUCT_DELTA"|"UPSTREAM_PRODUCT_DELTA"}
 */
export function classifyPathProvenanceRole(file, opts = {}) {
  const n = String(file || "").replace(/\\/g, "/");
  if (
    n === ".appsolino/upstream-sync-status.json" ||
    n === ".appsolino/upstream-freshness.json" ||
    n === ".appsolino/release-freshness.json" ||
    n.startsWith(".appsolino/patches/proofs/")
  ) {
    return "MAINTENANCE_METADATA";
  }
  if (n === ".appsolino/patches/registry.json") {
    return opts.hasLocalPatchAdaptation === true ? "APPSOLINO_PRODUCT_DELTA" : "MAINTENANCE_METADATA";
  }
  if (n.startsWith(".appsolino/patches/")) {
    return opts.hasLocalPatchAdaptation === true ? "APPSOLINO_PRODUCT_DELTA" : "MAINTENANCE_METADATA";
  }
  // Durable localDelta.appsolinoProductPaths is authoritative for MIXED; this helper
  // is for observability of PR file roles only.
  if (n.startsWith("infra/scripts/upstream/") || n.startsWith("docs/appsolino/")) {
    return "APPSOLINO_PRODUCT_DELTA";
  }
  return "UPSTREAM_PRODUCT_DELTA";
}

/**
 * @param {string} file
 * @param {{ hasLocalPatchAdaptation?: boolean }} [opts]
 */
export function isMaintenanceMetadataPath(file, opts = {}) {
  return classifyPathProvenanceRole(file, opts) === "MAINTENANCE_METADATA";
}

/**
 * Classify paths changed by an edit-capable expert repair vs the pre-repair candidate.
 * Maintenance metadata alone does not create a product localDelta.
 *
 * FNXC:AutomationGovernance 2026-08-07-20:40:
 * Patch definitions (FIX-*.json / registry.json) are ADAPTED when the expert edits them.
 * Do not route them through isMaintenanceMetadataPath (which treats patches as metadata
 * unless hasLocalPatchAdaptation is already true — unreachable here).
 *
 * @param {string[]} changedPaths
 * @returns {{
 *   kind: "NONE"|"ADAPTED"|"MODIFIED",
 *   appsolinoProductPaths: string[],
 *   adaptedPaths: string[],
 *   maintenanceMetadataPaths: string[],
 * }}
 */
export function classifyExpertRepairPathDelta(changedPaths) {
  /** @type {string[]} */
  const maintenanceMetadataPaths = [];
  /** @type {string[]} */
  const appsolinoProductPaths = [];
  /** @type {string[]} */
  const adaptedPaths = [];
  for (const raw of changedPaths || []) {
    const f = String(raw || "").replace(/\\/g, "/").trim();
    if (!f) continue;

    // Proofs + freshness/status planes only — not patch definitions.
    if (
      f === ".appsolino/upstream-sync-status.json" ||
      f === ".appsolino/upstream-freshness.json" ||
      f === ".appsolino/release-freshness.json" ||
      f.startsWith(".appsolino/patches/proofs/")
    ) {
      maintenanceMetadataPaths.push(f);
      continue;
    }

    // Expert-changed patch definitions / registry → ADAPTED.
    if (
      f === ".appsolino/patches/registry.json" ||
      (f.startsWith(".appsolino/patches/") && !f.includes("/proofs/"))
    ) {
      adaptedPaths.push(f);
      appsolinoProductPaths.push(f);
      continue;
    }

    // Any other non-maintenance path the expert touched is Appsolino product delta.
    appsolinoProductPaths.push(f);
  }
  const uniq = (xs) => [...new Set(xs)].sort();
  const product = uniq(appsolinoProductPaths);
  const adapted = uniq(adaptedPaths);
  /** @type {"NONE"|"ADAPTED"|"MODIFIED"} */
  let kind = "NONE";
  if (adapted.length > 0) kind = "ADAPTED";
  else if (product.length > 0) kind = "MODIFIED";
  return {
    kind,
    appsolinoProductPaths: product,
    adaptedPaths: adapted,
    maintenanceMetadataPaths: uniq(maintenanceMetadataPaths),
  };
}

/**
 * List paths changed since baseline SHA (committed + working tree + untracked).
 * @param {string} worktreePath
 * @param {string} baselineSha
 * @param {(args: string[], opts?: object) => {status:number,stdout:string,stderr:string}} [runGit]
 */
export function listChangedPathsSinceBaseline(worktreePath, baselineSha, runGit) {
  const git =
    runGit ||
    ((args) => {
      const r = spawnSync("git", args, { encoding: "utf8" });
      return { status: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
    });
  const base = String(baselineSha || "").trim();
  /** @type {Set<string>} */
  const names = new Set();
  const absorb = (stdout) => {
    for (const line of String(stdout || "").split("\n")) {
      const p = line.trim().replace(/\\/g, "/");
      if (p) names.add(p);
    }
  };
  if (base) {
    for (const extra of [
      ["diff", "--name-only", base],
      ["diff", "--name-only", "--cached", base],
      ["diff", "--name-only", `${base}...HEAD`],
    ]) {
      const r = git(["-C", worktreePath, ...extra]);
      if (r.status === 0) absorb(r.stdout);
    }
  }
  const others = git(["-C", worktreePath, "ls-files", "--others", "--exclude-standard"]);
  if (others.status === 0) absorb(others.stdout);
  const porcelain = git(["-C", worktreePath, "status", "--porcelain", "-uall"]);
  if (porcelain.status === 0) {
    for (const line of String(porcelain.stdout || "").split("\n")) {
      if (!line.trim()) continue;
      // XY PATH or XY ORIG -> PATH
      const rest = line.slice(3).trim();
      const arrow = rest.includes(" -> ") ? rest.split(" -> ").pop() : rest;
      if (arrow) names.add(String(arrow).replace(/\\/g, "/"));
    }
  }
  return [...names].sort();
}

/**
 * Merge expert-repair localDelta into durable sync-status before commit/push.
 * Preserves prior conflict-resolution records; refreshes provenance completion flags.
 *
 * @param {{
 *   worktreePath: string,
 *   baselineSha: string,
 *   runGit?: Function,
 * }} input
 */
export function stampSyncStatusAfterExpertRepair(input) {
  const worktreePath = input.worktreePath;
  const baselineSha = String(input.baselineSha || "").trim();
  const changedPaths = listChangedPathsSinceBaseline(worktreePath, baselineSha, input.runGit);
  const delta = classifyExpertRepairPathDelta(changedPaths);

  const statusPath = join(worktreePath, SYNC_STATUS_PATH);
  /** @type {object} */
  let status = {};
  if (existsSync(statusPath)) {
    try {
      status = JSON.parse(readFileSync(statusPath, "utf8"));
    } catch {
      status = {};
    }
  }

  const priorKind = String(status.localDelta?.kind || "NONE").toUpperCase();
  const priorProduct = Array.isArray(status.localDelta?.appsolinoProductPaths)
    ? status.localDelta.appsolinoProductPaths.map(String)
    : [];
  const priorAdapted = Array.isArray(status.localDelta?.adaptedPaths)
    ? status.localDelta.adaptedPaths.map(String)
    : [];

  // Union prior durable product delta with this repair (never silently drop MIXED history).
  const appsolinoProductPaths = [...new Set([...priorProduct, ...delta.appsolinoProductPaths])].sort();
  const adaptedPaths = [...new Set([...priorAdapted, ...delta.adaptedPaths])].sort();
  /** @type {"NONE"|"ADAPTED"|"INTRODUCED"|"MODIFIED"} */
  let kind = "NONE";
  if (adaptedPaths.length > 0) kind = "ADAPTED";
  else if (appsolinoProductPaths.length > 0) kind = "MODIFIED";
  else if (priorKind === "ADAPTED" || priorKind === "INTRODUCED" || priorKind === "MODIFIED") {
    kind = /** @type {*} */ (priorKind);
  }

  const evidence = buildProvenanceEvidenceBlock({
    /*
    FNXC:AutomationGovernance 2026-08-07-20:40:
    Preserve completeness only when the prior field was explicitly true — do not
    upgrade missing/old-schema records into complete v1 via !== false.
    Repair always sets localDeltaClassificationComplete after classifying the delta.
    */
    conflictReconciliationComplete: status.conflictReconciliationComplete === true,
    patchReconciliationComplete: status.patchReconciliationComplete === true,
    localDeltaClassificationComplete: true,
    localDeltaKind: kind,
    appsolinoProductPaths,
    adaptedPaths,
  });

  const next = {
    ...status,
    ...evidence,
    expertRepairProvenance: {
      recordedAtUtc: new Date().toISOString(),
      baselineSha,
      changedPathCount: changedPaths.length,
      maintenanceMetadataPaths: delta.maintenanceMetadataPaths,
      productPathCount: delta.appsolinoProductPaths.length,
    },
  };
  mkdirSync(dirname(statusPath), { recursive: true });
  writeFileSync(statusPath, `${JSON.stringify(next, null, 2)}\n`);
  return {
    kind,
    appsolinoProductPaths,
    adaptedPaths,
    maintenanceMetadataPaths: delta.maintenanceMetadataPaths,
    changedPaths,
    statusPath,
    status: next,
  };
}

/**
 * @param {object|null|undefined} status
 * @param {{ prChangedFiles?: string[], liveMergeConflict?: boolean }} [extra]
 */
export function extractProvenanceEvidenceFromSyncStatus(status, extra = {}) {
  if (!status || typeof status !== "object") {
    return {
      evidenceComplete: false,
      evidenceSource: null,
      conflictedFiles: [],
      historicalConflictedFiles: [],
      localPatchPathsTouched: [],
      appsolinoOnlyPaths: [],
      maintenanceMetadataPaths: [],
      conflictResolutionRecorded: false,
      reasons: ["missing upstream-sync-status — cannot prove EXACT_UPSTREAM"],
    };
  }

  const evidenceComplete = isProvenanceEvidenceComplete(status);
  const liveConflicts = Array.isArray(status.conflictedFiles)
    ? status.conflictedFiles.map(String).filter(Boolean)
    : [];
  const resolution = status.upstreamFixedConflictResolution || null;
  const historical =
    Array.isArray(resolution?.resolvedConflictedFiles)
      ? resolution.resolvedConflictedFiles.map(String).filter(Boolean)
      : Array.isArray(resolution?.conflictedFiles)
        ? resolution.conflictedFiles.map(String).filter(Boolean)
        : [];

  const conflictResolutionRecorded = Boolean(
    resolution &&
      (resolution.action ||
        resolution.resolved === true ||
        resolution.resolved === false ||
        (Array.isArray(resolution.retiredPatchIds) && resolution.retiredPatchIds.length > 0)),
  );

  const localDelta = status.localDelta && typeof status.localDelta === "object" ? status.localDelta : {};
  const localKind = String(localDelta.kind || "NONE").toUpperCase();
  const hasLocalPatchAdaptation =
    localKind === "ADAPTED" ||
    localKind === "INTRODUCED" ||
    localKind === "MODIFIED" ||
    (Array.isArray(localDelta.adaptedPaths) && localDelta.adaptedPaths.length > 0);

  /** Durable product paths — not inferred from routine maintenance file churn. */
  const appsolinoOnlyPaths = Array.isArray(localDelta.appsolinoProductPaths)
    ? localDelta.appsolinoProductPaths.map(String).filter(Boolean)
    : [];
  const localPatchPathsTouched = hasLocalPatchAdaptation
    ? (Array.isArray(localDelta.adaptedPaths) ? localDelta.adaptedPaths.map(String) : []).filter(Boolean)
    : [];

  const prFiles = Array.isArray(extra.prChangedFiles) ? extra.prChangedFiles.map(String) : [];
  const maintenanceMetadataPaths = prFiles.filter((f) =>
    isMaintenanceMetadataPath(f, { hasLocalPatchAdaptation }),
  );

  const conflictedFiles = [
    ...new Set([
      ...liveConflicts,
      ...historical,
      ...(conflictResolutionRecorded && historical.length === 0 && liveConflicts.length === 0
        ? ["(auto1-conflict-resolution-recorded)"]
        : []),
    ]),
  ];

  const retired = Array.isArray(resolution?.retiredPatchIds)
    ? resolution.retiredPatchIds.map(String)
    : [];

  /** @type {string[]} */
  const reasons = [];
  if (!evidenceComplete) {
    reasons.push(
      Number(status.provenanceEvidenceVersion) !== PROVENANCE_EVIDENCE_VERSION
        ? `old/partial provenance schema (version=${status.provenanceEvidenceVersion ?? "missing"}) — fail closed`
        : "provenance completion flags incomplete — fail closed away from EXACT_UPSTREAM",
    );
  } else {
    reasons.push("provenance evidence schema complete");
  }
  reasons.push(
    conflictResolutionRecorded
      ? `AUTO-1 conflict resolution recorded (action=${resolution?.action || "n/a"})`
      : "no AUTO-1 conflict-resolution record",
  );
  reasons.push(
    hasLocalPatchAdaptation
      ? `local product adaptation kind=${localKind}`
      : "no local product patch adaptation (maintenance metadata ignored for MIXED)",
  );
  if (maintenanceMetadataPaths.length) {
    reasons.push(
      `${maintenanceMetadataPaths.length} MAINTENANCE_METADATA path(s) ignored for product provenance`,
    );
  }

  return {
    evidenceComplete,
    evidenceSource: SYNC_STATUS_PATH,
    conflictedFiles,
    historicalConflictedFiles: historical,
    localPatchPathsTouched,
    appsolinoOnlyPaths,
    maintenanceMetadataPaths,
    conflictResolutionRecorded,
    retiredPatchIds: retired,
    syncOutcome: status.outcome || null,
    localDeltaKind: localKind,
    reasons,
  };
}

/**
 * @param {string} worktreePath
 * @param {{ prChangedFiles?: string[], liveMergeConflict?: boolean }} [extra]
 */
export function loadProvenanceEvidenceFromWorktree(worktreePath, extra = {}) {
  const load = loadUpstreamSyncStatus(worktreePath);
  if (!load.ok) {
    return extractProvenanceEvidenceFromSyncStatus(null, extra);
  }
  return extractProvenanceEvidenceFromSyncStatus(load.status, extra);
}

/**
 * @param {(args: string[]) => {status:number,stdout:string,stderr:string}} runGh
 * @param {string} repo
 * @param {string} headSha
 * @param {{ prChangedFiles?: string[], liveMergeConflict?: boolean }} [extra]
 */
export function loadProvenanceEvidenceFromPrHead(runGh, repo, headSha, extra = {}) {
  const res = runGh([
    "api",
    `repos/${repo}/contents/${SYNC_STATUS_PATH}?ref=${encodeURIComponent(headSha)}`,
    "--jq",
    ".content",
  ]);
  if (res.status !== 0 || !String(res.stdout || "").trim()) {
    return extractProvenanceEvidenceFromSyncStatus(null, extra);
  }
  try {
    const b64 = String(res.stdout).replace(/\s+/g, "");
    const json = Buffer.from(b64, "base64").toString("utf8");
    const status = JSON.parse(json);
    return extractProvenanceEvidenceFromSyncStatus(status, extra);
  } catch {
    return extractProvenanceEvidenceFromSyncStatus(null, extra);
  }
}

export { SYNC_STATUS_PATH, existsSync, readFileSync, join };
