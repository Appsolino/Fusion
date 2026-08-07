#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamLatency 2026-08-07-17:45:
 * AUTO-1 must not force-rebuild a rolling candidate while SENSITIVE_REVIEW / repair
 * owns the matching live upstream tip. Returns skip=true|false on stdout.
 */
import { spawnSync } from "node:child_process";

function gh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if ((r.status ?? 1) !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`);
  }
  return (r.stdout || "").trim();
}

const repo = process.env.GITHUB_REPOSITORY;
if (!repo) {
  process.stderr.write("GITHUB_REPOSITORY required\n");
  process.exit(2);
}

const live = gh(["api", "repos/Runfusion/Fusion/commits/main", "--jq", ".sha"]).toLowerCase();
process.stderr.write(`live_upstream=${live}\n`);
const prs = JSON.parse(
  gh(["pr", "list", "--repo", repo, "--state", "open", "--limit", "50", "--json", "number,headRefName,labels"]),
);

let active = false;
for (const p of Array.isArray(prs) ? prs : []) {
  const ref = String(p.headRefName || "");
  if (!ref.startsWith("automation/upstream-")) continue;
  const sha = ref.slice("automation/upstream-".length).toLowerCase();
  const labels = new Set((p.labels || []).map((l) => String(l.name || "")));
  const busy =
    labels.has("auto2:sensitive-review") ||
    labels.has("auto2:expert-resolving") ||
    labels.has("auto2:ai-verifying");
  if (busy && (live.startsWith(sha) || sha.startsWith(live.slice(0, 12)))) {
    active = true;
    process.stderr.write(`active_expert_pr=${p.number} labels=${[...labels].sort().join(",")}\n`);
    break;
  }
}

process.stdout.write(active ? "true" : "false");
