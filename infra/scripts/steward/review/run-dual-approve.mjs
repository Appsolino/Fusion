#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Dual Cursor review orchestrator — full evidence; no gate overrides.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runCursorReviewer } from "./reviewer.mjs";
import { runCursorApprover } from "./approver.mjs";
import { assertNoXaiRequirement } from "./policy.mjs";
import { buildEvidenceBundle } from "./evidence.mjs";
import { fetchPullRequestMeta } from "./gh-pr.mjs";
import {
  evaluateDualApprovalMerge,
  exactHeadMergeArgv,
  ALLOWED_REPO,
} from "../merge/exact-head.mjs";

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
 *   engine?: Function,
 *   spawnFn?: Function,
 *   modelProbe?: object,
 *   activationOpts?: object,
 * }} input
 */
export async function runDualCursorApproveMaybeMerge(input) {
  assertNoXaiRequirement();
  const repo = input.repository || ALLOWED_REPO;
  if (repo !== ALLOWED_REPO) throw new Error("cross-repository target rejected");

  const pr = fetchPullRequestMeta({
    prNumber: input.prNumber,
    repo,
    token: input.appToken,
  });
  const headSha = String(pr.headRefOid || "");
  const baseSha = String(pr.baseRefOid || "");
  const diffProc = spawnSync(
    "gh",
    ["pr", "diff", String(input.prNumber), "--repo", repo],
    {
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: input.appToken || process.env.GH_TOKEN || "" },
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  if (diffProc.status !== 0) {
    throw new Error(`gh pr diff failed: ${(diffProc.stderr || "").slice(0, 300)}`);
  }

  const evidenceBase = buildEvidenceBundle({
    repository: repo,
    baseSha,
    headSha,
    diffText: diffProc.stdout || "",
    statusCheckRollup: pr.statusCheckRollup || [],
    risk: input.risk,
    rollbackPlan: input.rollbackPlan,
    mission: input.missionExcerpt,
    policyExcerpts: input.policyExcerpt,
  });

  if (!evidenceBase.checksOk) {
    return {
      action: "merge-blocked",
      reasons: evidenceBase.checkReasons,
      headSha,
      evidence: {
        changedFiles: evidenceBase.changedFiles,
        classifiedFiles: evidenceBase.classifiedFiles,
      },
    };
  }

  const reviewer = await runCursorReviewer({
    evidence: evidenceBase,
    engine: input.engine,
    spawnFn: input.spawnFn,
    modelProbe: input.modelProbe,
  });
  if (reviewer.verdict !== "APPROVE") {
    return { action: "reviewer-rejected", reviewer, headSha };
  }

  const approver = await runCursorApprover({
    evidence: {
      ...evidenceBase,
      reviewerRequestId: reviewer.requestId,
      reviewerSessionId: reviewer.sessionId,
      reviewerVerdictRaw: reviewer,
    },
    engine: input.engine,
    spawnFn: input.spawnFn,
    modelProbe: input.modelProbe,
  });
  if (approver.verdict !== "APPROVE") {
    return { action: "approver-rejected", reviewer, approver, headSha };
  }

  // Evaluation uses live activation policy gates — never hardcode s2/s3 true.
  const verdict = evaluateDualApprovalMerge({
    repository: repo,
    risk: input.risk,
    reviewer,
    approver,
    currentHeadSha: headSha,
    currentDiffSha256: evidenceBase.diffSha256,
    currentTestsSha256: evidenceBase.testsSha256,
    checksConclusion: evidenceBase.checksConclusion,
    prState: pr.state,
    activationOpts: input.activationOpts,
  });

  if (!verdict.ok) {
    return {
      action: "merge-blocked",
      reasons: verdict.reasons,
      reviewer,
      approver,
      headSha,
      diffSha256: evidenceBase.diffSha256,
      testsSha256: evidenceBase.testsSha256,
    };
  }

  if (input.dryRun || !input.merge) {
    return {
      action: "approved-ready",
      reviewer,
      approver,
      headSha,
      baseSha,
      diffSha256: evidenceBase.diffSha256,
      testsSha256: evidenceBase.testsSha256,
      changedFiles: evidenceBase.changedFiles,
      classifiedFiles: evidenceBase.classifiedFiles,
      evidencePayloadFields: [
        "changedFiles",
        "classifiedFiles",
        "diffText",
        "requiredCheckResults",
        "testsLog",
        "mission",
        "policyExcerpts",
        "rollbackPlan",
      ],
      mergeArgv: exactHeadMergeArgv({ prNumber: input.prNumber, repo, headSha }),
      digest: createHash("sha256")
        .update(`${headSha}:${evidenceBase.diffSha256}:${evidenceBase.testsSha256}`)
        .digest("hex"),
    };
  }

  // Live merge must go through writer.mjs (recomputes digests). Fail closed here.
  throw new Error(
    "runDualCursorApproveMaybeMerge refuses direct merge — use writerRevalidateAndMaybeMerge",
  );
}
