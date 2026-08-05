#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS2 2026-08-05:
 * After exact-head merge, reconcile the originating Steward incident (comment + labels).
 * Never touches Host P. Never dispatches AUTO workflows.
 */
import { spawnSync } from "node:child_process";
import { ALLOWED_REPO } from "./policy.mjs";

/**
 * @param {{
 *   issueNumber: number,
 *   prNumber: number,
 *   headSha: string,
 *   playbookId: string,
 *   fingerprint?: string,
 *   occurrence?: string,
 *   repository?: string,
 *   token?: string,
 *   dryRun?: boolean,
 *   gh?: (argv: string[], env?: NodeJS.ProcessEnv) => { status: number, stdout?: string, stderr?: string },
 * }} input
 */
export function reconcileOriginatingIncident(input) {
  const issueNumber = Number(input.issueNumber);
  const prNumber = Number(input.prNumber);
  const headSha = String(input.headSha || "");
  const repo = input.repository || ALLOWED_REPO;
  const reasons = [];

  if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
    reasons.push("issue-missing");
  }
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    reasons.push("pr-missing");
  }
  if (!/^[0-9a-f]{40}$/i.test(headSha)) {
    reasons.push("head-sha-invalid");
  }
  if (repo !== ALLOWED_REPO) reasons.push("cross-repository-target-rejected");

  if (reasons.length) {
    return { ok: false, action: "reconcile-skipped", reasons };
  }

  const marker = `<!-- appsolino-steward-s2-reconcile: pr-${prNumber}:${headSha.toLowerCase()} -->`;
  const body = [
    marker,
    `## S2 reconcile`,
    "",
    `- Playbook: \`${input.playbookId}\``,
    `- Repair PR: #${prNumber}`,
    `- Merged head: \`${headSha.toLowerCase()}\``,
    input.fingerprint ? `- Fingerprint: \`${input.fingerprint}\`` : null,
    input.occurrence ? `- Occurrence: \`${input.occurrence}\`` : null,
    "",
    "Exact-head merge completed on Appsolino/Fusion. Host P was not accessed.",
    "Labels: remove `steward/repair-recommended`; add `steward/advice-ready` retention is allowed.",
  ]
    .filter(Boolean)
    .join("\n");

  if (input.dryRun) {
    return {
      ok: true,
      action: "reconcile-planned",
      issueNumber,
      prNumber,
      headSha: headSha.toLowerCase(),
      commentBody: body,
      labelsRemove: ["steward/repair-recommended"],
      labelsAdd: ["steward/s2-merged"],
    };
  }

  const gh =
    input.gh ||
    ((argv, env) =>
      spawnSync("gh", argv, {
        encoding: "utf8",
        env: { ...process.env, ...(env || {}), GH_TOKEN: input.token || process.env.GH_TOKEN || "" },
      }));

  const comment = gh(
    ["issue", "comment", String(issueNumber), "--repo", repo, "--body", body],
    {},
  );
  if (comment.status !== 0) {
    return {
      ok: false,
      action: "reconcile-comment-failed",
      reasons: [(comment.stderr || comment.stdout || "").slice(0, 400)],
      issueNumber,
      prNumber,
      headSha: headSha.toLowerCase(),
    };
  }

  // Best-effort label hygiene — failures are recorded, not fatal to merge already done.
  const labelErrors = [];
  const rm = gh(
    [
      "issue",
      "edit",
      String(issueNumber),
      "--repo",
      repo,
      "--remove-label",
      "steward/repair-recommended",
    ],
    {},
  );
  if (rm.status !== 0) {
    labelErrors.push((rm.stderr || rm.stdout || "").slice(0, 200));
  }
  const add = gh(
    [
      "issue",
      "edit",
      String(issueNumber),
      "--repo",
      repo,
      "--add-label",
      "steward/s2-merged",
    ],
    {},
  );
  if (add.status !== 0) {
    labelErrors.push((add.stderr || add.stdout || "").slice(0, 200));
  }

  return {
    ok: true,
    action: "reconciled",
    issueNumber,
    prNumber,
    headSha: headSha.toLowerCase(),
    labelErrors,
  };
}
