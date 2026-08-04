#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardGrok 2026-08-04:
 * Trusted dual Grok review → approver → exact-head merge evaluation.
 * Writer (App token) revalidates; this module never assumes Host credentials.
 * Fail closed when XAI_API_KEY missing.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runGrokReviewer } from "./reviewer.mjs";
import { runGrokApprover, assertApprovalsStillValid } from "./approver.mjs";
import { requireXaiApiKey } from "./client.mjs";
import { evaluateGrokDualApprovalMerge, exactHeadMergeArgv, ALLOWED_REPO } from "../merge/exact-head.mjs";
import { sha256Text } from "./verdict.mjs";

/**
 * @param {string[]} args
 * @param {{ token?: string }} [opts]
 */
function ghJson(args, opts = {}) {
  const env = { ...process.env };
  if (opts.token) env.GH_TOKEN = opts.token;
  const r = spawnSync("gh", args, { encoding: "utf8", env });
  if (r.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").slice(0, 400)}`);
  }
  return JSON.parse(r.stdout || "null");
}

/**
 * @param {{
 *   prNumber: number,
 *   repository?: string,
 *   risk: string,
 *   rollbackPlan: string,
 *   missionExcerpt: string,
 *   policyExcerpt: string,
 *   merge?: boolean,
 *   dryRun?: boolean,
 *   appToken?: string,
 *   fetchImpl?: typeof fetch,
 * }} input
 */
export async function runDualGrokApproveMaybeMerge(input) {
  requireXaiApiKey({ apiKey: process.env.XAI_API_KEY });
  const repo = input.repository || ALLOWED_REPO;
  if (repo !== ALLOWED_REPO) throw new Error("cross-repository target rejected");

  const pr = ghJson(
    [
      "pr",
      "view",
      String(input.prNumber),
      "--repo",
      repo,
      "--json",
      "number,state,baseRefOid,headRefOid,baseRefName,headRefName,url,statusCheckRollup",
    ],
    { token: input.appToken },
  );
  const headSha = String(pr.headRefOid || "");
  const baseSha = String(pr.baseRefOid || "");
  const diffText = spawnSync(
    "gh",
    ["pr", "diff", String(input.prNumber), "--repo", repo],
    {
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: input.appToken || process.env.GH_TOKEN || "" },
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  if (diffText.status !== 0) {
    throw new Error(`gh pr diff failed: ${(diffText.stderr || "").slice(0, 300)}`);
  }
  const testsLog = JSON.stringify(
    (pr.statusCheckRollup || []).map((c) => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
    })),
  );
  const checksOk = (pr.statusCheckRollup || [])
    .filter((c) => /^(Lint|Typecheck|Build|Gate|Desktop packaging)$/.test(String(c.name || "")))
    .every((c) => String(c.conclusion || "").toUpperCase() === "SUCCESS");
  const checksConclusion = checksOk ? "success" : "pending";

  const evidenceBase = {
    repository: repo,
    baseSha,
    headSha,
    diffText: diffText.stdout || "",
    testsLog,
    risk: input.risk,
    rollbackPlan: input.rollbackPlan,
    mission: input.missionExcerpt,
    policyExcerpts: input.policyExcerpt,
    changedFiles: [],
  };

  const reviewer = await runGrokReviewer({
    evidence: evidenceBase,
    fetchImpl: input.fetchImpl,
  });
  if (reviewer.verdict !== "APPROVE") {
    return { action: "reviewer-rejected", reviewer, headSha };
  }

  const approver = await runGrokApprover({
    evidence: {
      ...evidenceBase,
      reviewerRequestId: reviewer.requestId,
      reviewerVerdictRaw: reviewer,
    },
    fetchImpl: input.fetchImpl,
  });
  if (approver.verdict !== "APPROVE") {
    return { action: "approver-rejected", reviewer, approver, headSha };
  }

  const diffSha256 = sha256Text(evidenceBase.diffText);
  const testsSha256 = sha256Text(testsLog);
  assertApprovalsStillValid({
    reviewer,
    approver,
    currentHeadSha: headSha,
    currentDiffSha256: diffSha256,
    currentTestsSha256: testsSha256,
  });

  const verdict = evaluateGrokDualApprovalMerge({
    repository: repo,
    risk: input.risk,
    reviewer,
    approver,
    currentHeadSha: headSha,
    currentDiffSha256: diffSha256,
    currentTestsSha256: testsSha256,
    checksConclusion,
    prState: pr.state,
    s2Gate: String(input.risk).toUpperCase() === "LOW" ? true : undefined,
    s3Gate: String(input.risk).toUpperCase() === "SENSITIVE" ? true : undefined,
  });

  if (!verdict.ok) {
    return { action: "merge-blocked", reasons: verdict.reasons, reviewer, approver, headSha };
  }

  if (input.dryRun || !input.merge) {
    return {
      action: "approved-ready",
      reviewer,
      approver,
      headSha,
      diffSha256,
      testsSha256,
      mergeArgv: exactHeadMergeArgv({ prNumber: input.prNumber, repo, headSha }),
    };
  }

  const merge = spawnSync("gh", exactHeadMergeArgv({ prNumber: input.prNumber, repo, headSha }), {
    encoding: "utf8",
    env: { ...process.env, GH_TOKEN: input.appToken || process.env.GH_TOKEN || "" },
  });
  if (merge.status !== 0) {
    return {
      action: "merge-failed",
      stderr: (merge.stderr || merge.stdout || "").slice(0, 500),
      reviewer,
      approver,
      headSha,
    };
  }
  return {
    action: "merged",
    headSha,
    reviewerRequestId: reviewer.requestId,
    approverRequestId: approver.requestId,
    digest: createHash("sha256").update(`${headSha}:${diffSha256}:${testsSha256}`).digest("hex"),
  };
}
