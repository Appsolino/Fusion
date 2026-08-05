#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-05:
 * Write-enabled repair worktree helpers.
 * Unlike S1A: mutations + named repair branch are required; primary checkout must stay untouched.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import {
  captureWorktreeIntegrity,
  removeRepairWorktree,
} from "../s1a/worktree.mjs";
import { WORKTREE_ROOT } from "./policy.mjs";

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
function git(args, opts = {}) {
  const r = spawnSync("git", ["-c", "safe.directory=*", ...args], {
    cwd: opts.cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
      GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
      GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
      GIT_TERMINAL_PROMPT: "0",
      ...(opts.env || {}),
    },
  });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").slice(0, 400)}`,
    );
  }
  return (r.stdout || "").trim();
}

/**
 * Snapshot primary checkout identity (must not change during S1B).
 * Tracked-tree only — untracked paths (e.g. nested temp dirs) are ignored.
 * @param {string} repoRoot
 */
export function capturePrimaryIntegrity(repoRoot) {
  const head = git(["rev-parse", "HEAD"], { cwd: repoRoot });
  const branch = spawnSync(
    "git",
    ["-c", "safe.directory=*", "symbolic-ref", "-q", "--short", "HEAD"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const diff = spawnSync(
    "git",
    ["-c", "safe.directory=*", "diff", "--name-only", "HEAD"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const cached = spawnSync(
    "git",
    ["-c", "safe.directory=*", "diff", "--cached", "--name-only"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return {
    head,
    branch: branch.status === 0 ? String(branch.stdout || "").trim() : "",
    trackedDiff: String(diff.stdout || "").trim(),
    stagedDiff: String(cached.stdout || "").trim(),
  };
}

/**
 * @param {{
 *   repoRoot: string,
 *   before: ReturnType<typeof capturePrimaryIntegrity>,
 * }} input
 */
export function assertPrimaryCheckoutUnchanged(input) {
  const after = capturePrimaryIntegrity(input.repoRoot);
  if (after.head !== input.before.head) {
    throw new Error(
      `S1B primary checkout HEAD mutated (${input.before.head} → ${after.head})`,
    );
  }
  if (after.branch !== input.before.branch) {
    throw new Error(
      `S1B primary checkout branch mutated (${input.before.branch} → ${after.branch})`,
    );
  }
  if (
    after.trackedDiff !== input.before.trackedDiff ||
    after.stagedDiff !== input.before.stagedDiff
  ) {
    throw new Error("S1B primary checkout working tree mutated");
  }
  return { ok: true, after };
}

/**
 * Create a named repair branch worktree (mutations allowed).
 * Does NOT write .s1a-advice-only; does NOT assert advice-only integrity after Cursor.
 * @param {{
 *   repoRoot: string,
 *   worktreePath: string,
 *   branchName: string,
 *   baseRef?: string,
 *   worktreeRoot?: string,
 * }} input
 */
export function createS1bRepairWorktree(input) {
  const repoRoot = input.repoRoot;
  if (!repoRoot) throw new Error("createS1bRepairWorktree: repoRoot required");
  const worktreePath = input.worktreePath;
  if (!worktreePath) throw new Error("createS1bRepairWorktree: worktreePath required");
  const branchName = input.branchName;
  if (!branchName || !String(branchName).startsWith("repair/steward-")) {
    throw new Error(
      `createS1bRepairWorktree: invalid branchName ${branchName}`,
    );
  }
  const root = input.worktreeRoot || WORKTREE_ROOT;
  if (!String(worktreePath).startsWith(root) && input.worktreeRoot == null) {
    // Allow explicit alternate roots in tests via worktreeRoot matching path prefix.
    // When callers pass a temp worktreePath under a temp root, set worktreeRoot.
  }

  const primaryBefore = capturePrimaryIntegrity(repoRoot);
  mkdirSync(dirname(worktreePath), { recursive: true });

  if (existsSync(worktreePath)) {
    removeRepairWorktree({ path: worktreePath, repoRoot, failClosed: true });
  }

  // Drop stale local branch if present (worktree was cleaned).
  const show = spawnSync(
    "git",
    ["-c", "safe.directory=*", "show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
    { cwd: repoRoot },
  );
  if (show.status === 0) {
    try {
      git(["branch", "-D", branchName], { cwd: repoRoot });
    } catch {
      /* continue — worktree add will fail clearly */
    }
  }

  const baseRef = input.baseRef || "HEAD";
  git(["worktree", "add", "-b", branchName, worktreePath, baseRef], {
    cwd: repoRoot,
  });

  const before = captureWorktreeIntegrity(worktreePath);
  assertPrimaryCheckoutUnchanged({ repoRoot, before: primaryBefore });

  return {
    path: worktreePath,
    branchName,
    baseRef,
    root,
    primaryBefore,
    before,
    adviceOnly: false,
    mutationsAllowed: true,
  };
}

/**
 * Commit staged repair changes in the worktree.
 * @param {{
 *   worktreePath: string,
 *   message: string,
 *   authorName?: string,
 *   authorEmail?: string,
 * }} input
 */
export function commitRepairChanges(input) {
  const wt = input.worktreePath;
  const status = git(["status", "--porcelain"], { cwd: wt });
  if (!status.trim()) {
    return { committed: false, head: git(["rev-parse", "HEAD"], { cwd: wt }) };
  }
  git(["add", "-A"], { cwd: wt });
  const env = {
    GIT_AUTHOR_NAME: input.authorName || "Appsolino Automation",
    GIT_AUTHOR_EMAIL: input.authorEmail || "automation@appsolino.local",
    GIT_COMMITTER_NAME: input.authorName || "Appsolino Automation",
    GIT_COMMITTER_EMAIL: input.authorEmail || "automation@appsolino.local",
  };
  const r = spawnSync(
    "git",
    ["-c", "safe.directory=*", "commit", "-m", input.message],
    { cwd: wt, encoding: "utf8", env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" } },
  );
  if (r.status !== 0) {
    throw new Error(
      `repair commit failed: ${(r.stderr || r.stdout || "").slice(0, 400)}`,
    );
  }
  return { committed: true, head: git(["rev-parse", "HEAD"], { cwd: wt }) };
}

export { captureWorktreeIntegrity, removeRepairWorktree, git, rmSync, existsSync };
