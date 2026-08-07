#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-20:04:
 * Load durable AUTO-1 provenance evidence. Never infer EXACT_UPSTREAM merely because
 * GitHub currently reports MERGEABLE — resolved conflicts clear live conflict state.
 * Prefer upstream-sync-status.json on the candidate head (historical conflict resolution,
 * patch retirement, Appsolino-only path deltas).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SYNC_STATUS_PATH, loadUpstreamSyncStatus } from "./sensitive-review-package.mjs";

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
      conflictResolutionRecorded: false,
      reasons: ["missing upstream-sync-status — cannot prove EXACT_UPSTREAM"],
    };
  }

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

  /** Paths that were conflicted at AUTO-1 time — survive after GitHub mergeable clears. */
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

  const prFiles = Array.isArray(extra.prChangedFiles) ? extra.prChangedFiles.map(String) : [];
  const appsolinoOnlyPaths = prFiles.filter(
    (f) =>
      f.startsWith(".appsolino/") ||
      f.startsWith("infra/scripts/upstream/") ||
      f === "docs/appsolino/CURRENT-STATE.md",
  );

  /** Patch registry / proofs adapted on the candidate (local Appsolino delta). */
  const localPatchPathsTouched = prFiles.filter(
    (f) =>
      f.startsWith(".appsolino/patches/") ||
      f.includes("/patches/proofs/") ||
      (retired.length > 0 && f.includes("registry.json")),
  );

  return {
    evidenceComplete: true,
    evidenceSource: SYNC_STATUS_PATH,
    conflictedFiles,
    historicalConflictedFiles: historical,
    localPatchPathsTouched,
    appsolinoOnlyPaths,
    conflictResolutionRecorded,
    retiredPatchIds: retired,
    syncOutcome: status.outcome || null,
    reasons: [
      conflictResolutionRecorded
        ? `AUTO-1 conflict resolution recorded (action=${resolution?.action || "n/a"})`
        : "no AUTO-1 conflict-resolution record",
      appsolinoOnlyPaths.length
        ? `${appsolinoOnlyPaths.length} Appsolino-plane path(s) in candidate delta`
        : "no Appsolino-plane paths in PR file list",
    ],
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
 * Fetch sync status from a PR head via GitHub Contents API (trusted finalizer).
 * @param {(args: string[]) => {status:number,stdout:string,stderr:string}} runGh
 * @param {string} repo
 * @param {string} headSha
 * @param {{ prChangedFiles?: string[], liveMergeConflict?: boolean }} [extra]
 */
export function loadProvenanceEvidenceFromPrHead(runGh, repo, headSha, extra = {}) {
  const path = encodeURIComponent(SYNC_STATUS_PATH).replace(/%2F/g, "/");
  const res = runGh([
    "api",
    `repos/${repo}/contents/${SYNC_STATUS_PATH}?ref=${encodeURIComponent(headSha)}`,
    "--jq",
    ".content",
  ]);
  if (res.status !== 0 || !String(res.stdout || "").trim()) {
    return extractProvenanceEvidenceFromSyncStatus(null, {
      ...extra,
      reasons: [`could not fetch ${SYNC_STATUS_PATH} at ${headSha.slice(0, 12)}`],
    });
  }
  try {
    const b64 = String(res.stdout).replace(/\s+/g, "");
    const json = Buffer.from(b64, "base64").toString("utf8");
    const status = JSON.parse(json);
    return extractProvenanceEvidenceFromSyncStatus(status, extra);
  } catch (err) {
    return extractProvenanceEvidenceFromSyncStatus(null, {
      ...extra,
      reasons: [`invalid sync status at head: ${err instanceof Error ? err.message : String(err)}`],
    });
  }
}

export { SYNC_STATUS_PATH, existsSync, readFileSync, join };
