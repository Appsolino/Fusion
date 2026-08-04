#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Git worktree helpers — advice-only. NEVER git push.
 * Upstream SHAs fetched into temporary refs/s1a-evidence/<id>/upstream.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CANONICAL_WORKTREE_ROOT,
  resolveAuthorizedWorktreeRoot,
  resolveWorktreePath,
} from "./policy.mjs";

const UPSTREAM_URL = "https://github.com/Runfusion/Fusion.git";

/**
 * @param {string[]} args
 * @param {{ cwd?: string }} [opts]
 */
function git(args, opts = {}) {
  const r = spawnSync("git", args, {
    cwd: opts.cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
      GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
      GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
      GIT_TERMINAL_PROMPT: "0",
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
 * @param {string|number} incidentId
 */
export function upstreamEvidenceRef(incidentId) {
  const id = String(incidentId || "unknown").replace(/[^0-9A-Za-z_-]/g, "") || "unknown";
  return `refs/s1a-evidence/${id}/upstream`;
}

/**
 * @param {string|number} incidentId
 */
export function upstreamRemoteName(incidentId) {
  const id = String(incidentId || "unknown").replace(/[^0-9A-Za-z_-]/g, "") || "unknown";
  return `s1a-upstream-${id}`;
}

/**
 * Snapshot worktree integrity before Cursor.
 * @param {string} worktreePath
 */
export function captureWorktreeIntegrity(worktreePath) {
  const head = git(["rev-parse", "HEAD"], { cwd: worktreePath });
  const porcelain = git(["status", "--porcelain"], { cwd: worktreePath });
  return { head, porcelain };
}

/**
 * Assert advice-only integrity after Cursor (tracked tree unchanged).
 * Removes known advisory untracked files first.
 * @param {{
 *   worktreePath: string,
 *   before: ReturnType<typeof captureWorktreeIntegrity>,
 * }} input
 */
export function assertWorktreeIntegrity(input) {
  const wt = input.worktreePath;
  for (const name of ["evidence-pack.json", ".s1a-advice-only"]) {
    const p = join(wt, name);
    if (existsSync(p)) {
      try {
        rmSync(p, { force: true });
      } catch {
        /* continue */
      }
    }
  }
  const head = git(["rev-parse", "HEAD"], { cwd: wt });
  if (head !== input.before.head) {
    throw new Error(
      `worktree HEAD mutated (${input.before.head} → ${head}); advice-only violation`,
    );
  }
  const diff = spawnSync("git", ["diff", "--quiet"], { cwd: wt, encoding: "utf8" });
  if (diff.status !== 0) {
    throw new Error("worktree has unstaged tracked mutations after Cursor");
  }
  const cached = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: wt,
    encoding: "utf8",
  });
  if (cached.status !== 0) {
    throw new Error("worktree has staged mutations after Cursor");
  }
  const branch = spawnSync("git", ["symbolic-ref", "-q", "HEAD"], {
    cwd: wt,
    encoding: "utf8",
  });
  if (branch.status === 0 && String(branch.stdout || "").includes("repair-")) {
    throw new Error("repair branch checked out in S1A worktree (forbidden)");
  }
  return { head, clean: true };
}

/**
 * Fetch Runfusion upstream SHA into namespaced ref (read-only object fetch).
 * Does not execute upstream code.
 * @param {{
 *   repoRoot: string,
 *   incidentId: string|number,
 *   upstreamSha: string,
 * }} input
 */
export function fetchUpstreamEvidenceRef(input) {
  const sha = String(input.upstreamSha || "").trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error(`invalid upstreamSha: ${sha}`);
  }
  const remote = upstreamRemoteName(input.incidentId);
  const ref = upstreamEvidenceRef(input.incidentId);
  // Best-effort remove stale remote/ref.
  try {
    git(["remote", "remove", remote], { cwd: input.repoRoot });
  } catch {
    /* absent */
  }
  try {
    git(["update-ref", "-d", ref], { cwd: input.repoRoot });
  } catch {
    /* absent */
  }
  git(["remote", "add", remote, UPSTREAM_URL], { cwd: input.repoRoot });
  git(["fetch", "--no-tags", "--depth=1", remote, sha], { cwd: input.repoRoot });
  git(["update-ref", ref, "FETCH_HEAD"], { cwd: input.repoRoot });
  const resolved = git(["rev-parse", ref], { cwd: input.repoRoot });
  return { remote, ref, sha: resolved };
}

/**
 * Remove temporary upstream remote + evidence ref. Fail closed on errors.
 * @param {{ repoRoot: string, incidentId: string|number }} input
 */
