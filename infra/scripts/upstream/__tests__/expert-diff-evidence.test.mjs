#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamAiProtocol 2026-08-07-12:15:
 * Verifier evidence must include committed expert edits, not only unstaged diff.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { collectExpertDiffEvidence } from "../expert-repair-loop.mjs";

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "expert-diff-"));
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "one\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });
  const start = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  return { dir, start };
}

describe("collectExpertDiffEvidence", () => {
  it("includes committed edits since startSha (not only unstaged)", () => {
    const { dir, start } = initRepo();
    try {
      writeFileSync(join(dir, "a.txt"), "two\n");
      spawnSync("git", ["add", "."], { cwd: dir });
      spawnSync("git", ["commit", "-m", "expert edit"], { cwd: dir });
      const bareUnstaged = spawnSync("git", ["-C", dir, "diff"], { encoding: "utf8" }).stdout;
      assert.equal(bareUnstaged.trim(), "", "control: unstaged empty after commit");
      const evidence = collectExpertDiffEvidence(dir, start);
      assert.match(evidence, /git diff .*HEAD/);
      assert.match(evidence, /two/);
      assert.match(evidence, /expert edit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes unstaged dirty files", () => {
    const { dir, start } = initRepo();
    try {
      writeFileSync(join(dir, "b.txt"), "dirty\n");
      const evidence = collectExpertDiffEvidence(dir, start);
      assert.match(evidence, /git status/);
      assert.match(evidence, /b\.txt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
