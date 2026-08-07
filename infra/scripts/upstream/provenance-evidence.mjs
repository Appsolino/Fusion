#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-20:15:
 * Durable AUTO-1 provenance evidence. Object-shaped sync-status alone is NOT complete.
 * Require provenanceEvidenceVersion + completion flags. Separate MAINTENANCE_METADATA
 * from APPSOLINO_PRODUCT_DELTA so routine proof/status refresh does not force MIXED.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SYNC_STATUS_PATH, loadUpstreamSyncStatus } from "./sensitive-review-package.mjs";

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
