#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamPatchReconcile 2026-08-07-05:55:
 * Live Finding Comparison driver. Constructs a clean upstream worktree (no Appsolino
 * patches applied), runs each ACTIVE patch's registered regression, gathers upstream
 * commit/path signals, classifies via reconcileAllPatches, and writes machine-generated
 * retirement proof artifacts. Never hand-writes retirement as success evidence.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileAllPatches } from "./patch-reconcile.mjs";
import { loadPatchRegistry } from "./patch-registry.mjs";

export const PROOF_DIR = ".appsolino/patches/proofs";

/**
 * @param {string} repoDir
 * @param {string[]} args
 * @param {{ allowFailure?: boolean, cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
function git(repoDir, args, opts = {}) {
  const result = spawnSync("git", ["-C", opts.cwd || repoDir, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (result.status !== 0 && !opts.allowFailure) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

/**
 * @param {string} cwd
 * @param {string} command
 * @param {{ timeoutMs?: number }} [opts]
 */
function runShell(cwd, command, opts = {}) {
  const result = spawnSync(command, {
    cwd,
    encoding: "utf8",
    shell: true,
    env: process.env,
    timeout: opts.timeoutMs ?? 600_000,
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    passed: (result.status ?? 1) === 0,
  };
}

/**
 * Ensure a disposable clean worktree at exact upstream SHA (Appsolino patches absent).
 * @param {{ repoDir: string, cleanUpstreamSha: string, worktreePath?: string }} input
 */
export function ensureCleanUpstreamWorktree(input) {
  const sha = String(input.cleanUpstreamSha).trim().toLowerCase();
  const wt =
    input.worktreePath ||
    join(input.repoDir, "..", `.appsolino-clean-upstream-${sha.slice(0, 12)}`);
  if (existsSync(wt)) {
    git(input.repoDir, ["worktree", "remove", "--force", wt], { allowFailure: true });
    rmSync(wt, { recursive: true, force: true });
  }
  // Prefer upstream remote tip; fall back to fetch object from origin if present.
  git(input.repoDir, ["fetch", "--no-tags", "upstream", sha], { allowFailure: true });
  git(input.repoDir, ["fetch", "--no-tags", "origin", sha], { allowFailure: true });
  const add = git(input.repoDir, ["worktree", "add", "--detach", wt, sha], { allowFailure: true });
  if (add.status !== 0) {
    throw new Error(`unable to create clean upstream worktree at ${sha}: ${add.stderr || add.stdout}`);
  }
  return { worktreePath: wt, cleanUpstreamSha: sha };
}

/**
 * Inspect commits on clean upstream that touch patch applyPaths; set fixesBehavior when
 * the patch's defect keywords or wiring markers appear in the commit message/diff.
 * @param {{ cleanWorktree: string, patch: object, cleanUpstreamSha: string }} input
 */
export function gatherSignalsFromCleanUpstream(input) {
  const paths = input.patch.localAction?.applyPaths || [];
  if (!paths.length) return [];
  const since = input.patch.introducedAgainst?.upstreamSha
    ? `${input.patch.introducedAgainst.upstreamSha}..${input.cleanUpstreamSha}`
    : input.cleanUpstreamSha;
  const log = git(input.cleanWorktree, [
    "log",
    "--format=%H%x09%s",
    since,
    "--",
    ...paths,
  ], { allowFailure: true, cwd: input.cleanWorktree });
  if (log.status !== 0 || !log.stdout) return [];

  const defectTokens = String(input.patch.defect?.description || "")
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 6)
    .slice(0, 12);

  /** @type {Array<object>} */
  const signals = [];
  for (const line of log.stdout.split("\n").filter(Boolean)) {
    const [sha, ...rest] = line.split("\t");
    const title = rest.join("\t");
    const show = git(input.cleanWorktree, ["show", "--name-only", "--format=", sha], {
      allowFailure: true,
      cwd: input.cleanWorktree,
    });
    const files = (show.stdout || "").split("\n").filter(Boolean);
    const diff = git(input.cleanWorktree, ["show", "--format=", "-U0", sha, "--", ...paths], {
      allowFailure: true,
      cwd: input.cleanWorktree,
    });
    const diffText = `${title}\n${diff.stdout || ""}`.toLowerCase();
    const wiringFix =
      diffText.includes("columnflagsbytaskid") ||
      diffText.includes("wire fixture task lane") ||
      defectTokens.some((t) => t.length >= 8 && diffText.includes(t));
    signals.push({
      kind: "commit",
      sha,
      title,
      files,
      fixesBehavior: wiringFix,
    });
  }
  return signals;
}

/**
 * Write machine-generated retirement / reconciliation proof for one patch result.
 * @param {string} repoRoot
 * @param {object} reconcileResult
 * @param {object} one
 * @param {{ upstreamBefore?: string|null }} [meta]
 */
