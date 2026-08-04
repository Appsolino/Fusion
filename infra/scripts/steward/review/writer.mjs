#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Trusted App writer — independently recomputes head/diff/checks and enforces gates.
 * Never trusts artifact digests alone (self-comparison rejected).
 */
import { spawnSync } from "node:child_process";
import { assertApprovalsStillValid } from "./approver.mjs";
import {
  assertWriterRecomputedDigests,
  buildEvidenceBundle,
} from "./evidence.mjs";
import { fetchPullRequestMeta } from "./gh-pr.mjs";
import {
  evaluateDualApprovalMerge,
  exactHeadMergeArgv,
  ALLOWED_REPO,
} from "../merge/exact-head.mjs";
import { summarizeActivation } from "../activation/resolve-activation.mjs";

/**
 * @param {{
 *   prNumber: number,
 *   repo: string,
 *   token?: string,
 * }} input
 */
function defaultFetchPr(input) {
  return fetchPullRequestMeta(input);
}

/**
 * @param {{
 *   prNumber: number,
 *   repo: string,
 *   token?: string,
 * }} input
 */
function defaultFetchDiff(input) {
  const diff = spawnSync(
    "gh",
    ["pr", "diff", String(input.prNumber), "--repo", input.repo],
    {
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: input.token || process.env.GH_TOKEN || "" },
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  if (diff.status !== 0) {
    throw new Error(`writer gh pr diff failed: ${(diff.stderr || "").slice(0, 300)}`);
  }
  return String(diff.stdout || "");
}

/**
 * @param {{
 *   prNumber: number,
 *   artifact: {
 *     reviewer: object,
 *     approver: object,
 *     headSha: string,
 *     diffSha256: string,
 *     testsSha256: string,
 *   },
 *   risk: string,
 *   repository?: string,
 *   appToken?: string,
 *   merge?: boolean,
 *   dryRun?: boolean,
 *   expectHead?: string,
 *   activationOpts?: object,
 *   nowMs?: number,
 *   usedArtifactAsCurrent?: boolean,
 *   fetchPr?: (input: { prNumber: number, repo: string, token?: string }) => object,
 *   fetchDiff?: (input: { prNumber: number, repo: string, token?: string }) => string,
 *   mergeExec?: (argv: string[], token?: string) => { status: number, stderr?: string, stdout?: string },
 * }} input
 */
export function writerRevalidateAndMaybeMerge(input) {
  if (input.usedArtifactAsCurrent) {
    throw new Error("writer artifact self-comparison rejected");
  }
  const repo = input.repository || ALLOWED_REPO;
  if (repo !== ALLOWED_REPO) throw new Error("cross-repository target rejected");

  const activation = summarizeActivation(input.activationOpts || {});
  if (activation.killSwitch) {
    return { action: "merge-blocked", reasons: ["kill-switch-or-KILL-file"], activation };
  }

  const fetchPr = input.fetchPr || defaultFetchPr;
  const fetchDiff = input.fetchDiff || defaultFetchDiff;

  const pr = fetchPr({
    prNumber: input.prNumber,
    repo,
    token: input.appToken,
  });
  const headSha = String(pr.headRefOid || "");
  const baseSha = String(pr.baseRefOid || "");
  if (input.expectHead && headSha !== input.expectHead) {
    return { action: "merge-blocked", reasons: ["stale-head-vs-expect"], headSha };
  }
  if (headSha !== input.artifact.headSha) {
    return { action: "merge-blocked", reasons: ["stale-head-vs-artifact"], headSha };
  }

  const diffText = fetchDiff({
    prNumber: input.prNumber,
    repo,
    token: input.appToken,
  });

  const live = buildEvidenceBundle({
    repository: repo,
    baseSha,
    headSha,
    diffText,
    statusCheckRollup: pr.statusCheckRollup || [],
    risk: input.risk,
    rollbackPlan: "writer-revalidation",
  });

  assertWriterRecomputedDigests({
    artifactDiffSha256: input.artifact.diffSha256,
    recomputedDiffSha256: live.diffSha256,
    artifactTestsSha256: input.artifact.testsSha256,
    recomputedTestsSha256: live.testsSha256,
    usedArtifactAsCurrent: false,
  });

  if (!live.checksOk) {
    return {
      action: "merge-blocked",
      reasons: live.checkReasons,
      headSha,
      live,
      writerRecomputed: true,
    };
  }

  try {
    assertApprovalsStillValid({
      reviewer: input.artifact.reviewer,
      approver: input.artifact.approver,
      currentHeadSha: headSha,
      currentDiffSha256: live.diffSha256,
      currentTestsSha256: live.testsSha256,
      nowMs: input.nowMs,
    });
  } catch (err) {
    return {
      action: "merge-blocked",
      reasons: [`approval-revalidation:${err instanceof Error ? err.message : String(err)}`],
      headSha,
      writerRecomputed: true,
    };
  }

  // Gates from live activation policy — never caller-supplied boolean overrides.
  const verdict = evaluateDualApprovalMerge({
    repository: repo,
    risk: input.risk,
    reviewer: input.artifact.reviewer,
    approver: input.artifact.approver,
    currentHeadSha: headSha,
    currentDiffSha256: live.diffSha256,
    currentTestsSha256: live.testsSha256,
    checksConclusion: live.checksConclusion,
    prState: pr.state,
    activationOpts: input.activationOpts,
    nowMs: input.nowMs,
  });

  if (!verdict.ok) {
    return {
      action: "merge-blocked",
      reasons: verdict.reasons,
      headSha,
      activation,
      live,
      writerRecomputed: true,
    };
  }

  if (input.dryRun || !input.merge) {
    return {
      action: "writer-ready",
      headSha,
      live,
      activation,
      mergeArgv: exactHeadMergeArgv({ prNumber: input.prNumber, repo, headSha }),
      writerRecomputed: true,
    };
  }

  const argv = exactHeadMergeArgv({ prNumber: input.prNumber, repo, headSha });
  const mergeExec =
    input.mergeExec ||
    ((mergeArgv, token) =>
      spawnSync("gh", mergeArgv, {
        encoding: "utf8",
        env: { ...process.env, GH_TOKEN: token || process.env.GH_TOKEN || "" },
      }));
  const merge = mergeExec(argv, input.appToken);
  if (merge.status !== 0) {
    return {
      action: "merge-failed",
      stderr: (merge.stderr || merge.stdout || "").slice(0, 500),
      headSha,
      writerRecomputed: true,
    };
  }
  return {
    action: "merged",
    headSha,
    writerRecomputed: true,
    diffSha256: live.diffSha256,
    testsSha256: live.testsSha256,
    activation,
  };
}
