#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto3 2026-08-01-01:20:
 * Trusted AUTO-3 source/guards. Pure helpers for exact-main SHA admission,
 * artifact integrity, Host D path allow-lists, and deploy classification.
 * Never executes candidate package scripts. Never targets Host P.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export const ALLOWED_RELEASE_ROOTS = Object.freeze([
  "/opt/appsolino-fusion/staging/releases",
  "/opt/appsolino-fusion/staging-proof/releases",
]);

export const ALLOWED_CURRENT_LINKS = Object.freeze([
  "/opt/appsolino-fusion/staging/current",
  "/opt/appsolino-fusion/staging-proof/current",
]);

export const FORBIDDEN_HOST_P_MARKERS = Object.freeze([
  "/opt/appsolino-fusion/production",
  "/srv/appsolino-fusion/production",
  "fusion-production.service",
  "fusion_production",
  "Host P",
]);

/**
 * @param {string} sha
 */
export function isFullSha(sha) {
  return typeof sha === "string" && /^[0-9a-f]{40}$/i.test(sha.trim());
}

/**
 * @param {string} root
 */
export function isAllowedReleaseRoot(root) {
  return ALLOWED_RELEASE_ROOTS.includes(root);
}

/**
 * @param {string} link
 */
export function isAllowedCurrentLink(link) {
  return ALLOWED_CURRENT_LINKS.includes(link);
}

/**
 * @param {string} text
 */
export function containsHostPMarker(text) {
  const s = String(text || "");
  return FORBIDDEN_HOST_P_MARKERS.some((m) => s.includes(m));
}

/**
 * @param {{ sourceSha: string, mainTipSha: string, isAncestorOfMain: boolean, fromPrHeadOnly?: boolean, expectedMergedSha?: string }} input
 */
export function admitSourceSha(input) {
  const sourceSha = String(input.sourceSha || "").trim().toLowerCase();
  const mainTip = String(input.mainTipSha || "").trim().toLowerCase();
  const reasons = [];
  if (!isFullSha(sourceSha)) reasons.push("source_sha must be a full 40-char commit SHA");
  if (input.fromPrHeadOnly === true) reasons.push("deployment from pull-request head branches is forbidden");
  if (input.isAncestorOfMain !== true) reasons.push("source_sha must exist on Appsolino main");
  if (input.expectedMergedSha) {
    const expected = String(input.expectedMergedSha).trim().toLowerCase();
    if (expected && expected !== sourceSha) {
      reasons.push("source_sha must equal the AUTO-2 merged/approved SHA");
    }
  }
  if (mainTip && isFullSha(mainTip) && sourceSha === mainTip) {
    // tip equality is fine; not required
  }
  return {
    admitted: reasons.length === 0,
    sourceSha,
    reasons,
  };
}

/**
 * @param {{ activeMainSha?: string, candidateMainSha: string, activeExeSha256?: string, candidateExeSha256: string, activeReleaseId?: string, candidateReleaseId: string }} input
 */
export function classifyIdempotentDeploy(input) {
  const sameSha = Boolean(input.activeMainSha) && input.activeMainSha === input.candidateMainSha;
  const sameExe = Boolean(input.activeExeSha256) && input.activeExeSha256 === input.candidateExeSha256;
  const sameRel = Boolean(input.activeReleaseId) && input.activeReleaseId === input.candidateReleaseId;
  if (sameSha && sameExe && sameRel) {
    return { idempotent: true, action: "IDEMPOTENT_NOOP", reasons: ["exact release already active"] };
  }
  if (sameSha && sameExe) {
    return { idempotent: true, action: "IDEMPOTENT_INTEGRITY_REVALIDATE", reasons: ["same source/exe already installed; integrity-only"] };
  }
  return { idempotent: false, action: "DEPLOY", reasons: [] };
}

/**
 * @param {{ expectedArchiveSha256: string, actualArchiveSha256: string, expectedExeSha256: string, actualExeSha256: string, expectedExeModeExecutable: boolean, actualExeModeExecutable: boolean }} input
 */
export function verifyArtifactIntegrity(input) {
  const reasons = [];
  if (input.expectedArchiveSha256 !== input.actualArchiveSha256) reasons.push("archive hash mismatch");
  if (input.expectedExeSha256 !== input.actualExeSha256) reasons.push("executable hash mismatch");
  if (input.expectedExeModeExecutable && !input.actualExeModeExecutable) reasons.push("executable mode mismatch");
  return { ok: reasons.length === 0, reasons };
}

/**
 * @param {string} content
 * @param {string} [algo]
 */
export function sha256Text(content, algo = "sha256") {
  return createHash(algo).update(content).digest("hex");
}

/**
 * @param {string} repoDir
 * @param {string} sha
 * @param {string} [mainRef]
 */
export function gitIsAncestorOfMain(repoDir, sha, mainRef = "origin/main") {
  const r = spawnSync("git", ["-C", repoDir, "merge-base", "--is-ancestor", sha, mainRef], {
    encoding: "utf8",
  });
  return r.status === 0;
}

/**
 * @param {string} repoDir
 * @param {string} [mainRef]
 */
export function gitRevParse(repoDir, mainRef = "origin/main") {
  const r = spawnSync("git", ["-C", repoDir, "rev-parse", mainRef], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git rev-parse failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/**
 * Manifest required keys for AUTO-3 immutable archives.
 */
export const REQUIRED_MANIFEST_KEYS = Object.freeze([
  "sourceSha",
  "sourcePr",
  "applicationVersion",
  "releaseId",
  "buildUtc",
  "nodeVersion",
  "pnpmVersion",
  "executableSha256",
  "archiveSha256",
  "migrationSetSha256",
  "packagedTreeDigest",
  "expectedHealthVersion",
  "requiredSchemaCeiling",
]);

/**
 * @param {Record<string, unknown>} manifest
 */
export function validateManifestShape(manifest) {
  // sourcePr may be null for manual dispatches; all other required keys must be non-empty.
  const missing = REQUIRED_MANIFEST_KEYS.filter((k) => {
    if (k === "sourcePr") return !Object.prototype.hasOwnProperty.call(manifest, k);
    return manifest[k] == null || manifest[k] === "";
  });
  const reasons = missing.map((k) => `missing manifest field: ${k}`);
  if (containsHostPMarker(JSON.stringify(manifest))) reasons.push("manifest contains Host P / production marker");
  return { ok: reasons.length === 0, reasons };
}

/**
 * @param {"DEPLOYED"|"ROLLED_BACK"|"CRITICAL"|"IDEMPOTENT_NOOP"|"BLOCKED"} status
 * @param {string[]} reasons
 * @param {Record<string, unknown>} [extra]
 */
export function buildDeployResult(status, reasons = [], extra = {}) {
  return {
    status,
    reasons,
    deployedHostP: false,
    ...extra,
    recordedUtc: new Date().toISOString(),
  };
}
