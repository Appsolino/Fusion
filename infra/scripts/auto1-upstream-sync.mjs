#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto1 2026-07-31-12:40:
 * AUTO-1 upstream integration core. Fetches Runfusion/Fusion:main, creates or refreshes
 * one automation/upstream-<shortsha> branch from the Appsolino integration tip via
 * merge --no-ff, and never force-pushes or updates Appsolino main. Host D deploy and
 * auto-merge belong to AUTO-2/AUTO-3 — this module never deploys.
 *
 * ISS-GIT-007: resolve the repository default/integration branch via origin/HEAD
 * (with explicit override) instead of assuming `main`.
 *
 * FNXC:UpstreamRollingCandidate 2026-08-07-04:15:
 * After opening/updating the rolling candidate for live upstream HEAD, supersede
 * obsolete automation/upstream-* PRs. Creating a PR is not FRESH — write freshness status.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateFreshness,
  writeFreshnessStatus,
  FRESHNESS_STATUS_PATH,
  formatFreshnessReport,
} from "./upstream/freshness.mjs";
import {
  selectRollingCandidate,
  planSupersedeObsolete,
  parseUpstreamShaFromBranch,
} from "./upstream/rolling-candidate.mjs";

export const UPSTREAM_URL_DEFAULT = "https://github.com/Runfusion/Fusion.git";
export const UPSTREAM_REF_DEFAULT = "main";
export const STATUS_PATH = ".appsolino/upstream-sync-status.json";

/**
 * @param {string} repoDir
 * @param {string[]} args
 * @param {{ allowFailure?: boolean, env?: NodeJS.ProcessEnv }} [opts]
 */
export function git(repoDir, args, opts = {}) {
  const result = spawnSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  if (result.status !== 0 && !opts.allowFailure) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`git ${args.join(" ")} failed (${result.status}): ${detail}`);
  }
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

/**
 * FNXC:AppsolinoAuto1 2026-07-31-12:40:
 * ISS-GIT-007 — prefer origin/HEAD, then explicit override, then fallback `main`.
 * @param {string} repoDir
 * @param {{ integrationBranch?: string, remote?: string }} [opts]
 */
export function resolveIntegrationBranch(repoDir, opts = {}) {
  const override = opts.integrationBranch?.trim();
  if (override) return override;
  const remote = opts.remote ?? "origin";
  const head = git(repoDir, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], {
    allowFailure: true,
  });
  if (head.status === 0 && head.stdout) {
    const prefix = `${remote}/`;
    return head.stdout.startsWith(prefix) ? head.stdout.slice(prefix.length) : head.stdout;
  }
  return "main";
}

/** @param {string} sha */
export function syncBranchNameForUpstream(sha) {
  const short = sha.slice(0, 12);
  return `automation/upstream-${short}`;
}

/**
 * @param {string} repoDir
 * @param {{ appsolinoRef: string, upstreamRef: string }} refs
 */
