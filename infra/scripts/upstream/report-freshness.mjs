#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamFreshnessReport 2026-08-07-04:40:
 * Concise observability report: upstream HEAD, integrated SHA, candidate, lag, state,
 * expert/verifier status, patches retained/retired. One artifact — not many Actions pages.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateFreshness, formatFreshnessReport, writeFreshnessStatus, FRESHNESS_STATUS_PATH } from "./freshness.mjs";
import { selectRollingCandidate, parseUpstreamShaFromBranch } from "./rolling-candidate.mjs";
import { loadPatchRegistry } from "./patch-registry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function gh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", env: process.env });
  return { status: r.status ?? 1, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

function git(args) {
  const r = spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY || "Appsolino/Fusion";
  const upstream = gh(["api", "repos/Runfusion/Fusion/commits/main", "--jq", ".sha"]);
  const appsolino = gh(["api", `repos/${repo}/commits/main`, "--jq", ".sha"]);
  const prs = gh([
    "pr", "list", "--repo", repo, "--state", "open", "--limit", "50",
    "--json", "number,headRefName,title,updatedAt",
  ]);

  const upstreamHead = upstream.status === 0 ? upstream.stdout.toLowerCase() : null;
  const appsolinoSha = appsolino.status === 0 ? appsolino.stdout.toLowerCase() : null;

  // Integrated = merge-base with upstream when remotes available; else status file / ledger.
  git(["remote", "get-url", "upstream"]);
  if (git(["remote"]).stdout.split("\n").includes("upstream") === false) {
    git(["remote", "add", "upstream", "https://github.com/Runfusion/Fusion.git"]);
  }
  git(["fetch", "--no-tags", "upstream", "main"]);
  git(["fetch", "--no-tags", "origin", "main"]);
  const mergeBase = git(["merge-base", "origin/main", "upstream/main"]);
  const behind = git(["rev-list", "--count", "origin/main..upstream/main"]);

  const open = prs.status === 0 ? JSON.parse(prs.stdout || "[]") : [];
  const automation = open.filter((p) => /^automation\/upstream-/i.test(p.headRefName || ""));
  const selection = selectRollingCandidate({
    upstreamHead: upstreamHead || "0".repeat(40),
    openAutomationPrs: automation.map((p) => ({
      number: p.number,
      headRefName: p.headRefName,
      candidateUpstreamSha: parseUpstreamShaFromBranch(p.headRefName),
    })),
  });

  const registry = existsSync(join(ROOT, ".appsolino/patches/registry.json"))
    ? loadPatchRegistry(ROOT)
    : { active: [], patches: [] };

  const status = evaluateFreshness({
    upstreamHead,
    integratedUpstreamSha: mergeBase.status === 0 ? mergeBase.stdout.toLowerCase() : null,
    candidateUpstreamSha: selection.activeCandidate?.candidateUpstreamSha || null,
    candidateAppsolinoSha: appsolinoSha,
    commitsBehindIntegrated: behind.status === 0 ? Number(behind.stdout) : null,
    activeCandidatePr: selection.activeCandidate?.number || null,
    auto2Action: selection.refreshRequired ? "refresh-required" : null,
  });

  const report = formatFreshnessReport({
    ...status,
    patchesRetained: registry.active.map((p) => p.id),
    patchesRetired: registry.patches.filter((p) => p.status === "RETIRED").map((p) => p.id),
    suitesPassed: [],
    hostDProof: "source-freshness-independent-of-host-d-trust-quotas",
  });

  const outDir = join(ROOT, ".appsolino");
  mkdirSync(outDir, { recursive: true });
  writeFreshnessStatus(join(ROOT, FRESHNESS_STATUS_PATH), status);
  writeFileSync(join(outDir, "upstream-freshness-report.md"), report);
  writeFileSync(
    join(outDir, "upstream-freshness-snapshot.json"),
    `${JSON.stringify({ status, selection, patches: { retained: registry.active.map((p) => p.id), retired: registry.patches.filter((p) => p.status === "RETIRED").map((p) => p.id) }, appsolinoSha }, null, 2)}\n`,
  );
  process.stdout.write(report);
  process.exit(status.overallHealthy ? 0 : 2);
}

main();
