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
 * deployment failure (no retry loop).
 *
 * FNXC:AppsolinoAuto2SensitiveApproval 2026-08-01-04:55:
 * Prior gap: sensitive PRs correctly classified as approval-required, but even
 * ownerApproved=true never merged. Sensitive merges now require independently
 * verified exact-head APPROVED review from Anas966 (see auto2-sensitive-approval.mjs
 * and upstream-auto2-approve-sensitive.yml). A raw --owner-approved flag alone is
 * not authorization. Candidate code never receives App/Host D secrets.
 *
 * FNXC:UpstreamSensitiveExpert 2026-08-07-04:15:
 * SENSITIVE/MEDIUM no longer default to owner-stop. Without verified owner approval,
 * continue to expert-resolving (real AI) rather than parking as approval-required.
 * Finalizer re-fetches upstream HEAD and refuses merge-as-current when the candidate
 * upstream SHA is stale (REFRESH_REQUIRED).
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
import {
  evaluateExactHeadOwnerApproval,
  fetchPullRequestReviews,
  isSensitiveApprovalHead,
  resolveRequiredChecksConclusion,
} from "./auto2-sensitive-approval.mjs";
import {
  buildAuto3HandoffId,
  selectCorrelatedAuto3Run,
  mapAuto3RunToTerminal,
  parseAuto3TerminalMarker,
} from "./auto3-handoff.mjs";
import {
  resolveSensitiveContinuation,
  candidateUpstreamFromHead,
  LABEL_EXPERT_RESOLVING,
  LABEL_REFRESH_REQUIRED,
  LABEL_BLOCKED_POLICY,
} from "./upstream/sensitive-expert-path.mjs";
import { assertFinalizerFreshness } from "./upstream/rolling-candidate.mjs";
import { evaluateFreshness, formatFreshnessReport } from "./upstream/freshness.mjs";

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
 * @param {boolean} [input.ownerApproved] — non-authoritative; cannot authorize alone
 * @param {boolean} [input.requireSensitiveApproval] — approve-sensitive workflow entry: must verify review
 * @param {string} [input.approvedHead] — exact head the owner approved (required when requireSensitiveApproval)
 * @param {boolean} [input.allowMissingApp]
 * @param {(args: string[], env?: NodeJS.ProcessEnv) => {status:number,stdout:string,stderr:string}} [input.gh]
 * @param {boolean} [input.dryRun]
 * @param {boolean} [input.executeCandidateCode] — must remain false
 * @param {boolean} [input.dispatchAuto3] — default true for main merges; tests should set false
 * @param {string} [input.auto3Profile] — staging (default) or proof
 * @param {number} [input.auto3PollMs]
 * @param {number} [input.auto3TimeoutMs]
 * @param {Array<*>} [input.reviewsForTest] — inject reviews (unit tests only)
 * @param {string} [input.checksConclusionForTest] — inject checks conclusion (unit tests only)
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
    "--json", "number,state,title,headRefName,baseRefName,headRefOid,mergeable,commits,labels,url,mergedAt,body",
  ]);
  if (prRes.status !== 0) throw new Error(`gh pr view failed: ${prRes.stderr || prRes.stdout}`);
  const pr = JSON.parse(prRes.stdout);

  /*
  FNXC:AppsolinoAuto2SensitiveApproval 2026-08-01-04:55:
  Repeated approval dispatch after merge is idempotent — do not re-merge or re-loop AUTO-3.
  */
  if (String(pr.state || "").toUpperCase() === "MERGED" || pr.mergedAt) {
    return {
      action: "already-merged-idempotent",
      reason: "PR already merged; sensitive approval dispatch is idempotent",
      classification: null,
      pr,
      mutatedMain: false,
      deployedHostD: false,
    };
  }

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

  if (classification.riskClass === "medium") {
    return finalizeSensitive(input, pr, runGh, classification, {
      currentHead,
      stale,
      checksFailed,
    });
  }

  if (classification.riskClass === "sensitive") {
    return finalizeSensitive(input, pr, runGh, classification, {
      currentHead,
      stale,
      checksFailed,
    });
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

  return performExactHeadMergeAndMaybeAuto3(input, pr, runGh, classification, currentHead, {
    reasonPrefix: "low-risk",
  });
}

