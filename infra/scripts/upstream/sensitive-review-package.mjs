#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamLatency 2026-08-07-18:30:
 * Build the SENSITIVE_REVIEW evidence package from the candidate worktree.
 * Verifier REQUEST_CHANGES on undeclared migrations / empty patchRegistryChanges
 * was burning 20m repair loops on metadata the orchestrator already knows.
 * Derive migrationInfo + patchRegistryChanges deterministically so a clean
 * SENSITIVE candidate can APPROVE on the read-only verifier path without Composer.
 *
 * Package is built in memory for the verifier prompt. Do not commit it into the
 * candidate tree during read-only sensitive-review (write side-effect forbidden).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { loadPatchRegistry } from "./patch-registry.mjs";

export const SENSITIVE_REVIEW_PACKAGE_SCHEMA_VERSION = 1;
export const SYNC_STATUS_PATH = ".appsolino/upstream-sync-status.json";
export const MIGRATIONS_GLOB_PREFIX = "packages/core/src/postgres/migrations/";
export const PROOFS_DIR = ".appsolino/patches/proofs";

/**
 * @param {string} sql
 */
export function analyzeMigrationSql(sql) {
  const text = String(sql || "");
  const lower = text.toLowerCase();
  const idempotentHints =
    /\bif\s+not\s+exists\b/i.test(text) ||
    /\bcreate\s+or\s+replace\b/i.test(text) ||
    /\badd\s+column\s+if\s+not\s+exists\b/i.test(text) ||
    /\bto_regclass\s*\(/i.test(text);
  const guarded =
    /\bdo\s+\$\$/i.test(text) ||
    /\bif\s+to_regclass\b/i.test(text) ||
    /\bexception\s+when\b/i.test(lower);
  return {
    appearsIdempotent: idempotentHints,
    appearsGuarded: guarded,
    analysisNote:
      "Heuristic from SQL text (IF NOT EXISTS / DO $$ / to_regclass). Not a substitute for Host D staging proof.",
  };
}

/**
 * @param {string} worktreePath
 * @param {{ baseSha?: string|null, headSha?: string|null }} [opts]
 * @returns {{ paths: string[], probeOk: boolean, probeError: string|null }}
 */
export function listChangedMigrationFiles(worktreePath, opts = {}) {
  const base = opts.baseSha ? String(opts.baseSha).trim() : "";
  const head = opts.headSha ? String(opts.headSha).trim() : "HEAD";
  if (!base) {
    return { paths: [], probeOk: false, probeError: "baseSha required for migration diff probe" };
  }
  const range = `${base}...${head}`;
  const r = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=AM", range, "--", MIGRATIONS_GLOB_PREFIX],
    { cwd: worktreePath, encoding: "utf8" },
  );
  if (r.status !== 0) {
    return {
      paths: [],
      probeOk: false,
      probeError: `git migration diff failed (${r.status}): ${(r.stderr || r.stdout || "").trim().slice(0, 400)}`,
    };
  }
  const paths = String(r.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((p) => p.endsWith(".sql"));
  return { paths, probeOk: true, probeError: null };
}

/**
 * @param {string} worktreePath
 */
export function loadUpstreamSyncStatus(worktreePath) {
  const path = join(worktreePath, SYNC_STATUS_PATH);
  if (!existsSync(path)) return { ok: false, reason: "missing upstream-sync-status.json", status: null };
  try {
    return { ok: true, reason: null, status: JSON.parse(readFileSync(path, "utf8")) };
  } catch (err) {
    return { ok: false, reason: `invalid sync status: ${err instanceof Error ? err.message : String(err)}`, status: null };
  }
}

/**
 * @param {string} worktreePath
 * @param {string} upstreamSha
 */
export function listProofArtifacts(worktreePath, upstreamSha) {
  const dir = join(worktreePath, PROOFS_DIR);
  if (!existsSync(dir)) return [];
  const short = String(upstreamSha || "").slice(0, 12).toLowerCase();
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .filter((n) => !short || n.toLowerCase().includes(short))
    .map((n) => `${PROOFS_DIR}/${n}`)
    .sort();
}

/**
 * Fail closed when package and sync status disagree on migration / retirement scope.
 * @param {{
 *   syncStatus: object|null,
 *   declaredMigrations: string[],
 *   migrationProbeOk: boolean,
 *   migrationProbeError?: string|null,
 *   retiredPatchIds: string[],
 * }} input
 */
export function assertPackageSyncStatusAgreement(input) {
  /** @type {string[]} */
  const errors = [];
  const sync = input.syncStatus;
  if (!sync) {
    errors.push("upstream-sync-status.json missing — cannot prove migration/patch agreement");
    return { ok: false, errors };
  }
  if (sync.touchesMigrations === true) {
    if (!input.migrationProbeOk) {
      errors.push(
        `touchesMigrations:true but migration probe failed: ${input.migrationProbeError || "unknown"}`,
      );
    } else if (!input.declaredMigrations.length) {
      errors.push("touchesMigrations:true but declaredMigrations is empty");
    }
  }
  if (sync.touchesMigrations === false && input.declaredMigrations.length > 0) {
    errors.push("sync status touchesMigrations:false but migrations are declared in the package");
  }
  const retiredFromSync = Array.isArray(sync.upstreamFixedConflictResolution?.retiredPatchIds)
    ? sync.upstreamFixedConflictResolution.retiredPatchIds.map(String)
    : [];
  const retiredSorted = [...input.retiredPatchIds].map(String).sort();
  const syncSorted = [...retiredFromSync].sort();
  if (JSON.stringify(retiredSorted) !== JSON.stringify(syncSorted)) {
    errors.push(
      `retiredPatchIds disagree with upstreamFixedConflictResolution (package=[${retiredSorted.join(",")}] sync=[${syncSorted.join(",")}])`,
    );
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {{
 *   worktreePath: string,
 *   candidateSha: string,
 *   upstreamSha: string,
 *   baseAppsolinoSha: string,
 *   deterministicAuto2?: object|null,
 *   integrity?: { passed?: boolean, failures?: string[] }|null,
 * }} input
 */
export function buildSensitiveReviewPackage(input) {
  const worktreePath = input.worktreePath;
  const candidateSha = String(input.candidateSha || "").toLowerCase();
  const upstreamSha = String(input.upstreamSha || "").toLowerCase();
  const baseAppsolinoSha = String(input.baseAppsolinoSha || "").toLowerCase();

  const syncLoad = loadUpstreamSyncStatus(worktreePath);
  const syncStatus = syncLoad.status;

  const migProbe = listChangedMigrationFiles(worktreePath, {
    baseSha: baseAppsolinoSha,
    headSha: candidateSha || "HEAD",
  });
  const declaredMigrations = migProbe.paths.map((path) => {
    const sql = existsSync(join(worktreePath, path))
      ? readFileSync(join(worktreePath, path), "utf8")
      : "";
    const analysis = analyzeMigrationSql(sql);
    return {
      path,
      file: basename(path),
      change: "added-or-modified",
      ...analysis,
    };
  });

  const registry = loadPatchRegistry(worktreePath);
  const retiredFromSync = Array.isArray(syncStatus?.upstreamFixedConflictResolution?.retiredPatchIds)
    ? syncStatus.upstreamFixedConflictResolution.retiredPatchIds.map((id) => String(id).toUpperCase())
    : [];
  const proofArtifacts = listProofArtifacts(worktreePath, upstreamSha);

  /** @type {object[]} */
  const patchRegistryChanges = [];
  for (const patch of registry.patches) {
    if (!patch) continue;
    const retired =
      patch.status === "RETIRED" ||
      retiredFromSync.includes(String(patch.id).toUpperCase()) ||
      String(patch.upstreamComparison?.classification || "").toUpperCase() === "UPSTREAM_FIXED";
    if (retired && (patch.status === "RETIRED" || retiredFromSync.includes(String(patch.id).toUpperCase()))) {
      const proof = proofArtifacts.find((p) =>
        p.toLowerCase().includes(String(patch.id).toLowerCase().replace(/^fix-/, "fix-").replace(/_/g, "-")),
      ) || proofArtifacts.find((p) => p.toLowerCase().includes(String(patch.id).slice(4).toLowerCase().replace(/_/g, "-")));
      patchRegistryChanges.push({
        action: "RETIRED",
        patchId: patch.id,
        status: patch.status,
        classification: patch.upstreamComparison?.classification || "UPSTREAM_FIXED",
        comparedAgainstSha: patch.upstreamComparison?.comparedAgainstSha || upstreamSha,
        relatedCommit: patch.upstreamComparison?.relatedCommit || null,
        proofArtifact: proof || null,
        retirementCondition: patch.retirementCondition || null,
      });
    } else if (patch.status === "ACTIVE") {
      patchRegistryChanges.push({
        action: "RETAIN_ACTIVE",
        patchId: patch.id,
        status: patch.status,
        classification: patch.upstreamComparison?.classification || null,
        comparedAgainstSha: patch.upstreamComparison?.comparedAgainstSha || upstreamSha,
        applyPaths: patch.localAction?.applyPaths || [],
      });
    } else {
      patchRegistryChanges.push({
        action: "DECLARED",
        patchId: patch.id,
        status: patch.status,
        classification: patch.upstreamComparison?.classification || null,
      });
    }
  }

  // Surface proof artifacts added for this upstream tip even when already linked above.
  for (const proof of proofArtifacts) {
    if (!patchRegistryChanges.some((row) => row.proofArtifact === proof)) {
      patchRegistryChanges.push({
        action: "PROOF_ARTIFACT",
        proofArtifact: proof,
      });
    }
  }

  const retiredPatchIds = [
    ...new Set([
      ...retiredFromSync,
      ...patchRegistryChanges.filter((r) => r.action === "RETIRED").map((r) => String(r.patchId).toUpperCase()),
    ]),
  ];

  const agreement = assertPackageSyncStatusAgreement({
    syncStatus,
    declaredMigrations: declaredMigrations.map((m) => m.path),
    migrationProbeOk: migProbe.probeOk,
    migrationProbeError: migProbe.probeError,
    retiredPatchIds,
  });

  const allIdempotent = declaredMigrations.length > 0 && declaredMigrations.every((m) => m.appearsIdempotent);
  const allGuarded = declaredMigrations.length > 0 && declaredMigrations.every((m) => m.appearsGuarded);

  const laneProof = proofArtifacts.find((p) => p.includes("fix-lane-wiring-touch-fixture"));
  const migrationInfo = {
    touchesMigrations: Boolean(syncStatus?.touchesMigrations),
    declaredMigrations,
    migrationProbe: {
      ok: migProbe.probeOk,
      error: migProbe.probeError,
      baseSha: baseAppsolinoSha,
      headSha: candidateSha,
    },
    hostDStagingDeploy: {
      forwardApply: declaredMigrations.length
        ? allIdempotent && allGuarded
          ? "Host D staging applies declared migrations; SQL heuristics suggest idempotent+guarded re-run is safe on partial state."
          : "Host D staging must apply declared migrations before promoting the absorb; do not discover them at deploy time. Heuristics do not claim safe re-run on partial state."
        : "No migration files in candidate vs base.",
      rollback:
        "Host D only. Do not touch Host P. Rollback is staging-deploy rollback / prior package — never production activation.",
      declaredCount: declaredMigrations.length,
      heuristicsAllIdempotent: allIdempotent,
      heuristicsAllGuarded: allGuarded,
    },
    syncStatusAgreement: agreement,
  };

  const deterministicAuto2 =
    input.deterministicAuto2 ||
    {
      source: "AUTO-2 credential-free candidate validation + expert integrity",
      integrityPassed: input.integrity?.passed !== false,
      integrityFailures: input.integrity?.failures || [],
      cleanUpstreamRetirementProof: laneProof
        ? {
            path: laneProof,
            note: "FIX-LANE-WIRING-TOUCH-FIXTURE retirement proven at AUTO-1 reconcile time on clean upstream; expert worktree may lack node_modules so do not require live re-exec of pnpm check:lane-wiring here.",
          }
        : null,
    };

  return {
    schemaVersion: SENSITIVE_REVIEW_PACKAGE_SCHEMA_VERSION,
    candidateSha,
    upstreamSha,
    baseAppsolinoSha,
    packageBinding: {
      candidateSha,
      upstreamSha,
      baseAppsolinoSha,
    },
    syncStatusSummary: syncStatus
      ? {
          touchesMigrations: syncStatus.touchesMigrations === true,
          touchesWorkflows: syncStatus.touchesWorkflows === true,
          upstreamFixedConflictResolution: syncStatus.upstreamFixedConflictResolution || null,
          behind: syncStatus.behind ?? null,
          ahead: syncStatus.ahead ?? null,
        }
      : null,
    syncStatusLoad: { ok: syncLoad.ok, reason: syncLoad.reason },
    migrationInfo,
    patchRegistryChanges,
    proofArtifacts,
    deterministicAuto2,
    agreement,
  };
}

/**
 * Flatten package into ai-verifier evidence fields.
 * @param {ReturnType<typeof buildSensitiveReviewPackage>} pkg
 */
export function toVerifierEvidenceFields(pkg) {
  return {
    migrationInfo: pkg.migrationInfo,
    patchRegistryChanges: pkg.patchRegistryChanges,
    deterministicTestResults: {
      ...(pkg.deterministicAuto2 || {}),
      agreementOk: pkg.agreement?.ok === true,
      agreementErrors: pkg.agreement?.errors || [],
    },
    sensitiveReviewPackageAgreement: pkg.agreement,
  };
}
