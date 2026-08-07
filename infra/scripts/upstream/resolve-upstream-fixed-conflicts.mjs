#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamPatchReconcile 2026-08-07-06:20:
 * When AUTO-1 merge conflicts on paths owned by ACTIVE product patches, run Finding
 * Comparison against clean upstream. If every conflicted path is covered by a patch
 * classified UPSTREAM_FIXED / NOT_REPRODUCIBLE / RESOLVED with regression PASS, take
 * upstream (--theirs) for those paths and complete the merge — then leave retirement
 * persistence to reconcileAllPatches. This is the real V1→V1.1 acceptance path
 * (FIX-LANE-WIRING-TOUCH-FIXTURE vs FN-8806) without handwritten absorb.
 */
import { spawnSync } from "node:child_process";
import { loadPatchRegistry } from "./patch-registry.mjs";

/**
 * Pure decision: can we safely take upstream for all conflicted files?
 * @param {{
 *   conflictedFiles: string[],
 *   patches: Array<{ id: string, status?: string, localAction?: { applyPaths?: string[] } }>,
 *   reconcileResults: Array<{ patchId: string, action: string, classification?: string|null, regressionPassed?: boolean }>,
 * }} input
 */
export function decideUpstreamFixedConflictResolution(input) {
  const conflicted = [...new Set((input.conflictedFiles || []).map((f) => f.replace(/\\/g, "/")))];
  if (!conflicted.length) {
    return { ok: false, action: "NO_CONFLICT", reason: "no conflicted files", takeUpstreamFiles: [], retiredPatchIds: [] };
  }

  const retiredOrFixed = new Set(
    (input.reconcileResults || [])
      .filter((r) => {
        const cls = String(r.classification || "").toUpperCase();
        const retired = r.action === "RETIRE";
        const fixedCls = cls === "UPSTREAM_FIXED" || cls === "NOT_REPRODUCIBLE" || cls === "RESOLVED";
        return retired && fixedCls && r.regressionPassed === true;
      })
      .map((r) => String(r.patchId).toUpperCase()),
  );

  const active = (input.patches || []).filter((p) => String(p.status || "").toUpperCase() === "ACTIVE");
  /** @type {string[]} */
  const uncovered = [];
  /** @type {string[]} */
  const coveringPatches = [];

  for (const file of conflicted) {
    const covers = active.filter((p) =>
      (p.localAction?.applyPaths || []).some((ap) => {
        const n = String(ap).replace(/\\/g, "/");
        return file === n || file.endsWith(`/${n}`) || n.endsWith(`/${file}`) || file.includes(n) || n.includes(file);
      }),
    );
    if (!covers.length) {
      uncovered.push(file);
      continue;
    }
    const proven = covers.filter((p) => retiredOrFixed.has(String(p.id).toUpperCase()));
    if (!proven.length) {
      uncovered.push(file);
      continue;
    }
    for (const p of proven) coveringPatches.push(String(p.id).toUpperCase());
  }

  if (uncovered.length) {
    return {
      ok: false,
      action: "LEAVE_CONFLICT",
      reason: `conflicted paths not proven UPSTREAM_FIXED on clean upstream: ${uncovered.join(", ")}`,
      takeUpstreamFiles: [],
      retiredPatchIds: [...new Set(coveringPatches)],
      uncoveredFiles: uncovered,
    };
  }

  return {
    ok: true,
    action: "TAKE_UPSTREAM",
    reason: "all conflicted paths covered by patches retired via Finding Comparison on clean upstream",
    takeUpstreamFiles: conflicted,
    retiredPatchIds: [...new Set(coveringPatches)],
    uncoveredFiles: [],
  };
}

/**
 * @param {string} repoDir
 * @param {string[]} args
 * @param {{ allowFailure?: boolean }} [opts]
 */