export function removeUpstreamEvidenceRef(input) {
  const remote = upstreamRemoteName(input.incidentId);
  const ref = upstreamEvidenceRef(input.incidentId);
  /** @type {string[]} */
  const errors = [];
  try {
    git(["update-ref", "-d", ref], { cwd: input.repoRoot });
  } catch (err) {
    // Missing ref is OK.
    if (!/unable to delete|exists|Not a valid|unknown revision/i.test(String(err.message))) {
      // If ref already gone, rev-parse fails later — check existence.
      const check = spawnSync("git", ["show-ref", "--verify", "--quiet", ref], {
        cwd: input.repoRoot,
      });
      if (check.status === 0) errors.push(String(err.message));
    }
  }
  try {
    git(["remote", "remove", remote], { cwd: input.repoRoot });
  } catch (err) {
    const remotes = spawnSync("git", ["remote"], {
      cwd: input.repoRoot,
      encoding: "utf8",
    });
    if ((remotes.stdout || "").split("\n").includes(remote)) {
      errors.push(String(err.message));
    }
  }
  if (errors.length) {
    throw new Error(`upstream evidence cleanup failed: ${errors.join("; ")}`);
  }
  return { removed: true, remote, ref };
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
    removeRepairWorktree({ path, repoRoot: input.repoRoot, failClosed: true });
  }

  const baseRef = input.baseRef || "HEAD";
  git(["worktree", "add", "--detach", path, baseRef], { cwd: input.repoRoot });

  // Marker outside git index tracking intent — removed before integrity check.
  writeFileSync(
    `${path}/.s1a-advice-only`,
    "S1A advice-only worktree. Do not git push. Do not open repair PRs.\n",
  );

  const before = captureWorktreeIntegrity(path);
  return { path, root, baseRef, pushed: false, before };
}

/**
 * @param {{ path: string, repoRoot: string, failClosed?: boolean }} input
 */
export function removeRepairWorktree(input) {
  if (!input.path) {
    if (input.failClosed) throw new Error("removeRepairWorktree: path required");
    return { removed: false };
  }
  try {
    git(["worktree", "remove", "--force", input.path], { cwd: input.repoRoot });
  } catch (err) {
    if (existsSync(input.path)) {
      rmSync(input.path, { recursive: true, force: true });
      try {
        git(["worktree", "prune"], { cwd: input.repoRoot });
      } catch (pruneErr) {
        if (input.failClosed) {
          throw new Error(
            `worktree remove/prune failed: ${err.message}; ${pruneErr.message}`,
          );
        }
      }
    } else if (input.failClosed) {
      // Path gone — still prune registrations.
      try {
        git(["worktree", "prune"], { cwd: input.repoRoot });
      } catch (pruneErr) {
        throw new Error(`worktree prune failed: ${pruneErr.message}`);
      }
    }
  }
  if (existsSync(input.path)) {
    throw new Error(`worktree path still present after cleanup: ${input.path}`);
  }
  const listing = git(["worktree", "list", "--porcelain"], { cwd: input.repoRoot });
  if (listing.includes(input.path)) {
    throw new Error(`worktree still registered after cleanup: ${input.path}`);
  }
  return { removed: true, path: input.path };
}

/**
 * Collect conflict file sides + short history (requires upstream object available).
 * @param {{
 *   worktreePath: string,
 *   files: string[],
 *   upstreamSha?: string|null,
 *   upstreamRef?: string|null,
 *   mainRef?: string,
 * }} input
 */
export function collectConflictEvidence(input) {
  const wt = input.worktreePath;
  const mainRef = input.mainRef || "HEAD";
  const upstream = input.upstreamRef || input.upstreamSha || null;
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
      pathLog = git(["log", "-n", "12", "--oneline", "--", ...input.files], {
        cwd: wt,
      });
    } catch {
      pathLog = null;
    }
  }

  return {
    conflictFileSides: sides,
    pathLog,
    upstreamSha: input.upstreamSha || null,
    upstreamRef: input.upstreamRef || null,
  };
}

/**
 * Digest of evidence fields suitable for writer artifact (no raw payloads).
 * @param {import("./evidence-pack.mjs").EvidencePack} pack
 */
export function evidenceDigestFromPack(pack) {
  const payload = {
    fingerprint: pack.fingerprint,
    failureClass: pack.failureClass,
    occurrence: pack.latestOccurrenceId,
    upstreamSha: pack.auto1?.upstreamSha || null,
    prUrl: pack.auto1?.prUrl || pack.relatedPr?.url || null,
    conflictedFiles: pack.auto1?.conflictedFiles || [],
    physical: pack.physical,
  };
  const sha256 = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return { sha256, ...payload };
}

export function assertNoRepairPushCommands(scriptText) {
  const s = String(scriptText || "");
  if (/\bgit\s+push\b/.test(s) && /repair-/.test(s)) {
    throw new Error("git push of repair worktree forbidden in S1A");
  }
  return true;
}

export { dirname, readFileSync };
