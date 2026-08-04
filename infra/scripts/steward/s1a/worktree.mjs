#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Git worktree helpers for advice-only investigation.
 * NEVER git push. Assert no new branch pushed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CANONICAL_WORKTREE_ROOT, resolveAuthorizedWorktreeRoot, resolveWorktreePath } from "./policy.mjs";

/**
 * @param {string[]} args
 * @param {{ cwd?: string }} [opts]
 */
function git(args, opts = {}) {
  const r = spawnSync("git", args, {
    cwd: opts.cwd,
    encoding: "utf8",
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").slice(0, 400)}`,
    );
  }
  return (r.stdout || "").trim();
}

/**
 * @param {{
 *   incidentId: string|number,
 *   repoRoot: string,
 *   mode?: string,
 *   worktreeRoot?: string|null,
 *   baseRef?: string,
 * }} input
 */
export function createRepairWorktree(input) {
  const mode = input.mode || "fixture";
  const root = resolveAuthorizedWorktreeRoot({
    mode,
    worktreeRoot: input.worktreeRoot,
  });
  if (mode === "live") {
    const explicit = input.worktreeRoot || process.env.S1A_WORKTREE_ROOT || "";
    if (!explicit && root !== CANONICAL_WORKTREE_ROOT) {
      throw new Error(
        `live worktree root not authorised: ${root} (set S1A_WORKTREE_ROOT)`,
      );
    }
  }
  mkdirSync(root, { recursive: true });
  const path = resolveWorktreePath(input.incidentId, {
    mode,
    worktreeRoot: root,
  });

  if (existsSync(path)) {
    try {
      removeRepairWorktree({ path, repoRoot: input.repoRoot });
    } catch {
      rmSync(path, { recursive: true, force: true });
    }
  }

  const baseRef = input.baseRef || "HEAD";
  // Detached worktree at trusted base — do NOT create/push a branch.
  git(["worktree", "add", "--detach", path, baseRef], { cwd: input.repoRoot });

  // Record that we must never push from this path.
  writeFileSync(
    `${path}/.s1a-advice-only`,
    "S1A advice-only worktree. Do not git push. Do not open repair PRs.\n",
  );

  return { path, root, baseRef, pushed: false };
}

/**
 * @param {{ path: string, repoRoot: string }} input
 */
export function removeRepairWorktree(input) {
  if (!input.path) return { removed: false };
  try {
    git(["worktree", "remove", "--force", input.path], { cwd: input.repoRoot });
  } catch {
    if (existsSync(input.path)) {
      rmSync(input.path, { recursive: true, force: true });
      try {
        git(["worktree", "prune"], { cwd: input.repoRoot });
      } catch {
        /* ignore */
      }
    }
  }
  return { removed: true, path: input.path };
}

/**
 * Collect conflict file sides + short history inside worktree (best-effort).
 * @param {{
 *   worktreePath: string,
 *   files: string[],
 *   upstreamSha?: string|null,
 *   mainRef?: string,
 * }} input
 */
export function collectConflictEvidence(input) {
  const wt = input.worktreePath;
  const mainRef = input.mainRef || "HEAD";
  const upstream = input.upstreamSha || null;
  /** @type {Record<string, { main?: string|null, upstream?: string|null, log?: string|null }>} */
  const sides = {};
  /** @type {string|null} */
  let pathLog = null;

  for (const file of input.files || []) {
    /** @type {{ main?: string|null, upstream?: string|null, log?: string|null }} */
    const entry = { main: null, upstream: null, log: null };
    try {
      entry.main = git(["show", `${mainRef}:${file}`], { cwd: wt }).slice(0, 8000);
    } catch {
      entry.main = null;
    }
    if (upstream) {
      try {
        entry.upstream = git(["show", `${upstream}:${file}`], { cwd: wt }).slice(0, 8000);
      } catch {
        entry.upstream = null;
      }
    }
    try {
      entry.log = git(["log", "-n", "5", "--oneline", "--", file], { cwd: wt });
    } catch {
      entry.log = null;
    }
    sides[file] = entry;
  }

  if ((input.files || []).length) {
    try {
      pathLog = git(
        ["log", "-n", "12", "--oneline", "--", ...input.files],
        { cwd: wt },
      );
    } catch {
      pathLog = null;
    }
  }

  return { conflictFileSides: sides, pathLog, upstreamSha: upstream };
}

/**
 * Assert S1A never pushed a repair branch (static + optional remote check skip).
 */
export function assertNoRepairPushCommands(scriptText) {
  const s = String(scriptText || "");
  if (/\bgit\s+push\b/.test(s) && /repair-/.test(s)) {
    throw new Error("git push of repair worktree forbidden in S1A");
  }
  return true;
}

export { dirname };