/**
 * FNXC:AppsolinoAuto2SensitiveApproval 2026-08-01-04:55:
 * Sensitive path: verified exact-head owner review → merge + AUTO-3.
 *
 * FNXC:UpstreamSensitiveExpert 2026-08-07-04:15:
 * Without owner approval, route to expert-resolving (not owner parking), after
 * confirming the candidate still matches live upstream HEAD.
 *
 * @param {*} input
 * @param {*} pr
 * @param {*} runGh
 * @param {*} classification
 * @param {{currentHead:string,stale:boolean,checksFailed:boolean}} ctx
 */
function finalizeSensitive(input, pr, runGh, classification, ctx) {
  const { currentHead, stale, checksFailed } = ctx;
  const approvedHead = String(input.approvedHead || input.validatedHeadSha || "").trim().toLowerCase();
  const requirePath = input.requireSensitiveApproval === true;

  if (stale) {
    return finalizeBlocked(input, pr, runGh, {
      ...classification,
      riskClass: "blocked",
      reasons: ["stale validated SHA"],
      autoMergeEligible: false,
    }, "stale validated SHA");
  }
  if (checksFailed) {
    return finalizeBlocked(input, pr, runGh, {
      ...classification,
      riskClass: "blocked",
      reasons: ["required checks failed"],
      autoMergeEligible: false,
    }, "required checks failed");
  }
  if (requirePath && !isSensitiveApprovalHead(pr.headRefName || "")) {
    return finalizeBlocked(input, pr, runGh, {
      ...classification,
      riskClass: "blocked",
      reasons: ["sensitive approval requires automation/upstream-* head"],
      autoMergeEligible: false,
    }, "head ref not automation/upstream-*");
  }

  // Re-fetch live upstream HEAD and Appsolino main before any merge-as-current decision.
  const liveUpstreamHead = resolveLiveUpstreamHead(input, runGh);
  const liveAppsolinoMain = resolveLiveAppsolinoMain(input, runGh);
  const candidateUpstreamSha =
    input.candidateUpstreamSha ||
    candidateUpstreamFromHead(pr.headRefName || "", liveUpstreamHead);
  const candidateBaseAppsolinoSha =
    input.candidateBaseAppsolinoSha ||
    parseCandidateBaseAppsolinoSha(pr.body || "") ||
    null;

  let reviews;
  if (Array.isArray(input.reviewsForTest)) {
    reviews = input.reviewsForTest;
  } else {
    const fetched = fetchPullRequestReviews(runGh, input.repo, pr.number);
    if (!fetched.ok) {
      if (input.ownerApproved === true || requirePath) {
        return finalizeBlocked(input, pr, runGh, {
          ...classification,
          riskClass: "blocked",
          reasons: [`unable to load reviews: ${fetched.error}`],
          autoMergeEligible: false,
        }, `unable to load reviews: ${fetched.error}`);
      }
      reviews = [];
    } else {
      reviews = fetched.reviews;
    }
  }

  let checksConclusion = input.checksConclusionForTest;
  if (!checksConclusion) {
    if (input.validationConclusion === "success") checksConclusion = "success";
    else if (input.validationConclusion === "failure" || input.validationConclusion === "cancelled") {
      checksConclusion = "failure";
    } else {
      const resolved = resolveRequiredChecksConclusion(runGh, input.repo, pr.number, currentHead);
      checksConclusion = resolved.conclusion;
    }
  }

  const verdict = evaluateExactHeadOwnerApproval({
    currentHead,
    approvedHead: approvedHead || currentHead,
    reviews,
    prState: pr.state,
    headRefName: requirePath ? pr.headRefName : undefined,
    checksConclusion,
    booleanOwnerApprovedFlag: input.ownerApproved === true,
  });

  if (verdict.idempotentMerged) {
    return {
      action: "already-merged-idempotent",
      reason: verdict.reasons.join("; "),
      classification,
      pr,
      mutatedMain: false,
      deployedHostD: false,
    };
  }

  const continuation = resolveSensitiveContinuation({
    riskClass: classification.riskClass,
    ownerPolicy: input.ownerPolicy || {},
    expertCompleted: input.expertCompleted === true,
    expertDecision: input.expertDecision || null,
    verifierVerdict: input.verifierVerdict || null,
    deterministicPassed: input.validationConclusion !== "failure",
    liveUpstreamHead,
    candidateUpstreamSha,
    liveAppsolinoMain,
    candidateBaseAppsolinoSha,
    skipUpstreamFreshnessCheck: input.skipUpstreamFreshnessCheck === true,
    legacyOwnerApprovalOk: verdict.ok === true,
  });

  if (continuation.action === "refresh-required") {
    ensureExtraLabels(runGh, input.repo, pr.number, [LABEL_REFRESH_REQUIRED], input.dryRun === true);
    return {
      action: "refresh-required",
      reason: continuation.reason,
      classification,
      pr,
      liveUpstreamHead,
      candidateUpstreamSha,
      liveAppsolinoMain,
      candidateBaseAppsolinoSha,
      freshness: evaluateFreshness({
        upstreamHead: liveUpstreamHead,
        integratedUpstreamSha: input.integratedUpstreamSha || null,
        candidateUpstreamSha,
        candidateAppsolinoSha: candidateBaseAppsolinoSha,
        commitsBehindIntegrated: null,
        auto2Action: "refresh-required",
      }),
      mutatedMain: false,
      deployedHostD: false,
    };
  }

  if (continuation.action === "blocked-policy") {
    ensureExtraLabels(runGh, input.repo, pr.number, [LABEL_BLOCKED_POLICY], input.dryRun === true);
    return {
      action: "blocked-policy",
      reason: continuation.reason,
      classification,
      pr,
      mutatedMain: false,
      deployedHostD: false,
    };
  }

  if (continuation.action === "blocked-unresolved") {
    return {
      action: "blocked-unresolved",
      reason: continuation.reason,
      classification,
      pr,
      mutatedMain: false,
      deployedHostD: false,
    };
  }

  if (continuation.action === "merge-eligible" && verdict.ok) {
    // Finalizer race: refuse if upstream OR Appsolino main moved between classification and merge.
    const race = assertFinalizerFreshness({
      candidateUpstreamSha,
      liveUpstreamHead,
      candidateBaseAppsolinoSha,
      liveAppsolinoMain,
    });
    if (!race.ok) {
      ensureExtraLabels(runGh, input.repo, pr.number, [LABEL_REFRESH_REQUIRED], input.dryRun === true);
      return {
        action: "refresh-required",
        reason: race.reason,
        classification,
        pr,
        liveUpstreamHead,
        candidateUpstreamSha,
        liveAppsolinoMain,
        candidateBaseAppsolinoSha,
        mismatch: race.mismatch || null,
        mutatedMain: false,
        deployedHostD: false,
      };
    }
    return performExactHeadMergeAndMaybeAuto3(input, pr, runGh, classification, currentHead, {
      reasonPrefix: "sensitive-approved",
      auto3Profile: input.auto3Profile,
    });
  }

  if (continuation.action === "merge-eligible" && input.expertCompleted === true) {
    const race = assertFinalizerFreshness({
      candidateUpstreamSha,
      liveUpstreamHead,
      candidateBaseAppsolinoSha,
      liveAppsolinoMain,
    });
    if (!race.ok) {
      return {
        action: "refresh-required",
        reason: race.reason,
        classification,
        pr,
        liveUpstreamHead,
        candidateUpstreamSha,
        liveAppsolinoMain,
        candidateBaseAppsolinoSha,
        mismatch: race.mismatch || null,
        mutatedMain: false,
        deployedHostD: false,
      };
    }
    return performExactHeadMergeAndMaybeAuto3(input, pr, runGh, classification, currentHead, {
      reasonPrefix: "sensitive-expert-verified",
      auto3Profile: input.auto3Profile,
    });
  }

  /*
  FNXC:UpstreamSensitiveExpert 2026-08-07-04:15:
  Default sensitive/medium continuation: expert-resolving. Owner approval workflow remains
  available as an optional fast-path; it is no longer the only way forward.
  */
  if (requirePath || input.ownerApproved === true) {
    // Explicit approve-sensitive workflow without verified review stays fail-closed blocked.
    return finalizeBlocked(input, pr, runGh, {
      ...classification,
      riskClass: "blocked",
      reasons: verdict.ok ? ["unexpected"] : verdict.reasons,
      autoMergeEligible: false,
    }, verdict.reasons.join("; ") || "sensitive approval path failed");
  }

  ensureExtraLabels(runGh, input.repo, pr.number, [LABEL_EXPERT_RESOLVING], input.dryRun === true);
  const freshness = evaluateFreshness({
    upstreamHead: liveUpstreamHead,
    integratedUpstreamSha: input.integratedUpstreamSha || null,
    candidateUpstreamSha,
    commitsBehindIntegrated: input.commitsBehindIntegrated ?? null,
    activeCandidatePr: Number(pr.number),
    auto2Action: "expert-resolving",
    expertActive: true,
  });
  return {
    action: "expert-resolving",
    reason: continuation.reason,
    classification,
    pr,
    liveUpstreamHead,
    candidateUpstreamSha,
    freshness,
    freshnessReport: formatFreshnessReport(freshness),
    mutatedMain: false,
    deployedHostD: false,
    approval: verdict,
  };
}