export function detectDelta(repoDir, refs) {
  const appsolinoSha = git(repoDir, ["rev-parse", refs.appsolinoRef]).stdout;
  const upstreamSha = git(repoDir, ["rev-parse", refs.upstreamRef]).stdout;
  const mergeBase = git(repoDir, ["merge-base", refs.appsolinoRef, refs.upstreamRef]).stdout;
  const ahead = Number(git(repoDir, ["rev-list", "--count", `${refs.upstreamRef}..${refs.appsolinoRef}`]).stdout);
  const behind = Number(git(repoDir, ["rev-list", "--count", `${refs.appsolinoRef}..${refs.upstreamRef}`]).stdout);
  const changedFiles = behind === 0
    ? []
    : git(repoDir, ["diff", "--name-only", `${mergeBase}...${refs.upstreamRef}`]).stdout
      .split("\n")
      .filter(Boolean);
  return {
    appsolinoSha,
    upstreamSha,
    mergeBase,
    ahead,
    behind,
    changedFiles,
    touchesWorkflows: changedFiles.some((f) => f.startsWith(".github/workflows/")),
    touchesMigrations: changedFiles.some((f) => f.includes("migrations/") || /\/migrations\//.test(f)),
    touchesLockfile: changedFiles.some((f) => /(^|\/)pnpm-lock\.yaml$|(^|\/)package-lock\.json$/.test(f)),
  };
}

/**
 * @param {object} input
 * @param {string} input.repoDir
 * @param {string} [input.upstreamUrl]
 * @param {string} [input.upstreamRef]
 * @param {string} [input.originRemote]
 * @param {string} [input.integrationBranch]
 * @param {boolean} [input.push]
 * @param {boolean} [input.createPr]
 * @param {string} [input.ghRepo]
 * @param {(args: string[]) => { status: number, stdout: string, stderr: string }} [input.gh]
 * @param {boolean} [input.allowMissingApp]
 */
export function runAuto1Sync(input) {
  const repoDir = input.repoDir;
  const upstreamUrl = input.upstreamUrl ?? UPSTREAM_URL_DEFAULT;
  const upstreamRefName = input.upstreamRef ?? UPSTREAM_REF_DEFAULT;
  const originRemote = input.originRemote ?? "origin";
  const push = input.push === true;
  const createPr = input.createPr === true;

  // Never mutate Appsolino main / integration tip in place — work only on automation/* branches.
  const integrationBranch = resolveIntegrationBranch(repoDir, {
    integrationBranch: input.integrationBranch,
    remote: originRemote,
  });
  const appsolinoRef = `${originRemote}/${integrationBranch}`;

  const remotes = git(repoDir, ["remote"]).stdout.split("\n").filter(Boolean);
  if (!remotes.includes("upstream")) {
    git(repoDir, ["remote", "add", "upstream", upstreamUrl]);
  } else {
    git(repoDir, ["remote", "set-url", "upstream", upstreamUrl]);
  }

  git(repoDir, ["fetch", "--no-tags", originRemote, integrationBranch]);
  git(repoDir, ["fetch", "--no-tags", "upstream", upstreamRefName]);

  const upstreamRemoteRef = `upstream/${upstreamRefName}`;
  const delta = detectDelta(repoDir, { appsolinoRef, upstreamRef: upstreamRemoteRef });

  if (delta.behind === 0) {
    const freshness = evaluateFreshness({
      upstreamHead: delta.upstreamSha,
      integratedUpstreamSha: delta.upstreamSha,
      candidateUpstreamSha: null,
      candidateAppsolinoSha: delta.appsolinoSha,
      commitsBehindIntegrated: 0,
      commitsBehindCandidate: 0,
      auto1Outcome: "no-change",
    });
    try {
      writeFreshnessStatus(join(repoDir, FRESHNESS_STATUS_PATH), freshness);
    } catch {
      /* non-fatal */
    }
    return {
      outcome: "no-change",
      integrationBranch,
      ...delta,
      syncBranch: null,
      conflict: false,
      conflictedFiles: [],
      prUrl: null,
      prNumber: null,
      superseded: [],
      freshness,
      freshnessReport: formatFreshnessReport(freshness),
      mutatedMain: false,
      deployedHostD: false,
    };
  }

  const syncBranch = syncBranchNameForUpstream(delta.upstreamSha);
  // Reset sync branch to Appsolino integration tip (idempotent refresh for the same upstream SHA).
  git(repoDir, ["checkout", "-B", syncBranch, appsolinoRef]);

  const mergeMsg = `chore(auto1): merge upstream ${upstreamRefName} ${delta.upstreamSha.slice(0, 12)}

Appsolino ${integrationBranch}: ${delta.appsolinoSha}
Upstream ${upstreamRefName}: ${delta.upstreamSha}
Merge-base: ${delta.mergeBase}
`;
  const merge = git(
    repoDir,
    ["merge", "--no-ff", "--no-edit", "-m", mergeMsg, upstreamRemoteRef],
    { allowFailure: true },
  );

  let conflict = false;
  /** @type {string[]} */
  let conflictedFiles = [];
  if (merge.status !== 0) {
    conflict = true;
    conflictedFiles = git(repoDir, ["diff", "--name-only", "--diff-filter=U"], { allowFailure: true })
      .stdout.split("\n")
      .filter(Boolean);
    git(repoDir, ["merge", "--abort"], { allowFailure: true });
    mkdirSync(join(repoDir, dirname(STATUS_PATH)), { recursive: true });
    const status = {
      outcome: "conflict",
      recordedAt: new Date().toISOString(),
      integrationBranch,
      appsolinoSha: delta.appsolinoSha,
      upstreamSha: delta.upstreamSha,
      mergeBase: delta.mergeBase,
      ahead: delta.ahead,
      behind: delta.behind,
      conflictedFiles,
      touchesWorkflows: delta.touchesWorkflows,
      touchesMigrations: delta.touchesMigrations,
      touchesLockfile: delta.touchesLockfile,
    };
    writeFileSync(join(repoDir, STATUS_PATH), `${JSON.stringify(status, null, 2)}\n`);
    git(repoDir, ["add", STATUS_PATH]);
    git(repoDir, [
      "commit",
      "-m",
      `chore(auto1): record upstream merge conflict for ${delta.upstreamSha.slice(0, 12)}`,
    ]);
  } else {
    mkdirSync(join(repoDir, dirname(STATUS_PATH)), { recursive: true });
    const status = {
      outcome: "merged",
      recordedAt: new Date().toISOString(),
      integrationBranch,
      appsolinoSha: delta.appsolinoSha,
      upstreamSha: delta.upstreamSha,
      mergeBase: delta.mergeBase,
      ahead: delta.ahead,
      behind: delta.behind,
      conflictedFiles: [],
      touchesWorkflows: delta.touchesWorkflows,
      touchesMigrations: delta.touchesMigrations,
      touchesLockfile: delta.touchesLockfile,
      changedFileCount: delta.changedFiles.length,
    };
    writeFileSync(join(repoDir, STATUS_PATH), `${JSON.stringify(status, null, 2)}\n`);
    git(repoDir, ["add", STATUS_PATH]);
    // May be empty if status identical — allow empty skip
    const staged = git(repoDir, ["diff", "--cached", "--name-only"], { allowFailure: true }).stdout;
    if (staged) {
      git(repoDir, ["commit", "-m", `chore(auto1): record upstream sync status for ${delta.upstreamSha.slice(0, 12)}`]);
    }
  }

  if (push) {
    git(repoDir, ["push", "--force-with-lease", originRemote, `HEAD:refs/heads/${syncBranch}`]);
  }

  let prUrl = null;
  /** @type {number|null} */
  let prNumber = null;
  /** @type {Array<{prNumber:number,type:string}>} */
  let superseded = [];
  /** @type {ReturnType<typeof evaluateFreshness>|null} */
  let freshness = null;

  if (createPr) {
    if (!input.allowMissingApp && !process.env.AUTO1_GITHUB_APP_TOKEN && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
      throw new Error(
        "AUTO-1 fail-closed: GitHub App token unavailable (set AUTO1_GITHUB_APP_TOKEN from Appsolino Automation GitHub App). Owner OAuth/ad-hoc PAT is not the routine identity.",
      );
    }
    const gh = input.gh ?? ((args) => {
      const env = {
        ...process.env,
        GH_TOKEN: process.env.AUTO1_GITHUB_APP_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "",
        // Do not inherit interactive owner GH_CONFIG_DIR for routine automation.
        GH_CONFIG_DIR: process.env.AUTO1_GH_CONFIG_DIR || process.env.GH_CONFIG_DIR,
      };
      const result = spawnSync("gh", args, { encoding: "utf8", env });
      return {
        status: result.status ?? 1,
        stdout: (result.stdout ?? "").trim(),
        stderr: (result.stderr ?? "").trim(),
      };
    });
    const repo = input.ghRepo ?? process.env.GITHUB_REPOSITORY;
    if (!repo) throw new Error("AUTO-1 createPr requires ghRepo or GITHUB_REPOSITORY");
    const title = conflict
      ? `AUTO-1 CONFLICT: upstream ${delta.upstreamSha.slice(0, 12)}`
      : `AUTO-1: absorb upstream ${delta.upstreamSha.slice(0, 12)}`;
    const body = buildPrBody({
      integrationBranch,
      delta,
      syncBranch,
      conflict,
      conflictedFiles,
    });
    const existing = gh([
      "pr", "list",
      "--repo", repo,
      "--head", syncBranch,
      "--state", "open",
      "--json", "number,url",
    ]);
    if (existing.status !== 0) {
      throw new Error(`gh pr list failed: ${existing.stderr || existing.stdout}`);
    }
    const openPrs = JSON.parse(existing.stdout || "[]");
    if (Array.isArray(openPrs) && openPrs.length > 0) {
      const number = String(openPrs[0].number);
      const edited = gh(["pr", "edit", number, "--repo", repo, "--title", title, "--body", body]);
      if (edited.status !== 0) throw new Error(`gh pr edit failed: ${edited.stderr || edited.stdout}`);
      prUrl = openPrs[0].url;
      prNumber = Number(openPrs[0].number);
    } else {
      const created = gh([
        "pr", "create",
        "--repo", repo,
        "--base", integrationBranch,
        "--head", syncBranch,
        "--title", title,
        "--body", body,
      ]);
      if (created.status !== 0) throw new Error(`gh pr create failed: ${created.stderr || created.stdout}`);
      prUrl = created.stdout;
      const m = String(prUrl).match(/\/pull\/(\d+)/);
      prNumber = m ? Number(m[1]) : null;
    }

    /*
    FNXC:UpstreamRollingCandidate 2026-08-07-04:15:
    Close obsolete automation/upstream-* PRs whose embedded SHA != live upstream HEAD.
    Never merge them as current.
    */
    if (input.supersedeObsolete !== false) {
      const listed = gh([
        "pr", "list",
        "--repo", repo,
        "--state", "open",
        "--limit", "50",
        "--json", "number,headRefName,url",
      ]);
      if (listed.status === 0) {
        const allOpen = JSON.parse(listed.stdout || "[]");
        const automation = (Array.isArray(allOpen) ? allOpen : []).filter((p) =>
          /^automation\/upstream-/i.test(String(p.headRefName || "")),
        );
        const selection = selectRollingCandidate({
          upstreamHead: delta.upstreamSha,
          openAutomationPrs: automation.map((p) => ({
            number: Number(p.number),
            headRefName: String(p.headRefName),
            candidateUpstreamSha: parseUpstreamShaFromBranch(p.headRefName),
          })),
        });
        const plan = planSupersedeObsolete(selection, {
          newPrNumber: prNumber,
          newUpstreamSha: delta.upstreamSha,
          dryRun: input.dryRunSupersede === true,
        });
        for (const action of plan.actions) {
          if (action.prNumber === prNumber) continue;
          if (input.dryRunSupersede === true) {
            superseded.push({ prNumber: action.prNumber, type: "supersede-close-dry-run" });
            continue;
          }
          const commented = gh([
            "pr", "comment", String(action.prNumber),
            "--repo", repo,
            "--body", action.comment,
          ]);
          if (commented.status !== 0) {
            throw new Error(`gh pr comment failed for #${action.prNumber}: ${commented.stderr || commented.stdout}`);
          }
          const closed = gh([
            "pr", "close", String(action.prNumber),
            "--repo", repo,
            "--comment", "Superseded by rolling upstream candidate for live Runfusion HEAD.",
          ]);
          if (closed.status !== 0) {
            throw new Error(`gh pr close failed for #${action.prNumber}: ${closed.stderr || closed.stdout}`);
          }
          superseded.push({ prNumber: action.prNumber, type: "supersede-close" });
        }
      }
    }
  }

  // Integrated SHA is the merge-base with upstream until a successful absorption lands.
  freshness = evaluateFreshness({
    upstreamHead: delta.upstreamSha,
    integratedUpstreamSha: delta.mergeBase,
    candidateUpstreamSha: delta.upstreamSha,
    candidateAppsolinoSha: delta.appsolinoSha,
    commitsBehindIntegrated: delta.behind,
    commitsBehindCandidate: 0,
    activeCandidatePr: prNumber,
    auto1Outcome: conflict ? "conflict" : delta.behind === 0 ? "no-change" : "merged",
  });
  try {
    writeFreshnessStatus(join(repoDir, FRESHNESS_STATUS_PATH), freshness);
    // Keep status on the sync branch when we already have local commits.
    if (syncBranch && (push || createPr)) {
      git(repoDir, ["add", FRESHNESS_STATUS_PATH], { allowFailure: true });
      const staged = git(repoDir, ["diff", "--cached", "--name-only"], { allowFailure: true }).stdout;
      if (staged.includes(FRESHNESS_STATUS_PATH)) {
        git(repoDir, [
          "commit",
          "-m",
          `chore(auto1): record upstream freshness ${freshness.state} for ${delta.upstreamSha.slice(0, 12)}`,
        ], { allowFailure: true });
        if (push) {
          git(repoDir, ["push", "--force-with-lease", originRemote, `HEAD:refs/heads/${syncBranch}`], {
            allowFailure: true,
          });
        }
      }
    }
  } catch {
    // Freshness write must not mask merge outcome; surface via return payload.
  }

  return {
    outcome: conflict ? "conflict" : "merged",
    integrationBranch,
    ...delta,
    syncBranch,
    conflict,
    conflictedFiles,
    prUrl,
    prNumber,
    superseded,
    freshness,
    freshnessReport: freshness ? formatFreshnessReport(freshness) : null,
    mutatedMain: false,
    deployedHostD: false,
  };
}

/**
 * @param {{ integrationBranch: string, delta: ReturnType<typeof detectDelta>, syncBranch: string, conflict: boolean, conflictedFiles: string[] }} p
 */
export function buildPrBody(p) {
  const { delta, syncBranch, conflict, conflictedFiles, integrationBranch } = p;
  const sample = delta.changedFiles.slice(0, 40).map((f) => `- \`${f}\``).join("\n") || "_none_";
  return `## AUTO-1 upstream sync

| Field | Value |
| --- | --- |
| Appsolino integration branch | \`${integrationBranch}\` |
| Previous Appsolino SHA | \`${delta.appsolinoSha}\` |
| Upstream SHA | \`${delta.upstreamSha}\` |
| Merge-base | \`${delta.mergeBase}\` |
| Appsolino ahead | ${delta.ahead} |
| Appsolino behind | ${delta.behind} |
| Sync branch | \`${syncBranch}\` |
| Conflict | ${conflict ? "YES" : "NO"} |
| Workflow changes | ${delta.touchesWorkflows ? "YES" : "NO"} |
| Migration changes | ${delta.touchesMigrations ? "YES" : "NO"} |
| Lockfile changes | ${delta.touchesLockfile ? "YES" : "NO"} |
| Host D deploy (AUTO-1) | NO |
| Mutates Appsolino main | NO |

### Conflicted files
${conflict ? (conflictedFiles.map((f) => `- \`${f}\``).join("\n") || "_unlisted_") : "_none_"}

