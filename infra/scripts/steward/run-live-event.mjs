#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-02-04:55:
 * Live workflow_run observation: fetch logs + AUTO-3 evidence artifact as data,
 * then evaluate parent/child/evidence disagreement (PR #55 class).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { evaluateLiveObservation } from "./evaluate-live.mjs";
import { extractHandoffIdFromRun, extractSourceShaFromRun, isAuto2ParentWorkflow, isAuto3Workflow } from "./build-handoffs.mjs";

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    return { ok: false, stdout: r.stdout || "", stderr: r.stderr || "" };
  }
  try {
    return { ok: true, data: JSON.parse(r.stdout || "null"), stdout: r.stdout };
  } catch {
    return { ok: true, data: null, stdout: r.stdout || "" };
  }
}

function ghText(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/**
 * Download auto3-evidence-* artifact for a run into destDir; return parsed JSON or null.
 * @param {string} repo
 * @param {string|number} runId
 * @param {string} destDir
 */
export function downloadAuto3EvidenceArtifact(repo, runId, destDir) {
  mkdirSync(destDir, { recursive: true });
  const list = ghJson([
    "api",
    `repos/${repo}/actions/runs/${runId}/artifacts?per_page=50`,
  ]);
  if (!list.ok || !list.data?.artifacts) return null;
  const art = (list.data.artifacts || []).find((a) => String(a.name || "").startsWith("auto3-evidence-"));
  if (!art) return null;
  const dl = spawnSync(
    "gh",
    ["api", `repos/${repo}/actions/artifacts/${art.id}/zip`],
    { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
  );
  if (dl.status !== 0 || !dl.stdout?.length) return null;
  const zipPath = join(destDir, "evidence.zip");
  writeFileSync(zipPath, dl.stdout);
  const unzip = spawnSync("unzip", ["-o", zipPath, "-d", destDir], { encoding: "utf8" });
  if (unzip.status !== 0) return null;
  const jsonPath = join(destDir, "auto3-evidence.json");
  if (!existsSync(jsonPath)) {
    // search one level
    for (const name of readdirSync(destDir)) {
      if (name.endsWith(".json")) {
        try {
          return JSON.parse(readFileSync(join(destDir, name), "utf8"));
        } catch {
          // continue
        }
      }
    }
    return null;
  }
  try {
    return JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  const runId = args["run-id"];
  const workflowName = args["workflow-name"] || "";
  const attempt = args.attempt || "1";
  const conclusion = args.conclusion || "";
  const headSha = args["head-sha"] || "";
  if (!repo || !runId) throw new Error("require --repo and --run-id");

  const work = join(tmpdir(), `steward-event-${runId}`);
  mkdirSync(work, { recursive: true });

  const logs = ghText(["run", "view", String(runId), "--repo", repo, "--log"]);
  const logText = (logs.stdout || "").slice(0, 200_000);

  let evidence = null;
  let childRunId = null;
  let parentRunId = null;
  let parentConclusion = null;
  let childConclusion = null;
  let childStatus = null;
  let expectedSourceSha = headSha || null;

  if (isAuto3Workflow(workflowName)) {
    childRunId = runId;
    childConclusion = conclusion;
    childStatus = "completed";
    evidence = downloadAuto3EvidenceArtifact(repo, runId, join(work, "evidence"));
    expectedSourceSha = evidence?.sourceSha || extractSourceShaFromRun({ name: workflowName, head_sha: headSha }) || headSha;
  } else if (isAuto2ParentWorkflow(workflowName)) {
    parentRunId = runId;
    parentConclusion = conclusion;
    const handoff = logText.match(/\b(auto2-[A-Za-z0-9_-]+)\b/)?.[1] || null;
    const sha = logText.match(/\b([0-9a-f]{40})\b/i)?.[1]?.toLowerCase() || headSha || null;
    expectedSourceSha = sha;
    // Find correlated AUTO-3 child by handoff in recent runs
    const list = ghJson([
      "api",
      `repos/${repo}/actions/workflows/upstream-auto3-deploy.yml/runs?event=workflow_dispatch&per_page=30`,
    ]);
    const runs = list.data?.workflow_runs || [];
    let child = null;
    if (handoff) {
      child = runs.find((r) => `${r.name || ""} ${r.display_title || ""}`.includes(handoff)) || null;
    }
    if (!child && sha) {
      child = runs.find((r) => extractSourceShaFromRun(r) === sha) || null;
    }
    // Also parse explicit run= from finalize reason lines
    const runMatch = logText.match(/\brun=(\d+)\b/);
    if (!child && runMatch) {
      child = runs.find((r) => String(r.id) === runMatch[1]) || null;
    }
    if (child) {
      childRunId = String(child.id);
      childConclusion = child.conclusion;
      childStatus = child.status;
      evidence = downloadAuto3EvidenceArtifact(repo, childRunId, join(work, "evidence"));
    }
    void extractHandoffIdFromRun;
  }

  const normalized = evaluateLiveObservation({
    workflowName,
    runId,
    attempt,
    conclusion,
    parentRunId,
    childRunId,
    parentConclusion,
    childConclusion,
    childStatus,
    logText,
    evidenceArtifact: evidence,
    expectedSourceSha,
    expectedReleaseId: evidence?.releaseId || null,
  });

  const result = {
    source: "live-event",
    workflowName,
    runId,
    childRunId,
    parentRunId,
    evidence,
    normalized,
  };
  const candidates = normalized.openIncident ? [normalized] : [];

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (args["upsert-out"]) {
    mkdirSync(dirname(args["upsert-out"]), { recursive: true });
    writeFileSync(args["upsert-out"], `${JSON.stringify({ candidates }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ candidates, result }, null, 2)}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
