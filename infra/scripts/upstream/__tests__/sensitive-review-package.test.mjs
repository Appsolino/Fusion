#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamLatency 2026-08-07-18:30:
 * Fixture-based coverage for SENSITIVE_REVIEW package enrichment.
 * Do not hardcode live upstream SHAs into always-on CI assertions.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  analyzeMigrationSql,
  assertPackageSyncStatusAgreement,
  buildSensitiveReviewPackage,
  toVerifierEvidenceFields,
} from "../sensitive-review-package.mjs";
import { buildVerifierPrompt } from "../ai-verifier.mjs";

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout || args.join(" "));
  return (r.stdout || "").trim();
}

describe("analyzeMigrationSql", () => {
  it("detects idempotent+guarded DO $$ / IF NOT EXISTS patterns", () => {
    const a = analyzeMigrationSql(`
DO $$ BEGIN
  IF to_regclass('project.agents') IS NOT NULL THEN
    ALTER TABLE project.agents ADD COLUMN IF NOT EXISTS roles jsonb;
  END IF;
END $$;
`);
    assert.equal(a.appearsIdempotent, true);
    assert.equal(a.appearsGuarded, true);
  });

  it("does not claim idempotency for bare ALTER", () => {
    const a = analyzeMigrationSql("ALTER TABLE project.agents ADD COLUMN roles jsonb;");
    assert.equal(a.appearsIdempotent, false);
  });
});

describe("assertPackageSyncStatusAgreement", () => {
  it("errors when touchesMigrations true and declared empty", () => {
    const r = assertPackageSyncStatusAgreement({
      syncStatus: { touchesMigrations: true, upstreamFixedConflictResolution: { retiredPatchIds: [] } },
      declaredMigrations: [],
      migrationProbeOk: true,
      retiredPatchIds: [],
    });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" "), /declaredMigrations is empty/);
  });

  it("errors when migration probe fails under touchesMigrations", () => {
    const r = assertPackageSyncStatusAgreement({
      syncStatus: { touchesMigrations: true, upstreamFixedConflictResolution: { retiredPatchIds: [] } },
      declaredMigrations: [],
      migrationProbeOk: false,
      migrationProbeError: "git failed",
      retiredPatchIds: [],
    });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" "), /migration probe failed/);
  });

  it("errors when retired ids disagree", () => {
    const r = assertPackageSyncStatusAgreement({
      syncStatus: {
        touchesMigrations: false,
        upstreamFixedConflictResolution: { retiredPatchIds: ["FIX-A"] },
      },
      declaredMigrations: [],
      migrationProbeOk: true,
      retiredPatchIds: ["FIX-B"],
    });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" "), /retiredPatchIds disagree/);
  });
});