### Changed files (upstream vs merge-base, capped)
${sample}

---
AUTO-1 only prepares the sync PR. Build/deploy/auto-merge are AUTO-2/AUTO-3.
`;
}

function printHelp() {
  process.stdout.write(`Usage: auto1-upstream-sync.mjs --repo-dir <path> [options]

Options:
  --upstream-url <url>     Default ${UPSTREAM_URL_DEFAULT}
  --upstream-ref <ref>     Default ${UPSTREAM_REF_DEFAULT}
  --integration-branch <b> Override default-branch resolution (ISS-GIT-007)
  --push                   Push sync branch with --force-with-lease
  --create-pr              Open/update GitHub PR (requires App token)
  --gh-repo <owner/name>   GitHub repository for PRs
  --allow-missing-app      Test-only: allow --create-pr without App token
  --json                   Print result JSON
`);
}

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--push") out.push = true;
    else if (a === "--create-pr") out.createPr = true;
    else if (a === "--json") out.json = true;
    else if (a === "--allow-missing-app") out.allowMissingApp = true;
    else if (a.startsWith("--") && i + 1 < argv.length) {
      out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args["repo-dir"]) {
    printHelp();
    process.exit(args.help ? 0 : 2);
  }
  try {
    const result = runAuto1Sync({
      repoDir: String(args["repo-dir"]),
      upstreamUrl: args["upstream-url"] ? String(args["upstream-url"]) : undefined,
      upstreamRef: args["upstream-ref"] ? String(args["upstream-ref"]) : undefined,
      integrationBranch: args["integration-branch"] ? String(args["integration-branch"]) : undefined,
      push: args.push === true,
      createPr: args.createPr === true,
      ghRepo: args["gh-repo"] ? String(args["gh-repo"]) : undefined,
      allowMissingApp: args.allowMissingApp === true,
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${result.outcome} syncBranch=${result.syncBranch ?? "-"} conflict=${result.conflict}\n`);
    }
    process.exit(result.outcome === "conflict" ? 2 : 0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
