#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-05:
 * Push repair branch + open one PR via Automation App identity.
 */
import { spawnSync } from "node:child_process";
import { assertS1bAppToken, ALLOWED_REPO, resolveS1bAppToken } from "./policy.mjs";

/**
 * @param {{
 *   worktreePath: string,
 *   branchName: string,
 *   remote?: string,
 *   token?: string,
 *   env?: NodeJS.ProcessEnv,
 *   gitPushFn?: (args: string[], opts: object) => { status: number, stdout: string, stderr: string },
 * }} input
 */
export function pushRepairBranch(input) {
  const env = input.env || process.env;
  const token = input.token || assertS1bAppToken(env);
  const remote = input.remote || "origin";
  const pushFn =
    input.gitPushFn ||
    ((args, opts) => {
      const r = spawnSync("git", ["-c", "safe.directory=*", ...args], {
        cwd: opts.cwd,
        encoding: "utf8",
        env: opts.env,
      });
      return {
        status: r.status ?? 1,
        stdout: (r.stdout || "").trim(),
        stderr: (r.stderr || "").trim(),
      };
    });

  // Authenticated push without writing credentials to disk permanently.
  const pushEnv = {
    PATH: env.PATH,
    HOME: env.HOME,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  };

  const result = pushFn(
    ["push", "-u", remote, `HEAD:refs/heads/${input.branchName}`],
    { cwd: input.worktreePath, env: pushEnv },
  );
  if (result.status !== 0) {
    throw new Error(
      `S1B git push failed: ${(result.stderr || result.stdout || "").slice(0, 400)}`,
    );
  }
  return { pushed: true, branchName: input.branchName };
}

/**
 * @param {{
 *   issueNumber: number,
 *   fingerprint: string,
 *   occurrence: string,
 *   branchName: string,
 *   assessment?: object,
 *   repairHeadSha?: string,
 *   repairSummary?: string,
 * }} p
 */
export function buildRepairPrBody(p) {
  const risk = String(p.assessment?.risk || "SENSITIVE");
  return `## Steward S1B repair PR

| Field | Value |
| --- | --- |
| Incident | #${p.issueNumber} |
| Fingerprint | \`${p.fingerprint}\` |
| Occurrence | \`${p.occurrence}\` |
| Branch | \`${p.branchName}\` |
| Repair HEAD | \`${p.repairHeadSha || "n/a"}\` |
| Risk | ${risk} |
| Merge in S1B | **NO** |
| Host P | PROHIBITED |
| Deploy authority | NONE |

### Repair summary
${p.repairSummary || p.assessment?.recommendedSolution || "_see assessment_"}

---
Opened by Steward S1B via Appsolino Automation App.
Dual Cursor review required before exact-head merge (s2/s3 gates).
S1B does not merge and does not deploy.
`;
}

/**
 * @param {{
 *   branchName: string,
 *   issueNumber: number,
 *   fingerprint: string,
 *   occurrence: string,
 *   assessment?: object,
 *   repairHeadSha?: string,
 *   repairSummary?: string,
 *   base?: string,
 *   repo?: string,
 *   token?: string,
 *   env?: NodeJS.ProcessEnv,
 *   gh?: (args: string[]) => { status: number, stdout: string, stderr: string },
 *   title?: string,
 * }} input
 */
export function createOrReuseRepairPr(input) {
  const env = input.env || process.env;
  const token = input.token || assertS1bAppToken(env);
  const repo = input.repo || env.GITHUB_REPOSITORY || ALLOWED_REPO;
  if (repo !== ALLOWED_REPO) {
    throw new Error(`S1B cross-repository target rejected: ${repo}`);
  }

  const gh =
    input.gh ||
    ((args) => {
      const result = spawnSync("gh", args, {
        encoding: "utf8",
        env: {
          ...env,
          GH_TOKEN: token,
          // Prefer isolated config dir so owner OAuth is not the routine identity.
          GH_CONFIG_DIR: env.S1B_GH_CONFIG_DIR || env.AUTO1_GH_CONFIG_DIR || env.GH_CONFIG_DIR,
        },
      });
      return {
        status: result.status ?? 1,
        stdout: (result.stdout || "").trim(),
        stderr: (result.stderr || "").trim(),
      };
    });

  const existing = gh([
    "pr",
    "list",
    "--repo",
    repo,
    "--head",
    input.branchName,
    "--state",
    "open",
    "--json",
    "number,url,headRefOid",
  ]);
  if (existing.status !== 0) {
    throw new Error(`gh pr list failed: ${existing.stderr || existing.stdout}`);
  }
  const openPrs = JSON.parse(existing.stdout || "[]");
  if (Array.isArray(openPrs) && openPrs.length > 0) {
    return {
      created: false,
      reused: true,
      prNumber: Number(openPrs[0].number),
      prUrl: String(openPrs[0].url),
      headSha: String(openPrs[0].headRefOid || input.repairHeadSha || ""),
    };
  }

  const title =
    input.title ||
    `S1B repair: issue #${input.issueNumber} (${String(input.fingerprint).slice(0, 12)})`;
  const body = buildRepairPrBody(input);
  const created = gh([
    "pr",
    "create",
    "--repo",
    repo,
    "--base",
    input.base || "main",
    "--head",
    input.branchName,
    "--title",
    title,
    "--body",
    body,
  ]);
  if (created.status !== 0) {
    throw new Error(`gh pr create failed: ${created.stderr || created.stdout}`);
  }
  const prUrl = created.stdout;
  const numberMatch = prUrl.match(/\/pull\/(\d+)/);
  return {
    created: true,
    reused: false,
    prNumber: numberMatch ? Number(numberMatch[1]) : null,
    prUrl,
    headSha: input.repairHeadSha || "",
  };
}

export { resolveS1bAppToken };
