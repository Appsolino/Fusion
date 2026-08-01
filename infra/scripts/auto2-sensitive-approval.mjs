#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto2SensitiveApproval 2026-08-01-04:55:
 * Trusted exact-head owner-approval verification for AUTO-2 sensitive upstream PRs.
 * A raw --owner-approved CLI flag is never sufficient authorization. The trusted
 * workflow must independently verify a GitHub APPROVED review from Anas966 that
 * applies to the exact current head commit, with required checks green.
 * Candidate code never runs here and never receives App / Host D secrets.
 */
import { fileURLToPath } from "node:url";

/** Owner login authorized to approve sensitive AUTO-2 merges. */
export const SENSITIVE_OWNER_LOGINS = Object.freeze(["Anas966"]);

/**
 * @param {string} headRefName
 */
export function isSensitiveApprovalHead(headRefName) {
  return /^automation\/upstream-[A-Za-z0-9._/-]+$/.test(String(headRefName || ""));
}

/**
 * Pure evaluation of exact-head owner approval. Fail closed on ambiguity.
 *
 * @param {object} input
 * @param {string} input.currentHead
 * @param {string} input.approvedHead
 * @param {Array<{state?: string, user?: {login?: string}, commit_id?: string, submitted_at?: string, id?: number}>} input.reviews
 * @param {string[]} [input.requiredLogins]
 * @param {string} [input.checksConclusion] success|failure|pending|…
 * @param {string} [input.prState] OPEN|MERGED|CLOSED
 * @param {string} [input.headRefName]
 * @param {boolean} [input.booleanOwnerApprovedFlag] CLI/flag-only claim — insufficient alone
 */
export function evaluateExactHeadOwnerApproval(input) {
  const reasons = [];
  const currentHead = String(input.currentHead || "").trim().toLowerCase();
  const approvedHead = String(input.approvedHead || "").trim().toLowerCase();
  const requiredLogins = (input.requiredLogins || SENSITIVE_OWNER_LOGINS).map((s) => s.toLowerCase());

  if (!/^[0-9a-f]{40}$/.test(currentHead)) reasons.push("current head must be a full 40-char SHA");
  if (!/^[0-9a-f]{40}$/.test(approvedHead)) reasons.push("approved_head must be a full 40-char SHA");
  if (currentHead && approvedHead && currentHead !== approvedHead) {
    reasons.push("approved_head does not equal current PR head (stale approval or head moved)");
  }
  if (input.prState && String(input.prState).toUpperCase() === "MERGED") {
    return {
      ok: false,
      idempotentMerged: true,
      reasons: ["PR already merged — treat as idempotent no-op at caller"],
      matchingReview: null,
    };
  }
  if (input.prState && String(input.prState).toUpperCase() !== "OPEN") {
    reasons.push(`PR state must be OPEN (got ${input.prState})`);
  }
  if (input.headRefName != null && !isSensitiveApprovalHead(input.headRefName)) {
    reasons.push("head ref must be automation/upstream-*");
  }
  const checks = String(input.checksConclusion || "").toLowerCase();
  if (!checks || checks === "pending" || checks === "") {
    reasons.push("required checks missing or pending for approved_head");
  } else if (checks !== "success") {
    reasons.push(`required checks not successful (conclusion=${checks})`);
  }

  const reviews = Array.isArray(input.reviews) ? input.reviews : [];
  if (!reviews.length) {
    reasons.push("no pull-request reviews present");
  }

  /** @type {typeof reviews[0] | null} */
  let matchingReview = null;
  for (const rev of reviews) {
    const state = String(rev?.state || "").toUpperCase();
    const login = String(rev?.user?.login || "").toLowerCase();
    const commitId = String(rev?.commit_id || "").trim().toLowerCase();
    if (state !== "APPROVED") continue;
    if (!requiredLogins.includes(login)) {
      // Unauthorized APPROVED reviews are recorded but never authorize merge.
      continue;
    }
    if (commitId !== currentHead || commitId !== approvedHead) {
      // Approval for an older/other SHA — not valid for this head.
      continue;
    }
    matchingReview = rev;
    break;
  }

  if (!matchingReview) {
    const unauthorized = reviews.some(
      (r) => String(r?.state || "").toUpperCase() === "APPROVED"
        && !requiredLogins.includes(String(r?.user?.login || "").toLowerCase()),
    );
    const staleOwner = reviews.some(
      (r) => String(r?.state || "").toUpperCase() === "APPROVED"
        && requiredLogins.includes(String(r?.user?.login || "").toLowerCase())
        && String(r?.commit_id || "").trim().toLowerCase() !== currentHead,
    );
    if (unauthorized && !staleOwner) reasons.push("APPROVED review exists but not from authorized owner Anas966");
    else if (staleOwner) reasons.push("owner APPROVED review does not apply to the exact current head commit");
    else reasons.push("missing APPROVED review from Anas966 for the exact current head");
  }

  /*
  FNXC:AppsolinoAuto2SensitiveApproval 2026-08-01-04:55:
  Boolean --owner-approved is a non-authoritative hint only. If the flag is set
  without a matching GitHub review, fail closed as blocked (not approval-required),
  so operators cannot launder sensitive merges through a CLI switch.
  */
  if (input.booleanOwnerApprovedFlag === true && !matchingReview) {
    reasons.push("boolean ownerApproved flag without verified GitHub review is not authorization");
  }

  // Deduplicate reasons while preserving order
  const uniq = [...new Set(reasons)];
  return {
    ok: uniq.length === 0 && Boolean(matchingReview),
    idempotentMerged: false,
    reasons: uniq,
    matchingReview,
  };
}

