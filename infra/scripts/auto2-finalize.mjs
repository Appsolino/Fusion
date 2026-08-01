#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto2 2026-07-31-18:00:
 * Trusted AUTO-2 finalizer. Workflow code must come from Appsolino main.
 * Never executes candidate package scripts. Mints/uses App token only in this
 * trusted zone after candidate validation. Never deploys Host D.
 *
 * FNXC:AppsolinoAuto3 2026-08-01-01:20:
 * After an eligible low-risk merge to main, dispatch AUTO-3 with the exact
 * merged main SHA and wait for DEPLOYED. ROLLED_BACK/CRITICAL is a durable
 * deployment failure (no retry loop). Sensitive PRs still require owner
 * approval and are never auto-merged here. PR #34 remains out of auto path.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  classifyUpstream,
  buildAuto2ReportBody,
  isAuto2ManagedHead,
  LABEL_APPROVAL,
  LABEL_BLOCKED,
  LABEL_LOW,
  LABEL_MEDIUM,
  REPORT_MARKER,
} from "./auto2-classify-upstream.mjs";

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
export function gh(args, env = process.env) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    env: {
      ...env,
      GH_CONFIG_DIR: env.AUTO2_GH_CONFIG_DIR || env.GH_CONFIG_DIR || `${env.RUNNER_TEMP || "/tmp"}/auto2-gh-config`,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

/**
 * @param {object} input
 * @param {string} input.repo
 * @param {number|string} input.prNumber
 * @param {string} input.validatedHeadSha
 * @param {string} [input.validationConclusion]
 * @param {boolean} [input.ownerApproved]
 * @param {boolean} [input.allowMissingApp]
 * @param {(args: string[], env?: NodeJS.ProcessEnv) => {status:number,stdout:string,stderr:string}} [input.gh]
 * @param {boolean} [input.dryRun]
 * @param {boolean} [input.executeCandidateCode] — must remain false
 * @param {boolean} [input.dispatchAuto3] — default true for main merges; tests should set false
 * @param {number} [input.auto3PollMs]
 * @param {number} [input.auto3TimeoutMs]
 */
export function runAuto2Finalize(input) {
  if (input.executeCandidateCode === true) {
    throw new Error("AUTO-2 finalizer must never execute candidate code");
  }

  const runGh = input.gh ?? gh;
  const repo = input.repo;
  const prNumber = String(input.prNumber);

  if (!input.allowMissingApp && !process.env.AUTO2_GITHUB_APP_TOKEN && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    throw new Error(
      "AUTO-2 fail-closed: GitHub App token unavailable for finalizer. Owner OAuth/ad-hoc PAT is not the routine identity.",
    );
  }

  const prRes = runGh([
    "pr", "view", prNumber,
    "--repo", repo,
    "--json", "number,state,title,headRefName,baseRefName,headRefOid,mergeable,commits,labels,url",
  ]);
  if (prRes.status !== 0) throw new Error(`gh pr view failed: ${prRes.stderr || prRes.stdout}`);
  const pr = JSON.parse(prRes.stdout);

  if (pr.state !== "OPEN") {
    return { action: "ignored", reason: `PR state ${pr.state}`, classification: null, pr };
  }
  if (!isAuto2ManagedHead(pr.headRefName || "")) {
    return { action: "ignored", reason: "non-automation / non-proof head ref", classification: null, pr };
  }

  const namesRes = runGh([
    "api", `repos/${repo}/pulls/${prNumber}/files`, "--paginate",
    "--jq", ".[].filename",
  ]);
  if (namesRes.status !== 0) {
    return finalizeBlocked(input, pr, runGh, classifyUpstream({
      changedFiles: [],
      commitCount: Array.isArray(pr.commits) ? pr.commits.length : 0,
      missingClassificationData: true,
      validatedHeadSha: input.validatedHeadSha,
      isAutomationPr: true,
    }), "missing classification data (file list)");
  }
  const changedFiles = namesRes.stdout.split("\n").map((s) => s.trim()).filter(Boolean);

  const currentHead = pr.headRefOid;
  const stale = Boolean(input.validatedHeadSha) && currentHead !== input.validatedHeadSha;
  const conflict = String(pr.mergeable || "").toUpperCase() === "CONFLICTING";
  const checksFailed = input.validationConclusion === "failure" || input.validationConclusion === "cancelled";

  const classification = classifyUpstream({
    changedFiles,
    commitCount: Array.isArray(pr.commits) ? pr.commits.length : Number(pr.commits?.length || 0),
    validatedHeadSha: input.validatedHeadSha || currentHead,
    hasMergeConflict: conflict,
    requiredChecksFailed: checksFailed,
    staleValidatedSha: stale,
    isAutomationPr: true,
  });

  // Prefer accurate commit count from API
  if (!classification.commitCount) {
    const countRes = runGh(["api", `repos/${repo}/pulls/${prNumber}`, "--jq", ".commits"]);
    if (countRes.status === 0) classification.commitCount = Number(countRes.stdout) || 0;
  }

  const body = buildAuto2ReportBody(classification, {
    prNumber,
    headSha: currentHead,
    baseRef: pr.baseRefName,
    headRef: pr.headRefName,
    validationConclusion: input.validationConclusion,
  });

  ensureLabels(runGh, repo, prNumber, classification, input.dryRun === true);
  upsertReportComment(runGh, repo, prNumber, body, input.dryRun === true);

  if (classification.riskClass === "blocked" || classification.ignored) {
    return { action: "blocked", reason: classification.reasons.join("; "), classification, pr, mutatedMain: false, deployedHostD: false };
  }

  if (classification.riskClass === "sensitive" || classification.riskClass === "medium") {
    const approved = input.ownerApproved === true;
    if (classification.riskClass === "sensitive" && approved && !stale && !checksFailed) {
      // Still no auto-merge for sensitive even with approval in this function —
      // owner approval is recorded; merge of sensitive requires explicit separate owner action outside AUTO-2 auto path.
      // FNXC:AppsolinoAuto2 2026-07-31-18:00: sensitive never auto-merges; approval only clears the blocked-wait label story.
      return {
        action: "approval-required",
        reason: "sensitive — owner approval recorded but AUTO-2 does not auto-merge sensitive PRs",
        classification,
        pr,
        mutatedMain: false,
        deployedHostD: false,
      };
    }
    return {
      action: "approval-required",
      reason: classification.riskClass === "medium"
        ? "medium — no automatic merge during initial AUTO-2 rollout"
        : "sensitive — one owner approval required; no automatic merge",
      classification,
      pr,
      mutatedMain: false,
      deployedHostD: false,
    };
  }

  // low risk auto-merge
  if (!classification.autoMergeEligible) {
    return { action: "approval-required", reason: "not auto-merge eligible", classification, pr, mutatedMain: false, deployedHostD: false };
  }
  if (stale || checksFailed) {
    return finalizeBlocked(input, pr, runGh, {
      ...classification,
      riskClass: "blocked",
      reasons: [stale ? "stale validated SHA" : "required checks failed"],
      autoMergeEligible: false,
    }, stale ? "stale validated SHA" : "required checks failed");
  }

  if (input.dryRun) {
    return { action: "auto-merge-dry-run", reason: "dry-run", classification, pr, mutatedMain: false, deployedHostD: false };
  }

  const merge = runGh([
    "pr", "merge", prNumber,
    "--repo", repo,
    "--merge",
    "--match-head-commit", currentHead,
  ]);
  if (merge.status !== 0) {
    return finalizeBlocked(input, pr, runGh, {
      ...classification,
      riskClass: "blocked",
      reasons: [`merge failed: ${merge.stderr || merge.stdout}`],
      autoMergeEligible: false,
    }, `merge failed: ${merge.stderr || merge.stdout}`);
  }

  const mutatedMain = pr.baseRefName === "main";
  /** @type {{action:string,reason:string,classification:*,pr:*,mutatedMain:boolean,deployedHostD:boolean,auto3?:*}} */
  const result = {
    action: "auto-merged",
    reason: "low-risk exact-head merge commit",
    classification,
    pr,
    mutatedMain,
    // FNXC:AppsolinoAuto2 2026-07-31-18:00: proof PRs may target a temp base — main stays unchanged.
    deployedHostD: false,
  };

  // FNXC:AppsolinoAuto3 2026-08-01-01:20: End-to-end success requires AUTO-3 DEPLOYED for merges that land on main.
  if (mutatedMain && input.dispatchAuto3 !== false && !input.dryRun) {
    const auto3 = dispatchAndAwaitAuto3(runGh, repo, prNumber, {
      pollMs: input.auto3PollMs,
      timeoutMs: input.auto3TimeoutMs,
    });
    result.auto3 = auto3;
    if (auto3.status === "DEPLOYED" || auto3.status === "IDEMPOTENT_NOOP") {
      result.action = "auto-merged-deployed";
      result.reason = `low-risk merge + AUTO-3 ${auto3.status}`;
      result.deployedHostD = true;
    } else if (auto3.status === "ROLLED_BACK") {
      result.action = "auto-merged-deploy-rolled-back";
      result.reason = "merge on main retained; AUTO-3 rolled back — no continuous retry";
      result.deployedHostD = false;
    } else if (auto3.status === "CRITICAL") {
      result.action = "auto-merged-deploy-critical";
      result.reason = "merge on main retained; AUTO-3 CRITICAL — owner action required";
      result.deployedHostD = false;
    } else {
      result.action = "auto-merged-deploy-failed";
      result.reason = `merge on main retained; AUTO-3 status=${auto3.status}`;
      result.deployedHostD = false;
    }
  }

  return result;
}

/**
 * @param {(args: string[], env?: NodeJS.ProcessEnv) => {status:number,stdout:string,stderr:string}} runGh
 * @param {string} repo
 * @param {string} prNumber
 * @param {{pollMs?: number, timeoutMs?: number}} [opts]
 */
export function dispatchAndAwaitAuto3(runGh, repo, prNumber, opts = {}) {
  const tip = runGh(["api", `repos/${repo}/commits/main`, "--jq", ".sha"]);
  if (tip.status !== 0 || !/^[0-9a-f]{40}$/i.test(tip.stdout.trim())) {
    return { status: "BLOCKED", reasons: ["unable to resolve main tip after merge"], sourceSha: null };
  }
  const sourceSha = tip.stdout.trim().toLowerCase();
  const dispatch = runGh([
    "workflow", "run", "upstream-auto3-deploy.yml",
    "--repo", repo,
    "-f", `source_sha=${sourceSha}`,
    "-f", `source_pr=${prNumber}`,
    "-f", "deployment_reason=auto2-low-risk-merge",
    "-f", "profile=staging",
    "-f", "force_smoke_fail=false",
    "-f", `expected_merged_sha=${sourceSha}`,
  ]);
  if (dispatch.status !== 0) {
    return {
      status: "BLOCKED",
      reasons: [`AUTO-3 dispatch failed: ${dispatch.stderr || dispatch.stdout}`],
      sourceSha,
    };
  }

  const pollMs = opts.pollMs ?? 15_000;
  const timeoutMs = opts.timeoutMs ?? 3_600_000;
  const started = Date.now();
  let runId = "";
  while (Date.now() - started < timeoutMs) {
    if (!runId) {
      const list = runGh([
        "api",
        `repos/${repo}/actions/workflows/upstream-auto3-deploy.yml/runs?event=workflow_dispatch&per_page=5`,
        "--jq",
        `.workflow_runs[] | select(.head_sha=="${sourceSha}" or .display_title!=null) | .id`,
      ]);
      runId = (list.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
      // Prefer newest run overall if head_sha filter misses dispatch runs (dispatch uses main ref)
      if (!runId) {
        const newest = runGh([
          "api",
          `repos/${repo}/actions/workflows/upstream-auto3-deploy.yml/runs?per_page=1`,
          "--jq",
          ".workflow_runs[0].id",
        ]);
        runId = (newest.stdout || "").trim();
      }
    }
    if (runId) {
      const view = runGh(["api", `repos/${repo}/actions/runs/${runId}`, "--jq", "{status:.status,conclusion:.conclusion}"]);
      if (view.status === 0) {
        try {
          const st = JSON.parse(view.stdout);
          if (st.status === "completed") {
            if (st.conclusion === "success") {
              return { status: "DEPLOYED", reasons: [], sourceSha, runId };
            }
            // Inspect job logs is heavy; map failure conclusions conservatively
            if (st.conclusion === "failure") {
              return { status: "FAILED", reasons: ["AUTO-3 workflow failed"], sourceSha, runId };
            }
            return { status: "BLOCKED", reasons: [`AUTO-3 conclusion=${st.conclusion}`], sourceSha, runId };
          }
        } catch {
          // continue polling
        }
      }
    }
    spawnSync("sleep", [String(Math.max(1, Math.floor(pollMs / 1000)))]);
  }
  return { status: "BLOCKED", reasons: ["AUTO-3 wait timeout"], sourceSha, runId: runId || null };
}

/**
 * @param {*} input
 * @param {*} pr
 * @param {*} runGh
 * @param {*} classification
 * @param {string} reason
 */
function finalizeBlocked(input, pr, runGh, classification, reason) {
  const body = buildAuto2ReportBody(classification, {
    prNumber: pr.number,
    headSha: pr.headRefOid,
    baseRef: pr.baseRefName,
    headRef: pr.headRefName,
    validationConclusion: input.validationConclusion,
  });
  if (!input.dryRun) {
    ensureLabels(runGh, input.repo, String(pr.number), classification, false);
    upsertReportComment(runGh, input.repo, String(pr.number), body, false);
  }
  return { action: "blocked", reason, classification, pr, mutatedMain: false, deployedHostD: false };
}

/**
 * @param {*} runGh
 * @param {string} repo
 * @param {string} prNumber
 * @param {ReturnType<typeof classifyUpstream>} classification
 * @param {boolean} dryRun
 */
function ensureLabels(runGh, repo, prNumber, classification, dryRun) {
  const want = new Set();
  if (classification.riskClass === "blocked") want.add(LABEL_BLOCKED);
  if (classification.riskClass === "sensitive") want.add(LABEL_APPROVAL);
  if (classification.riskClass === "medium") want.add(LABEL_MEDIUM);
  if (classification.riskClass === "low") want.add(LABEL_LOW);

  const all = [LABEL_BLOCKED, LABEL_APPROVAL, LABEL_MEDIUM, LABEL_LOW];
  for (const label of all) {
    // ensure label exists (ignore errors)
    if (!dryRun) {
      runGh(["label", "create", label, "--repo", repo, "--force", "--color",
        label === LABEL_BLOCKED ? "B60205" : label === LABEL_APPROVAL ? "FBCA04" : label === LABEL_MEDIUM ? "0E8A16" : "5319E7",
        "--description", "AUTO-2 state"]);
    }
  }
  if (dryRun) return;
  // remove stale auto2 labels then add wanted
  for (const label of all) {
    if (!want.has(label)) runGh(["pr", "edit", prNumber, "--repo", repo, "--remove-label", label]);
  }
  for (const label of want) {
    runGh(["pr", "edit", prNumber, "--repo", repo, "--add-label", label]);
  }
}

/**
 * @param {*} runGh
 * @param {string} repo
 * @param {string} prNumber
 * @param {string} body
 * @param {boolean} dryRun
 */
function upsertReportComment(runGh, repo, prNumber, body, dryRun) {
  if (dryRun) return;
  const list = runGh([
    "api", `repos/${repo}/issues/${prNumber}/comments?per_page=100`,
    "--jq", `.[] | select(.body|contains("${REPORT_MARKER}")) | .id`,
  ]);
  const id = (list.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean)[0];
  if (id) {
    // write body to temp via stdin is hard with gh api — use --input
    const tmp = `${process.env.RUNNER_TEMP || "/tmp"}/auto2-comment-${prNumber}.json`;
    writeFileSync(tmp, JSON.stringify({ body }));
    runGh(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${id}`, "--input", tmp]);
  } else {
    const tmp = `${process.env.RUNNER_TEMP || "/tmp"}/auto2-comment-new-${prNumber}.json`;
    writeFileSync(tmp, JSON.stringify({ body }));
    runGh(["api", "-X", "POST", `repos/${repo}/issues/${prNumber}/comments`, "--input", tmp]);
  }
}

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--owner-approved") out.ownerApproved = true;
    else if (a === "--allow-missing-app") out.allowMissingApp = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--") && i + 1 < argv.length) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.repo || !args.pr) {
    process.stdout.write(`Usage: auto2-finalize.mjs --repo owner/name --pr N --validated-head SHA [--validation-conclusion X] [--owner-approved] [--dry-run] [--json]\n`);
    process.exit(args.help ? 0 : 2);
  }
  try {
    const result = runAuto2Finalize({
      repo: String(args.repo),
      prNumber: String(args.pr),
      validatedHeadSha: String(args["validated-head"] || ""),
      validationConclusion: args["validation-conclusion"] ? String(args["validation-conclusion"]) : undefined,
      ownerApproved: args.ownerApproved === true,
      allowMissingApp: args.allowMissingApp === true,
      dryRun: args.dryRun === true,
      executeCandidateCode: false,
    });
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`${result.action} risk=${result.classification?.riskClass ?? "-"}\n`);
    process.exit(result.action === "blocked" ? 2 : 0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
