#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto1 2026-07-31-12:40:
 * Disposable-repo validation harness for AUTO-1 (no Host D deploy, no Appsolino main mutation).
 *
 * FNXC:AppsolinoAuto1 2026-07-31-16:05:
 * Also asserts the live workflow App-token + gh auth setup-git contract (static YAML checks).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  resolveIntegrationBranch,
  runAuto1Sync,
  syncBranchNameForUpstream,
  STATUS_PATH,
} from "../auto1-upstream-sync.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/upstream-auto1.yml");

function sh(cwd, args) {
  const r = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${args.join(" ")}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function initRepo(dir, { branch = "main" } = {}) {
  mkdirSync(dir, { recursive: true });
  sh(dir, ["git", "init", "-b", branch]);
  sh(dir, ["git", "config", "user.email", "auto1@test.local"]);
  sh(dir, ["git", "config", "user.name", "AUTO-1 Test"]);
}

function commitFile(dir, rel, content, message) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  sh(dir, ["git", "add", rel]);
  sh(dir, ["git", "commit", "-m", message]);
}

describe("AUTO-1 upstream sync", () => {
  /** @type {string[]} */
  const temps = [];
  const track = (dir) => {
    temps.push(dir);
    return dir;
  };

  after(() => {
    for (const dir of temps) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("resolves non-main default branch via origin/HEAD (ISS-GIT-007)", () => {
    const root = track(mkdtempSync(join(tmpdir(), "auto1-default-")));
    const upstream = join(root, "upstream");
    const appsolino = join(root, "appsolino");
    initRepo(upstream, { branch: "master" });
    commitFile(upstream, "README.md", "u\n", "u1");
    initRepo(appsolino, { branch: "master" });
    commitFile(appsolino, "README.md", "a\n", "a1");
    sh(appsolino, ["git", "remote", "add", "origin", upstream]);
    sh(appsolino, ["git", "fetch", "origin"]);
    sh(appsolino, ["git", "remote", "set-head", "origin", "master"]);
    assert.equal(resolveIntegrationBranch(appsolino), "master");
    assert.equal(resolveIntegrationBranch(appsolino, { integrationBranch: "develop" }), "develop");
  });

  it("exits no-change when upstream is not ahead", () => {
    const root = track(mkdtempSync(join(tmpdir(), "auto1-noop-")));
    const upstream = join(root, "upstream");
    const appsolino = join(root, "appsolino");
    initRepo(upstream);
    commitFile(upstream, "README.md", "same\n", "u1");
    initRepo(appsolino);
    commitFile(appsolino, "README.md", "same\n", "a1");
    // Make appsolino tip equal upstream by pulling content
    sh(appsolino, ["git", "remote", "add", "upstream", upstream]);
    sh(appsolino, ["git", "fetch", "upstream"]);
    sh(appsolino, ["git", "reset", "--hard", "upstream/main"]);
    sh(appsolino, ["git", "remote", "add", "origin", appsolino]);
    // origin/main: use a bare mirror
    const originBare = join(root, "origin.git");
    sh(root, ["git", "clone", "--bare", appsolino, originBare]);
    sh(appsolino, ["git", "remote", "set-url", "origin", originBare]);
    sh(appsolino, ["git", "fetch", "origin"]);
    sh(appsolino, ["git", "remote", "set-head", "origin", "main"]);

    const result = runAuto1Sync({
      repoDir: appsolino,
      upstreamUrl: upstream,
      push: false,
      createPr: false,
    });
    assert.equal(result.outcome, "no-change");
    assert.equal(result.behind, 0);
    assert.equal(result.mutatedMain, false);
    assert.equal(result.deployedHostD, false);
    assert.equal(result.syncBranch, null);
  });

  it("creates a merge --no-ff commit on automation/upstream-* without mutating main", () => {
    const root = track(mkdtempSync(join(tmpdir(), "auto1-merge-")));
    const upstream = join(root, "upstream");
    const appsolino = join(root, "appsolino");
    const originBare = join(root, "origin.git");

    initRepo(upstream);
    commitFile(upstream, "README.md", "base\n", "base");
    const baseSha = sh(upstream, ["git", "rev-parse", "HEAD"]);

    initRepo(appsolino);
    sh(appsolino, ["git", "remote", "add", "upstream", upstream]);
    sh(appsolino, ["git", "fetch", "upstream"]);
    sh(appsolino, ["git", "reset", "--hard", "upstream/main"]);
    commitFile(appsolino, "appsolino-only.txt", "keep\n", "appsolino only");
    const appsolinoMainBefore = sh(appsolino, ["git", "rev-parse", "HEAD"]);

    sh(upstream, ["git", "checkout", "main"]);
    commitFile(upstream, "upstream-new.txt", "new\n", "upstream advance");
    commitFile(upstream, ".github/workflows/ci.yml", "name: ci\n", "upstream workflow");

    sh(root, ["git", "clone", "--bare", appsolino, originBare]);
    sh(appsolino, ["git", "remote", "add", "origin", originBare]);
    sh(appsolino, ["git", "fetch", "origin"]);
    sh(appsolino, ["git", "remote", "set-head", "origin", "main"]);

    const result = runAuto1Sync({
      repoDir: appsolino,
      upstreamUrl: upstream,
      push: true,
      createPr: false,
    });

    assert.equal(result.outcome, "merged");
    assert.equal(result.conflict, false);
    assert.ok(result.syncBranch?.startsWith("automation/upstream-"));
    assert.equal(result.touchesWorkflows, true);
    assert.equal(result.mutatedMain, false);
    assert.equal(result.deployedHostD, false);

    // main tip unchanged relative to pre-sync appsolino commit (local main may move with checkout - check origin/main)
    const originMain = sh(appsolino, ["git", "rev-parse", "origin/main"]);
    assert.equal(originMain, appsolinoMainBefore);

    // Sync branch exists on origin and is a merge commit
    const syncSha = sh(appsolino, ["git", "rev-parse", `origin/${result.syncBranch}`]);
    const parents = sh(appsolino, ["git", "rev-list", "--parents", "-n", "1", syncSha]).split(" ");
    // status commit may be on top of merge — find merge commit
    const log = sh(appsolino, ["git", "log", "--merges", "-n", "1", "--pretty=%H", syncSha]);
    assert.ok(log.length > 0);
    assert.ok(existsSync(join(appsolino, STATUS_PATH)));
    void baseSha;
    void parents;
  });

  it("records a durable conflict state and does not leave merge in progress", () => {
    const root = track(mkdtempSync(join(tmpdir(), "auto1-conflict-")));
    const upstream = join(root, "upstream");
    const appsolino = join(root, "appsolino");
    const originBare = join(root, "origin.git");

    initRepo(upstream);
    commitFile(upstream, "conflict.txt", "upstream-base\n", "base");
    initRepo(appsolino);
    sh(appsolino, ["git", "remote", "add", "upstream", upstream]);
    sh(appsolino, ["git", "fetch", "upstream"]);
    sh(appsolino, ["git", "reset", "--hard", "upstream/main"]);
    commitFile(appsolino, "conflict.txt", "appsolino\n", "appsolino edit");

    sh(upstream, ["git", "checkout", "main"]);
    commitFile(upstream, "conflict.txt", "upstream\n", "upstream edit");

    sh(root, ["git", "clone", "--bare", appsolino, originBare]);
    sh(appsolino, ["git", "remote", "add", "origin", originBare]);
    sh(appsolino, ["git", "fetch", "origin"]);
    sh(appsolino, ["git", "remote", "set-head", "origin", "main"]);

    const result = runAuto1Sync({
      repoDir: appsolino,
      upstreamUrl: upstream,
      push: true,
      createPr: false,
    });
    assert.equal(result.outcome, "conflict");
    assert.equal(result.conflict, true);
    assert.ok(result.conflictedFiles.includes("conflict.txt"));
    const status = JSON.parse(readFileSync(join(appsolino, STATUS_PATH), "utf8"));
    assert.equal(status.outcome, "conflict");
    // No merge in progress
    const mergeHead = spawnSync("git", ["-C", appsolino, "rev-parse", "-q", "--verify", "MERGE_HEAD"], {
      encoding: "utf8",
    });
    assert.notEqual(mergeHead.status, 0);
  });

  it("idempotent second run refreshes the same sync branch name for the same upstream SHA", () => {
    const root = track(mkdtempSync(join(tmpdir(), "auto1-idem-")));
    const upstream = join(root, "upstream");
    const appsolino = join(root, "appsolino");
    const originBare = join(root, "origin.git");

    initRepo(upstream);
    commitFile(upstream, "README.md", "base\n", "base");
    initRepo(appsolino);
    sh(appsolino, ["git", "remote", "add", "upstream", upstream]);
    sh(appsolino, ["git", "fetch", "upstream"]);
    sh(appsolino, ["git", "reset", "--hard", "upstream/main"]);
    commitFile(appsolino, "a.txt", "a\n", "a");
    sh(upstream, ["git", "checkout", "main"]);
    commitFile(upstream, "u.txt", "u\n", "u");

    sh(root, ["git", "clone", "--bare", appsolino, originBare]);
    sh(appsolino, ["git", "remote", "add", "origin", originBare]);
    sh(appsolino, ["git", "fetch", "origin"]);
    sh(appsolino, ["git", "remote", "set-head", "origin", "main"]);

    const first = runAuto1Sync({ repoDir: appsolino, upstreamUrl: upstream, push: true, createPr: false });
    const second = runAuto1Sync({ repoDir: appsolino, upstreamUrl: upstream, push: true, createPr: false });
    assert.equal(first.syncBranch, second.syncBranch);
    assert.equal(first.upstreamSha, second.upstreamSha);
    assert.equal(syncBranchNameForUpstream(first.upstreamSha), first.syncBranch);
  });

  it("updates an existing open PR instead of creating a duplicate", () => {
    const root = track(mkdtempSync(join(tmpdir(), "auto1-pr-")));
    const upstream = join(root, "upstream");
    const appsolino = join(root, "appsolino");
    const originBare = join(root, "origin.git");

    initRepo(upstream);
    commitFile(upstream, "README.md", "base\n", "base");
    initRepo(appsolino);
    sh(appsolino, ["git", "remote", "add", "upstream", upstream]);
    sh(appsolino, ["git", "fetch", "upstream"]);
    sh(appsolino, ["git", "reset", "--hard", "upstream/main"]);
    commitFile(appsolino, "a.txt", "a\n", "a");
    sh(upstream, ["git", "checkout", "main"]);
    commitFile(upstream, "u.txt", "u\n", "u");
    sh(root, ["git", "clone", "--bare", appsolino, originBare]);
    sh(appsolino, ["git", "remote", "add", "origin", originBare]);
    sh(appsolino, ["git", "fetch", "origin"]);
    sh(appsolino, ["git", "remote", "set-head", "origin", "main"]);

    /** @type {string[][]} */
    const calls = [];
    const gh = (args) => {
      calls.push(args);
      if (args[0] === "pr" && args[1] === "list") {
        return {
          status: 0,
          stdout: JSON.stringify([{ number: 99, url: "https://example.test/pr/99" }]),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "edit") {
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected gh ${args.join(" ")}` };
    };

    const result = runAuto1Sync({
      repoDir: appsolino,
      upstreamUrl: upstream,
      push: false,
      createPr: true,
      allowMissingApp: true,
      ghRepo: "Appsolino/Fusion",
      gh,
    });
    assert.equal(result.prUrl, "https://example.test/pr/99");
    assert.ok(calls.some((c) => c[0] === "pr" && c[1] === "edit"));
    assert.ok(!calls.some((c) => c[0] === "pr" && c[1] === "create"));
  });

  it("fails closed when createPr is requested without GitHub App token", () => {
    const root = track(mkdtempSync(join(tmpdir(), "auto1-app-")));
    const upstream = join(root, "upstream");
    const appsolino = join(root, "appsolino");
    const originBare = join(root, "origin.git");
    initRepo(upstream);
    commitFile(upstream, "README.md", "base\n", "base");
    initRepo(appsolino);
    sh(appsolino, ["git", "remote", "add", "upstream", upstream]);
    sh(appsolino, ["git", "fetch", "upstream"]);
    sh(appsolino, ["git", "reset", "--hard", "upstream/main"]);
    commitFile(appsolino, "a.txt", "a\n", "a");
    sh(upstream, ["git", "checkout", "main"]);
    commitFile(upstream, "u.txt", "u\n", "u");
    sh(root, ["git", "clone", "--bare", appsolino, originBare]);
    sh(appsolino, ["git", "remote", "add", "origin", originBare]);
    sh(appsolino, ["git", "fetch", "origin"]);
    sh(appsolino, ["git", "remote", "set-head", "origin", "main"]);

    const prev = {
      AUTO1_GITHUB_APP_TOKEN: process.env.AUTO1_GITHUB_APP_TOKEN,
      GH_TOKEN: process.env.GH_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    };
    delete process.env.AUTO1_GITHUB_APP_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      assert.throws(
        () =>
          runAuto1Sync({
            repoDir: appsolino,
            upstreamUrl: upstream,
            push: false,
            createPr: true,
            ghRepo: "Appsolino/Fusion",
            allowMissingApp: false,
          }),
        /fail-closed|GitHub App token unavailable/i,
      );
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("workflow uses App token v3, explicit write perms, setup-git before sync, no owner PAT", () => {
    const yaml = readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(yaml, /uses:\s*actions\/create-github-app-token@v3\b/);
    assert.doesNotMatch(yaml, /create-github-app-token@v2\b/);
    assert.match(yaml, /permission-contents:\s*write/);
    assert.match(yaml, /permission-pull-requests:\s*write/);
    assert.match(yaml, /permission-workflows:\s*write/);
    assert.match(yaml, /persist-credentials:\s*false/);
    assert.match(yaml, /APPSOLINO_AUTOMATION_APP_ID/);
    assert.match(yaml, /APPSOLINO_AUTOMATION_APP_PRIVATE_KEY/);
    assert.match(yaml, /gh auth setup-git/);
    assert.match(yaml, /git ls-remote --exit-code origin HEAD/);
    assert.match(yaml, /concurrency:[\s\S]*group:\s*auto1-upstream-sync/);
    assert.match(yaml, /does not build, install, or activate Host D/);

    const setupIdx = yaml.indexOf("gh auth setup-git");
    const probeIdx = yaml.indexOf("git ls-remote --exit-code origin HEAD");
    const syncIdx = yaml.indexOf("infra/scripts/auto1-upstream-sync.mjs");
    assert.ok(setupIdx > 0 && probeIdx > setupIdx && syncIdx > probeIdx,
      "gh auth setup-git and ls-remote probe must precede AUTO-1 script");

    // Owner interactive OAuth / ad-hoc PAT must not be the routine identity.
    assert.doesNotMatch(yaml, /secrets\.(GH_PAT|GITHUB_PAT|OWNER_PAT|PERSONAL_ACCESS_TOKEN)\b/i);
    assert.match(yaml, /Owner OAuth and ad-hoc PATs are not the routine automation identity/);
    assert.match(yaml, /GH_CONFIG_DIR:\s*\$\{\{\s*runner\.temp\s*\}\}\/auto1-gh-config/);
  });
});