/**
 * Fetch PR reviews via gh API helper.
 * @param {(args: string[], env?: NodeJS.ProcessEnv) => {status:number,stdout:string,stderr:string}} runGh
 * @param {string} repo
 * @param {string|number} prNumber
 */
export function fetchPullRequestReviews(runGh, repo, prNumber) {
  const res = runGh([
    "api",
    `repos/${repo}/pulls/${prNumber}/reviews`,
    "--paginate",
  ]);
  if (res.status !== 0) {
    return { ok: false, reviews: [], error: res.stderr || res.stdout || "reviews fetch failed" };
  }
  try {
    const parsed = JSON.parse(res.stdout || "[]");
    return { ok: true, reviews: Array.isArray(parsed) ? parsed : [], error: null };
  } catch (error) {
    return { ok: false, reviews: [], error: `reviews JSON parse failed: ${error}` };
  }
}

/**
 * Summarize required check conclusion for a head SHA (fail closed).
 * @param {(args: string[], env?: NodeJS.ProcessEnv) => {status:number,stdout:string,stderr:string}} runGh
 * @param {string} repo
 * @param {string|number} prNumber
 * @param {string} headSha
 */
export function resolveRequiredChecksConclusion(runGh, repo, prNumber, headSha) {
  const view = runGh([
    "pr", "view", String(prNumber),
    "--repo", repo,
    "--json", "statusCheckRollup,headRefOid",
  ]);
  if (view.status !== 0) return { conclusion: "failure", reasons: ["unable to read PR checks"] };
  let data;
  try {
    data = JSON.parse(view.stdout || "{}");
  } catch {
    return { conclusion: "failure", reasons: ["checks JSON parse failed"] };
  }
  if (String(data.headRefOid || "").toLowerCase() !== String(headSha || "").toLowerCase()) {
    return { conclusion: "failure", reasons: ["check rollup head mismatch"] };
  }
  const rollup = Array.isArray(data.statusCheckRollup) ? data.statusCheckRollup : [];
  if (!rollup.length) {
    return { conclusion: "pending", reasons: ["no status checks on PR"] };
  }
  const relevant = rollup.filter((c) => {
    const st = String(c?.status || "").toUpperCase();
    // Ignore queued-only noise from unrelated contexts when conclusion present
    return st === "COMPLETED" || c?.conclusion != null || st === "IN_PROGRESS" || st === "QUEUED" || st === "PENDING";
  });
  if (relevant.some((c) => ["IN_PROGRESS", "QUEUED", "PENDING", ""].includes(String(c?.status || "").toUpperCase()) && !c?.conclusion)) {
    return { conclusion: "pending", reasons: ["checks still running"] };
  }
  const failed = relevant.some((c) => {
    const conc = String(c?.conclusion || "").toUpperCase();
    return conc && conc !== "SUCCESS" && conc !== "SKIPPED" && conc !== "NEUTRAL";
  });
  if (failed) return { conclusion: "failure", reasons: ["one or more required checks failed"] };
  const anySuccess = relevant.some((c) => String(c?.conclusion || "").toUpperCase() === "SUCCESS");
  if (!anySuccess) return { conclusion: "pending", reasons: ["no successful required checks"] };
  return { conclusion: "success", reasons: [] };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  process.stdout.write("auto2-sensitive-approval.mjs is a library; invoke via auto2-finalize / approve workflow.\n");
  process.exit(2);
}