export function writePatchReconcileProof(repoRoot, reconcileResult, one, meta = {}) {
  const dir = join(repoRoot, PROOF_DIR);
  mkdirSync(dir, { recursive: true });
  const proof = {
    schemaVersion: 1,
    generatedBy: "run-patch-reconcile-live.mjs",
    recordedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    upstreamBefore: meta.upstreamBefore || null,
    upstreamAfter: reconcileResult.cleanUpstreamSha,
    patch: one.patchId,
    cleanUpstreamRegression: {
      result: one.regressionPassed === true ? "PASS" : one.regressionPassed === false ? "FAIL" : "UNKNOWN",
    },
    semanticComparison: {
      classification: one.classification,
      evidence: one.comparison?.evidence || [],
      relatedCommit: one.comparison?.relatedCommit || null,
      equivalentBehavior: one.classification === "UPSTREAM_FIXED",
    },
    classification: one.classification,
    action: one.action === "RETIRE" ? "RETIRED" : one.action,
    status: one.status,
  };
  const path = join(
    dir,
    `${one.patchId.toLowerCase()}-${String(reconcileResult.cleanUpstreamSha).slice(0, 12)}.json`,
  );
  writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`);
  return { path, proof };
}

/**
 * @param {{
 *   repoDir: string,
 *   cleanUpstreamSha: string,
 *   persist?: boolean,
 *   cleanupWorktree?: boolean,
 *   upstreamBefore?: string|null,
 *   installDeps?: boolean,
 * }} input
 */
export async function runLivePatchReconcile(input) {
  const { worktreePath, cleanUpstreamSha } = ensureCleanUpstreamWorktree({
    repoDir: input.repoDir,
    cleanUpstreamSha: input.cleanUpstreamSha,
  });

  try {
    if (input.installDeps !== false) {
      const install = runShell(worktreePath, "pnpm install --frozen-lockfile", { timeoutMs: 900_000 });
      if (!install.passed) {
        // Soft fallback: try without frozen if upstream lock drifted relative to fetch tip.
        const retry = runShell(worktreePath, "pnpm install", { timeoutMs: 900_000 });
        if (!retry.passed) {
          throw new Error(`pnpm install failed in clean upstream worktree: ${retry.stderr || retry.stdout}`);
        }
      }
    }

    const result = await reconcileAllPatches({
      repoRoot: input.repoDir,
      cleanUpstreamSha,
      persist: input.persist !== false,
      runCleanRegression: async (patch) => {
        const commands = patch.regressionTests || [];
        /** @type {string[]} */
        const logs = [];
        for (const cmd of commands) {
          const r = runShell(worktreePath, cmd);
          logs.push(`$ ${cmd}\nexit=${r.status}\n${r.stdout}\n${r.stderr}`);
          if (!r.passed) return { passed: false, log: logs.join("\n---\n") };
        }
        return { passed: true, log: logs.join("\n---\n") };
      },
      gatherUpstreamSignals: async (patch) =>
        gatherSignalsFromCleanUpstream({
          cleanWorktree: worktreePath,
          patch,
          cleanUpstreamSha,
        }),
    });

    /** @type {Array<{path:string,proof:object}>} */
    const proofs = [];
    for (const one of result.results) {
      proofs.push(writePatchReconcileProof(input.repoDir, result, one, {
        upstreamBefore: input.upstreamBefore || null,
      }));
    }

    return { ...result, worktreePath, proofs };
  } finally {
    if (input.cleanupWorktree !== false) {
      git(input.repoDir, ["worktree", "remove", "--force", worktreePath], { allowFailure: true });
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }
}

function printHelp() {
  process.stdout.write(`Usage: run-patch-reconcile-live.mjs --repo-dir <path> --upstream-sha <sha> [--upstream-before <sha>] [--json]
`);
}

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--no-cleanup") out.noCleanup = true;
    else if (a === "--no-install") out.noInstall = true;
    else if (a === "--no-persist") out.noPersist = true;
    else if (a.startsWith("--") && i + 1 < argv.length) {
      out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const repoDir = String(args["repo-dir"] || process.cwd());
  const sha = String(args["upstream-sha"] || "");
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    printHelp();
    process.exit(2);
  }
  const result = await runLivePatchReconcile({
    repoDir,
    cleanUpstreamSha: sha,
    upstreamBefore: args["upstream-before"] ? String(args["upstream-before"]) : null,
    cleanupWorktree: args.noCleanup !== true,
    installDeps: args.noInstall !== true,
    persist: args.noPersist !== true,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `reconcile cleanUpstream=${result.cleanUpstreamSha} retired=${result.retired.join(",") || "none"} retained=${result.retained.join(",") || "none"} adapted=${result.adapted.join(",") || "none"}\n`,
    );
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack || err}\n`);
    process.exit(1);
  });
}
