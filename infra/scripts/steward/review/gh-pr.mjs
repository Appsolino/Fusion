#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardReview 2026-08-04:
 * Fetch PR metadata compatible with gh CLI that lacks baseRefOid (e.g. 2.45).
 * head/state/checks via `gh pr view`; base SHA via REST pulls API.
 */
import { spawnSync } from "node:child_process";

/**
 * @param {string[]} args
 * @param {{ token?: string }} [opts]
 */
export function ghJson(args, opts = {}) {
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
 *   repo: string,
 *   token?: string,
 * }} input
 * @returns {{
 *   number: number,
 *   state: string,
 *   baseRefOid: string,
 *   headRefOid: string,
 *   baseRefName: string,
 *   headRefName: string,
 *   url: string,
 *   statusCheckRollup: object[],
 * }}
 */
export function fetchPullRequestMeta(input) {
  const view = ghJson(
    [
      "pr",
      "view",
      String(input.prNumber),
      "--repo",
      input.repo,
      // Intentionally omit baseRefOid — unavailable on gh 2.45 runners.
      "--json",
      "number,state,headRefOid,baseRefName,headRefName,url,statusCheckRollup",
    ],
    { token: input.token },
  );

  const rest = ghJson(
    ["api", `repos/${input.repo}/pulls/${input.prNumber}`],
    { token: input.token },
  );

  const headRefOid = String(view.headRefOid || rest?.head?.sha || "");
  const baseRefOid = String(rest?.base?.sha || "");
  if (!/^[0-9a-f]{40}$/i.test(headRefOid)) {
    throw new Error(`PR head SHA missing/invalid: ${headRefOid || "(empty)"}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(baseRefOid)) {
    throw new Error(`PR base SHA missing/invalid: ${baseRefOid || "(empty)"}`);
  }
  if (rest?.head?.sha && String(rest.head.sha) !== headRefOid) {
    throw new Error(
      `PR head mismatch view=${headRefOid} rest=${rest.head.sha}`,
    );
  }

  return {
    number: Number(view.number || input.prNumber),
    state: String(view.state || rest?.state || "").toUpperCase(),
    baseRefOid,
    headRefOid,
    baseRefName: String(view.baseRefName || rest?.base?.ref || ""),
    headRefName: String(view.headRefName || rest?.head?.ref || ""),
    url: String(view.url || rest?.html_url || ""),
    statusCheckRollup: Array.isArray(view.statusCheckRollup)
      ? view.statusCheckRollup
      : [],
  };
}