function git(repoDir, args, opts = {}) {
  const r = spawnSync("git", ["-C", repoDir, ...args], { encoding: "utf8" });
  if ((r.status ?? 1) !== 0 && !opts.allowFailure) {
    throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`);
  }
  return { status: r.status ?? 1, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

/**
 * Apply TAKE_UPSTREAM decision while a merge is in progress.
 * @param {{ repoDir: string, decision: ReturnType<typeof decideUpstreamFixedConflictResolution> }} input
 */
export function applyTakeUpstreamConflictResolution(input) {
  if (!input.decision?.ok || input.decision.action !== "TAKE_UPSTREAM") {
    return { applied: false, reason: input.decision?.reason || "not take-upstream" };
  }
  for (const file of input.decision.takeUpstreamFiles) {
    // During merge, --theirs is the upstream side being merged in.
    git(input.repoDir, ["checkout", "--theirs", "--", file]);
    git(input.repoDir, ["add", "--", file]);
  }
  // Persist any registry retirement writes produced during Finding Comparison.
  git(input.repoDir, ["add", "--", ".appsolino/patches"], { allowFailure: true });
  const remaining = git(input.repoDir, ["diff", "--name-only", "--diff-filter=U"], { allowFailure: true })
    .stdout.split("\n")
    .filter(Boolean);
  if (remaining.length) {
    return {
      applied: false,
      reason: `unmerged paths remain after take-upstream: ${remaining.join(", ")}`,
      remaining,
    };
  }
  const cont = git(input.repoDir, ["-c", "core.editor=true", "merge", "--continue"], { allowFailure: true });
  if (cont.status !== 0) {
    // Fallback: create merge commit explicitly when merge --continue is unavailable.
    const commit = git(
      input.repoDir,
      [
        "commit",
        "--no-edit",
        "-m",
        "chore(auto1): complete merge taking upstream for UPSTREAM_FIXED patch paths",
      ],
      { allowFailure: true },
    );
    if (commit.status !== 0) {
      return {
        applied: false,
        reason: `unable to complete merge after take-upstream: ${cont.stderr || cont.stdout || commit.stderr}`,
        remaining: [],
      };
    }
  }
  return { applied: true, reason: input.decision.reason, files: input.decision.takeUpstreamFiles };
}

/**
 * Run live Finding Comparison and optionally resolve an in-progress merge conflict.
 * @param {{
 *   repoDir: string,
 *   cleanUpstreamSha: string,
 *   conflictedFiles: string[],
 *   upstreamBefore?: string|null,
 *   runReconcileFn?: (args: object) => Promise<object>,
 * }} input
 */
export async function tryResolveMergeConflictViaPatchRegistry(input) {
  const registry = loadPatchRegistry(input.repoDir);
  const runReconcile =
    input.runReconcileFn ||
    (async (args) => {
      const { runLivePatchReconcile } = await import("./run-patch-reconcile-live.mjs");
      return runLivePatchReconcile(args);
    });

  const reconcile = await runReconcile({
    repoDir: input.repoDir,
    cleanUpstreamSha: input.cleanUpstreamSha,
    upstreamBefore: input.upstreamBefore || null,
    persist: true,
    cleanupWorktree: true,
    installDeps: true,
  });

  const decision = decideUpstreamFixedConflictResolution({
    conflictedFiles: input.conflictedFiles,
    patches: registry.active,
    reconcileResults: reconcile.results || [],
  });

  if (!decision.ok) {
    return {
      resolved: false,
      decision,
      reconcile,
      apply: null,
    };
  }

  const apply = applyTakeUpstreamConflictResolution({
    repoDir: input.repoDir,
    decision,
  });

  return {
    resolved: apply.applied === true,
    decision,
    reconcile,
    apply,
  };
}

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a.startsWith("--") && i + 1 < argv.length) out[a.slice(2)] = argv[++i];
  }
  return out;
}

async function mainCli() {
  const args = parseArgs(process.argv.slice(2));
  const repoDir = String(args["repo-dir"] || process.cwd());
  const sha = String(args["upstream-sha"] || "");
  const conflicted = String(args["conflicted-files"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!/^[0-9a-f]{7,40}$/i.test(sha) || !conflicted.length) {
    process.stderr.write("Usage: resolve-upstream-fixed-conflicts.mjs --repo-dir <path> --upstream-sha <sha> --conflicted-files a,b [--upstream-before <sha>] [--json]\n");
    process.exit(2);
  }
  const result = await tryResolveMergeConflictViaPatchRegistry({
    repoDir,
    cleanUpstreamSha: sha,
    conflictedFiles: conflicted,
    upstreamBefore: args["upstream-before"] ? String(args["upstream-before"]) : null,
  });
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.resolved ? 0 : 3);
}

import { fileURLToPath } from "node:url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  mainCli().catch((err) => {
    process.stderr.write(`${err?.stack || err}\n`);
    process.exit(1);
  });
}
