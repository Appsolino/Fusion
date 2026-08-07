#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamRecoverStale 2026-08-07-04:45:
 * Recover real Appsolino stale state using the new rolling-candidate automation.
 * Does NOT merge obsolete #118. Fetches live upstream, runs AUTO-1 with supersede,
 * writes freshness report. Host P untouched; Host D trust quotas unused.
 *
 * Usage:
 *   node infra/scripts/upstream/recover-stale.mjs --repo-dir <path> --gh-repo Appsolino/Fusion [--push] [--create-pr] [--json]
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAuto1Sync } from "../auto1-upstream-sync.mjs";
import { evaluateFreshness, formatFreshnessReport, writeFreshnessStatus, FRESHNESS_STATUS_PATH } from "./freshness.mjs";
import { selectRollingCandidate, parseUpstreamShaFromBranch, planSupersedeObsolete } from "./rolling-candidate.mjs";
import { seedInitialProductPatches, loadPatchRegistry } from "./patch-registry.mjs";

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--push") out.push = true;
    else if (a === "--create-pr") out.createPr = true;
    else if (a === "--json") out.json = true;
    else if (a === "--seed-patches") out.seedPatches = true;
    else if (a.startsWith("--") && i + 1 < argv.length) out[a.slice(2)] = argv[++i];
  }
  return out;
}

function gh(args, env = process.env) {
  const r = spawnSync("gh", args, { encoding: "utf8", env });
  return { status: r.status ?? 1, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoDir = String(args["repo-dir"] || process.cwd());
  const ghRepo = String(args["gh-repo"] || process.env.GITHUB_REPOSITORY || "Appsolino/Fusion");
  const push = args.push === true;
  const createPr = args.createPr === true;

  if (args.seedPatches === true) {
    seedInitialProductPatches(repoDir);
  }

  const liveUp = gh(["api", "repos/Runfusion/Fusion/commits/main", "--jq", ".sha"]);
  if (liveUp.status !== 0) throw new Error(`fetch live upstream failed: ${liveUp.stderr}`);
  const liveUpstreamHead = liveUp.stdout.trim().toLowerCase();

  const openPrs = gh([
    "pr", "list", "--repo", ghRepo, "--state", "open", "--limit", "50",
    "--json", "number,headRefName,title",
  ]);
  const automation = openPrs.status === 0
    ? JSON.parse(openPrs.stdout || "[]").filter((p) => /^automation\/upstream-/i.test(p.headRefName || ""))
    : [];

  const before = selectRollingCandidate({
    upstreamHead: liveUpstreamHead,
    openAutomationPrs: automation.map((p) => ({
      number: p.number,
      headRefName: p.headRefName,
      candidateUpstreamSha: parseUpstreamShaFromBranch(p.headRefName),
    })),
  });

  const result = runAuto1Sync({
    repoDir,
    push,
    createPr,
    ghRepo,
    supersedeObsolete: true,
    allowMissingApp: process.env.ALLOW_MISSING_APP === "1",
  });

  const registry = loadPatchRegistry(repoDir);
  const report = {
    liveUpstreamHead,
    beforeSelection: {
      obsolete: before.obsoleteCandidates.map((p) => p.number),
      active: before.activeCandidate?.number || null,
      refreshRequired: before.refreshRequired,
    },
    auto1: {
      outcome: result.outcome,
      upstreamSha: result.upstreamSha,
      appsolinoSha: result.appsolinoSha,
      mergeBase: result.mergeBase,
      behind: result.behind,
      syncBranch: result.syncBranch,
      prUrl: result.prUrl,
      prNumber: result.prNumber,
      superseded: result.superseded,
      conflict: result.conflict,
      conflictedFiles: result.conflictedFiles,
    },
    freshness: result.freshness,
    patchesActive: registry.active.map((p) => p.id),
    hostP: "UNTOUCHED",
    hostDTrustQuotasConsumed: false,
    recordedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };

  mkdirSync(join(repoDir, ".appsolino"), { recursive: true });
  writeFileSync(join(repoDir, ".appsolino/recover-stale-result.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (result.freshness) {
    writeFreshnessStatus(join(repoDir, FRESHNESS_STATUS_PATH), result.freshness);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatFreshnessReport(result.freshness || evaluateFreshness({
      upstreamHead: liveUpstreamHead,
      integratedUpstreamSha: result.mergeBase,
      commitsBehindIntegrated: result.behind,
      candidateUpstreamSha: result.upstreamSha,
      activeCandidatePr: result.prNumber,
      auto1Outcome: result.outcome,
    })));
    process.stdout.write(`\nsupplemented: superseded=${JSON.stringify(result.superseded)} pr=${result.prUrl}\n`);
  }

  // conflict → exit 2; still behind after no-op → exit 2; success path for merged candidate → 0
  if (result.outcome === "conflict") process.exit(2);
  if (result.outcome === "no-change" && Number(result.behind || 0) === 0) process.exit(0);
  if (result.outcome === "merged") process.exit(0);
  process.exit(2);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
