#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamAiProtocol 2026-08-07-09:20:
 * Guard: expert integrity must ignore committed fixture/prose markers and only
 * fail on unmerged paths or markers in dirty expert-touched files.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runExpertIntegrityChecks } from "../expert-integrity.mjs";

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "expert-integrity-"));
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# ok\n");
  // Committed fixture with real-looking markers — must NOT fail integrity when clean.
  mkdirSync(join(dir, "packages/engine/src/__tests__"), { recursive: true });
  writeFileSync(
    join(dir, "packages/engine/src/__tests__/census-fixture.ts"),
    ["<<<<<<< HEAD", "old", "=======", "new", ">>>>>>> branch", ""].join("\n"),
  );
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("runExpertIntegrityChecks", () => {
  it("passes a clean tree even with committed fixture conflict markers", () => {
    const dir = initRepo();
    try {
      const r = runExpertIntegrityChecks(dir);
      assert.equal(r.passed, true, JSON.stringify(r));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes dirty prose that mentions markers without line-anchored form", () => {
    const dir = initRepo();
    try {
      writeFileSync(join(dir, "note.md"), "look for <<<<<<< markers in docs\n");
      const r = runExpertIntegrityChecks(dir);
      assert.equal(r.passed, true, JSON.stringify(r));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when dirty files contain line-anchored conflict markers", () => {
    const dir = initRepo();
    try {
      writeFileSync(
        join(dir, "broken.ts"),
        ["<<<<<<< HEAD", "a", "=======", "b", ">>>>>>> other", ""].join("\n"),
      );
      const r = runExpertIntegrityChecks(dir);
      assert.equal(r.passed, false);
      assert.ok(r.failures.some((f) => /conflict markers/.test(f)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