describe("buildSensitiveReviewPackage (fixture tree)", () => {
  /** @type {string} */
  let root;
  /** @type {string} */
  let baseSha;
  /** @type {string} */
  let headSha;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "sensitive-pkg-"));
    git(root, ["init"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "test"]);
    mkdirSync(join(root, "packages/core/src/postgres/migrations"), { recursive: true });
    mkdirSync(join(root, ".appsolino/patches/proofs"), { recursive: true });
    writeFileSync(join(root, "README"), "base\n");
    writeFileSync(
      join(root, "packages/core/src/postgres/migrations/0040_baseline.sql"),
      "SELECT 1;\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "base"]);
    baseSha = git(root, ["rev-parse", "HEAD"]);

    writeFileSync(
      join(root, "packages/core/src/postgres/migrations/0045_example.sql"),
      `DO $$ BEGIN
  IF to_regclass('project.agents') IS NOT NULL THEN
    ALTER TABLE project.agents ADD COLUMN IF NOT EXISTS roles jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;
`,
    );
    writeFileSync(
      join(root, ".appsolino/patches/registry.json"),
      `${JSON.stringify({ schemaVersion: 1, patchIds: ["FIX-EXAMPLE-ACTIVE", "FIX-EXAMPLE-RETIRED"], updatedUtc: "2026-08-07T00:00:00Z" }, null, 2)}\n`,
    );
    writeFileSync(
      join(root, ".appsolino/patches/FIX-EXAMPLE-ACTIVE.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "FIX-EXAMPLE-ACTIVE",
        status: "ACTIVE",
        defect: { description: "active defect" },
        regressionTests: ["test"],
        revisions: [],
        upstreamComparison: { classification: "APPSOLINO_ONLY", comparedAgainstSha: "b".repeat(40) },
        localAction: { patchRequired: true, applyPaths: ["x.ts"] },
        retirementCondition: { regressionTestPassesOnCleanUpstream: true },
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(root, ".appsolino/patches/FIX-EXAMPLE-RETIRED.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "FIX-EXAMPLE-RETIRED",
        status: "RETIRED",
        defect: { description: "retired defect" },
        regressionTests: ["test"],
        revisions: [],
        upstreamComparison: {
          classification: "UPSTREAM_FIXED",
          comparedAgainstSha: "b".repeat(40),
          relatedCommit: "c".repeat(40),
        },
        localAction: { patchRequired: false, applyPaths: [] },
        retirementCondition: { regressionTestPassesOnCleanUpstream: true },
      }, null, 2)}\n`,
    );
    const upShort = "b".repeat(12);
    writeFileSync(
      join(root, `.appsolino/patches/proofs/fix-example-retired-${upShort}.json`),
      `${JSON.stringify({ patch: "FIX-EXAMPLE-RETIRED", action: "RETIRED", status: "RETIRED" }, null, 2)}\n`,
    );
    writeFileSync(
      join(root, ".appsolino/upstream-sync-status.json"),
      `${JSON.stringify({
        touchesMigrations: true,
        touchesWorkflows: false,
        upstreamSha: "b".repeat(40),
        upstreamFixedConflictResolution: {
          action: "TAKE_UPSTREAM",
          retiredPatchIds: ["FIX-EXAMPLE-RETIRED"],
          reason: "fixture",
        },
      }, null, 2)}\n`,
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "candidate"]);
    headSha = git(root, ["rev-parse", "HEAD"]);
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("derives migrationInfo and RETAIN_ACTIVE / RETIRED rows from the tree", () => {
    const pkg = buildSensitiveReviewPackage({
      worktreePath: root,
      candidateSha: headSha,
      upstreamSha: "b".repeat(40),
      baseAppsolinoSha: baseSha,
      integrity: { passed: true, failures: [] },
    });
    assert.equal(pkg.agreement.ok, true, pkg.agreement.errors.join("; "));
    assert.equal(pkg.migrationInfo.touchesMigrations, true);
    assert.equal(pkg.migrationInfo.declaredMigrations.length, 1);
    assert.match(pkg.migrationInfo.declaredMigrations[0].file, /0045_example/);
    assert.equal(pkg.migrationInfo.declaredMigrations[0].appearsIdempotent, true);
    assert.ok(pkg.migrationInfo.hostDStagingDeploy.forwardApply.includes("Host D"));

    const actions = Object.fromEntries(
      pkg.patchRegistryChanges.filter((r) => r.patchId).map((r) => [r.patchId, r.action]),
    );
    assert.equal(actions["FIX-EXAMPLE-ACTIVE"], "RETAIN_ACTIVE");
    assert.equal(actions["FIX-EXAMPLE-RETIRED"], "RETIRED");
    assert.ok(
      pkg.patchRegistryChanges.some(
        (r) => r.action === "RETIRED" && r.proofArtifact && r.proofArtifact.includes("fix-example-retired"),
      ),
    );

    const fields = toVerifierEvidenceFields(pkg);
    assert.ok(fields.migrationInfo);
    assert.ok(Array.isArray(fields.patchRegistryChanges));
    assert.notEqual(fields.migrationInfo, null);
    assert.ok(fields.patchRegistryChanges.length > 0);
  });

  it("surfaces migrationInfo + patchRegistryChanges in the verifier prompt", () => {
    const pkg = buildSensitiveReviewPackage({
      worktreePath: root,
      candidateSha: headSha,
      upstreamSha: "b".repeat(40),
      baseAppsolinoSha: baseSha,
    });
    const fields = toVerifierEvidenceFields(pkg);
    const prompt = buildVerifierPrompt({
      originalProblem: "SENSITIVE_REVIEW fixture",
      diffText: "Mode: SENSITIVE_REVIEW",
      riskClass: "SENSITIVE",
      candidateSha: headSha,
      upstreamSha: "b".repeat(40),
      baseAppsolinoSha: baseSha,
      ...fields,
    });
    assert.match(prompt, /declaredMigrations/);
    assert.match(prompt, /RETAIN_ACTIVE|RETIRED/);
    assert.match(prompt, /0045_example/);
    assert.doesNotMatch(prompt, /"migrationInfo": null/);
    assert.doesNotMatch(prompt, /"patchRegistryChanges": \[\]/);
  });
});