/**
 * @param {*} input
 * @param {*} runGh
 */
function resolveLiveUpstreamHead(input, runGh) {
  if (input.liveUpstreamHead && /^[0-9a-f]{7,40}$/i.test(String(input.liveUpstreamHead))) {
    return String(input.liveUpstreamHead).trim().toLowerCase();
  }
  const res = runGh([
    "api",
    "repos/Runfusion/Fusion/commits/main",
    "--jq",
    ".sha",
  ]);
  if (res.status !== 0) return null;
  const sha = String(res.stdout || "").trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/**
 * FNXC:UpstreamRollingCandidate 2026-08-07-05:55:
 * Live Appsolino main tip used by the dual finalizer race guard.
 * @param {*} input
 * @param {*} runGh
 */
function resolveLiveAppsolinoMain(input, runGh) {
  if (input.liveAppsolinoMain && /^[0-9a-f]{7,40}$/i.test(String(input.liveAppsolinoMain))) {
    return String(input.liveAppsolinoMain).trim().toLowerCase();
  }
  const repo = input.repo || process.env.GITHUB_REPOSITORY || "Appsolino/Fusion";
  const res = runGh([
    "api",
    `repos/${repo}/commits/main`,
    "--jq",
    ".sha",
  ]);
  if (res.status !== 0) return null;
  const sha = String(res.stdout || "").trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/**
 * Parse candidateBaseAppsolinoSha from AUTO-1 PR body identity marker or table row.
 * @param {string} body
 */
export function parseCandidateBaseAppsolinoSha(body) {
  const text = String(body || "");
  const marker = text.match(/candidateBaseAppsolinoSha:\s*([0-9a-f]{7,40})/i);
  if (marker) return marker[1].toLowerCase();
  const table = text.match(/\|\s*candidateBaseAppsolinoSha\s*\|\s*`([0-9a-f]{7,40})`\s*\|/i);
  if (table) return table[1].toLowerCase();
  const previous = text.match(/\|\s*Previous Appsolino SHA\s*\|\s*`([0-9a-f]{7,40})`\s*\|/i);
  if (previous) return previous[1].toLowerCase();
  return null;
}

/**
 * @param {*} runGh
 * @param {string} repo
 * @param {string|number} prNumber
 * @param {string[]} labels
 * @param {boolean} dryRun
 */
function ensureExtraLabels(runGh, repo, prNumber, labels, dryRun) {
  if (dryRun || !labels.length) return;
  for (const label of labels) {
    runGh([
      "api",
      "-X", "POST",
      `repos/${repo}/issues/${prNumber}/labels`,
      "-f", `labels[]=${label}`,
    ]);
    // Fallback: gh label create may not exist; ignore failures for missing label defs.
    runGh(["pr", "edit", String(prNumber), "--repo", repo, "--add-label", label]);
  }
}

/**
 * @param {*} input
 * @param {*} pr
 * @param {*} runGh
 * @param {*} classification
 * @param {string} currentHead
 * @param {{reasonPrefix:string, auto3Profile?: string}} opts
 */
function performExactHeadMergeAndMaybeAuto3(input, pr, runGh, classification, currentHead, opts) {
  if (input.dryRun) {
    return {
      action: "auto-merge-dry-run",
      reason: "dry-run",
      classification,
      pr,
      mutatedMain: false,
      deployedHostD: false,
      mergeHead: currentHead,
    };
  }

  const merge = runGh([
    "pr", "merge", String(pr.number),
    "--repo", input.repo,
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
  /** @type {{action:string,reason:string,classification:*,pr:*,mutatedMain:boolean,deployedHostD:boolean,auto3?:*,mergedMainSha?:string|null,mergeHead?:string}} */
  const result = {
    action: "auto-merged",
    reason: `${opts.reasonPrefix} exact-head merge commit`,
    classification,
    pr,
    mutatedMain,
    // FNXC:AppsolinoAuto2 2026-07-31-18:00: proof PRs may target a temp base — main stays unchanged.
    deployedHostD: false,
    mergeHead: currentHead,
    mergedMainSha: null,
  };

  // FNXC:AppsolinoAuto3 2026-08-01-01:20: End-to-end success requires AUTO-3 DEPLOYED for merges that land on main.
  if (mutatedMain && input.dispatchAuto3 !== false && !input.dryRun) {
    const auto3 = dispatchAndAwaitAuto3(runGh, input.repo, String(pr.number), {
      pollMs: input.auto3PollMs,
      timeoutMs: input.auto3TimeoutMs,
      profile: opts.auto3Profile || input.auto3Profile || "staging",
      deploymentReason: opts.reasonPrefix === "sensitive-approved"
        ? "auto2-sensitive-approved-merge"
        : "auto2-low-risk-merge",
      // FNXC:AppsolinoAuto3Handoff 2026-08-01-06:50: Bind child wait to this parent Actions run metadata.
      githubRunId: input.githubRunId || process.env.GITHUB_RUN_ID,
      githubRunAttempt: input.githubRunAttempt || process.env.GITHUB_RUN_ATTEMPT,
      handoffNonce: input.handoffNonce,
      nowMs: input.nowMs,
      sleep: input.sleep,
    });
    result.auto3 = auto3;
    result.mergedMainSha = auto3.sourceSha || null;
    if (auto3.status === "DEPLOYED" || auto3.status === "IDEMPOTENT_NOOP") {
      result.action = "auto-merged-deployed";
      result.reason = `${opts.reasonPrefix} merge + AUTO-3 ${auto3.status} run=${auto3.auto3RunId || "n/a"} handoff=${auto3.handoffId || "n/a"}`;
      result.deployedHostD = opts.auto3Profile === "proof" || input.auto3Profile === "proof"
        ? false
        : true;
    } else if (auto3.status === "ROLLED_BACK") {
      result.action = "auto-merged-deploy-rolled-back";
      result.reason = `merge on main retained; AUTO-3 rolled back run=${auto3.auto3RunId || "n/a"} — no continuous retry`;
      result.deployedHostD = false;
    } else if (auto3.status === "CRITICAL") {
      result.action = "auto-merged-deploy-critical";
      result.reason = `merge on main retained; AUTO-3 CRITICAL run=${auto3.auto3RunId || "n/a"} — owner action required`;
      result.deployedHostD = false;
    } else {
      // FAILED / BLOCKED / other — durable terminal, no retry loop
      result.action = "auto-merged-deploy-failed";
      result.reason = `merge on main retained; AUTO-3 status=${auto3.status} run=${auto3.auto3RunId || "n/a"} handoff=${auto3.handoffId || "n/a"}`;
      result.deployedHostD = false;
    }
  } else if (!mutatedMain) {
    // Disposable-base proof merge: resolve tip of base for callers that mock AUTO-3
    const tip = runGh(["api", `repos/${input.repo}/commits/${pr.baseRefName}`, "--jq", ".sha"]);
    if (tip.status === 0 && /^[0-9a-f]{40}$/i.test(tip.stdout.trim())) {
      result.mergedMainSha = tip.stdout.trim().toLowerCase();
    }
  }

  return result;
}

/**
 * @param {(args: string[], env?: NodeJS.ProcessEnv) => {status:number,stdout:string,stderr:string}} runGh
 * @param {string} repo
 * @param {string} prNumber
 * @param {{
 *   pollMs?: number,
 *   timeoutMs?: number,
 *   profile?: string,
 *   deploymentReason?: string,
 *   skipWait?: boolean,
 *   handoffNonce?: string,
 *   githubRunId?: string,
 *   githubRunAttempt?: string,
 *   nowMs?: number,
 *   sleep?: (ms: number) => void,
 * }} [opts]
 */
export function dispatchAndAwaitAuto3(runGh, repo, prNumber, opts = {}) {
  /*
  FNXC:AppsolinoAuto3Handoff 2026-08-01-06:45:
  Exact handoff correlation. Never select an older AUTO-3 run via display_title
  or newest-run fallback. Poll until the run-name containing handoff_id appears.
  */
  const tip = runGh(["api", `repos/${repo}/commits/main`, "--jq", ".sha"]);
  if (tip.status !== 0 || !/^[0-9a-f]{40}$/i.test(tip.stdout.trim())) {
    return {
      status: "BLOCKED",
      reasons: ["unable to resolve main tip after merge"],
      sourceSha: null,
      handoffId: null,
      auto3RunId: null,
      conclusion: null,
    };
  }
  const sourceSha = tip.stdout.trim().toLowerCase();
  const profile = opts.profile === "proof" ? "proof" : "staging";
  const deploymentReason = opts.deploymentReason || "auto2-low-risk-merge";
  const handoffId = buildAuto3HandoffId({
    githubRunId: opts.githubRunId,
    attempt: opts.githubRunAttempt,
    sourceSha,
    nonce: opts.handoffNonce,
  });
  const dispatchStartedAtMs = opts.nowMs ?? Date.now();
  const dispatch = runGh([
    "workflow", "run", "upstream-auto3-deploy.yml",
    "--repo", repo,
    "-f", `source_sha=${sourceSha}`,
    "-f", `source_pr=${prNumber}`,
    "-f", `deployment_reason=${deploymentReason}`,
    "-f", `profile=${profile}`,
    "-f", "force_smoke_fail=false",
    "-f", `expected_merged_sha=${sourceSha}`,
    "-f", `handoff_id=${handoffId}`,
  ]);
  if (dispatch.status !== 0) {
    return {
      status: "BLOCKED",
      reasons: [`AUTO-3 dispatch failed: ${dispatch.stderr || dispatch.stdout}`],
      sourceSha,
      handoffId,
      auto3RunId: null,
      conclusion: null,
    };
  }

  if (opts.skipWait === true) {
    return {
      status: "DISPATCHED",
      reasons: ["wait skipped"],
      sourceSha,
      handoffId,
      auto3RunId: null,
      conclusion: null,
    };
  }

  const pollMs = opts.pollMs ?? 15_000;
  const timeoutMs = opts.timeoutMs ?? 3_600_000;
  const sleepFn = opts.sleep ?? ((ms) => {
    spawnSync("sleep", [String(Math.max(1, Math.floor(ms / 1000)))]);
  });
  const started = Date.now();
  /** @type {string|null} */
  let runId = null;
  while (Date.now() - started < timeoutMs) {
    if (!runId) {
      const list = runGh([
        "api",
        `repos/${repo}/actions/workflows/upstream-auto3-deploy.yml/runs?event=workflow_dispatch&per_page=30`,
      ]);
      if (list.status === 0) {
        let payload;
        try {
          payload = JSON.parse(list.stdout || "{}");
        } catch {
          payload = {};
        }
        const hit = selectCorrelatedAuto3Run(payload.workflow_runs || [], {
          handoffId,
          dispatchStartedAtMs,
          sourceSha,
        });
        if (hit) runId = String(hit.id);
      }
      // No newest-run fallback. Keep polling until the exact handoff appears.
    }
    if (runId) {
      const view = runGh([
        "api",
        `repos/${repo}/actions/runs/${runId}`,
        "--jq",
        "{status:.status,conclusion:.conclusion}",
      ]);
      if (view.status === 0) {
        try {
          const st = JSON.parse(view.stdout);
          if (st.status === "completed") {
            let terminalMarker = null;
            const logs = runGh([
              "run", "view", runId,
              "--repo", repo,
              "--log",
            ]);
            if (logs.status === 0) terminalMarker = parseAuto3TerminalMarker(logs.stdout || logs.stderr || "");
            const mapped = mapAuto3RunToTerminal({
              status: st.status,
              conclusion: st.conclusion,
              terminalMarker,
            });
            return {
              status: mapped.deploymentStatus,
              reasons: mapped.deploymentStatus === "DEPLOYED" || mapped.deploymentStatus === "IDEMPOTENT_NOOP"
                ? []
                : [`AUTO-3 ${mapped.deploymentStatus}`],
              sourceSha,
              handoffId,
              auto3RunId: runId,
              conclusion: st.conclusion ?? null,
            };
          }
        } catch {
          // continue polling
        }
      }
    }
    sleepFn(pollMs);
  }
  return {
    status: "BLOCKED",
    reasons: ["AUTO-3 wait timeout — correlated run never appeared or never completed"],
    sourceSha,
    handoffId,
    auto3RunId: runId,
    conclusion: null,
  };
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
    else if (a === "--require-sensitive-approval") out.requireSensitiveApproval = true;
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
    process.stdout.write(
      "Usage: auto2-finalize.mjs --repo owner/name --pr N --validated-head SHA "
      + "[--validation-conclusion X] [--approved-head SHA] [--require-sensitive-approval] "
      + "[--owner-approved] [--auto3-profile staging|proof] [--dry-run] [--json]\n"
      + "Note: --owner-approved alone never authorizes a sensitive merge.\n",
    );
    process.exit(args.help ? 0 : 2);
  }
  try {
    const result = runAuto2Finalize({
      repo: String(args.repo),
      prNumber: String(args.pr),
      validatedHeadSha: String(args["validated-head"] || ""),
      approvedHead: args["approved-head"] ? String(args["approved-head"]) : undefined,
      validationConclusion: args["validation-conclusion"] ? String(args["validation-conclusion"]) : undefined,
      ownerApproved: args.ownerApproved === true,
      requireSensitiveApproval: args.requireSensitiveApproval === true,
      auto3Profile: args["auto3-profile"] ? String(args["auto3-profile"]) : undefined,
      allowMissingApp: args.allowMissingApp === true,
      dryRun: args.dryRun === true,
      executeCandidateCode: false,
    });
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`${result.action} risk=${result.classification?.riskClass ?? "-"}\n`);
    process.exit(result.action === "blocked" || String(result.action).includes("deploy-failed")
      || String(result.action).includes("deploy-critical") || String(result.action).includes("rolled-back")
      ? 2
      : 0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
