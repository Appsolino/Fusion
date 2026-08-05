#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-05:
 * CLI entry for live/dry S1B from trusted main + App token.
 */
import { spawnSync } from "node:child_process";
import { runS1b } from "./run-s1b.mjs";
import { isGateEnabled } from "../activation/resolve-activation.mjs";

function arg(name, fallback = "") {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const issueNumber = Number(arg("issue"));
const occurrence = arg("occurrence");
const dryRun = arg("dry-run", "true") !== "false";
const existingRepairPrRaw = arg("existing-repair-pr", "");
const existingRepairPr = existingRepairPrRaw ? Number(existingRepairPrRaw) : null;
const repo = process.env.GITHUB_REPOSITORY || "Appsolino/Fusion";

if (!issueNumber || !occurrence) {
  throw new Error("--issue and --occurrence required");
}

const issueProc = spawnSync(
  "gh",
  ["issue", "view", String(issueNumber), "--repo", repo, "--json", "body,labels,title"],
  { encoding: "utf8", env: process.env },
);
if (issueProc.status !== 0) {
  throw new Error(`gh issue view failed: ${issueProc.stderr}`);
}
const issue = JSON.parse(issueProc.stdout || "{}");
const body = String(issue.body || "");
const fpMatch = /Fingerprint \| `sha256:([0-9a-f]{64})`/i.exec(body)
  || /fingerprint=([0-9a-f]{64})/i.exec(body);
const fingerprint = fpMatch ? fpMatch[1] : "";
if (!fingerprint) throw new Error("fingerprint not found on issue");

const commentsProc = spawnSync(
  "gh",
  ["api", `repos/${repo}/issues/${issueNumber}/comments`],
  { encoding: "utf8", env: process.env, maxBuffer: 20 * 1024 * 1024 },
);
const comments = JSON.parse(commentsProc.stdout || "[]");
const assessmentComment = [...comments].reverse().find((c) =>
  String(c.body || "").includes("appsolino-s1a-assessment")
  && String(c.body || "").includes(`occurrence=${occurrence}`),
);
if (!assessmentComment) {
  throw new Error(`no S1A assessment comment for occurrence ${occurrence}`);
}

const assessment = {
  repairRecommended: /repair-recommended|repairRecommended["']?\s*:\s*true/i.test(
    assessmentComment.body,
  ) || (issue.labels || []).some((l) => l.name === "steward/repair-recommended"),
  reviewerVerdict: "ACCEPT",
  risk: /risk:\s*SENSITIVE/i.test(assessmentComment.body) ? "SENSITIVE" : "LOW",
  summary: assessmentComment.body.slice(0, 2000),
  rawMarkdown: assessmentComment.body,
};

const result = await runS1b({
  issueNumber,
  occurrence,
  fingerprint,
  assessment,
  existingRepairPr,
  dryRun,
  repo,
  token: process.env.S1B_GITHUB_APP_TOKEN || process.env.GH_TOKEN,
  s1bGateEnabled: isGateEnabled("s1bEnabled"),
  skipDualReview: false,
  cleanup: true,
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
