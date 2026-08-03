#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-03:
 * Live workflow_run observation: fetch logs + AUTO-3 evidence artifact as data,
 * then evaluate parent/child/evidence disagreement (PR #55 class).
 * CLI entrypoint only — do not import this module for shared helpers.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { evaluateLiveObservation } from "./evaluate-live.mjs";
import { extractHandoffIdFromRun, extractSourceShaFromRun, isAuto2ParentWorkflow, isAuto3Workflow } from "./build-handoffs.mjs";
import { downloadAuto3EvidenceArtifact, fetchWorkflowRunLogText } from "./live-evidence.mjs";

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

export async function runLiveEventMain(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  const runId = args["run-id"];
  const workflowName = args["workflow-name"] || "";
  const attempt = args.attempt || "1";
  const conclusion = args.conclusion || "";
  const headSha = args["head-sha"] || "";
  if (!repo || !runId) throw new Error("require --repo and --run-id");

  const work = join(tmpdir(), `steward-event-${runId}`);
  mkdirSync(work, { recursive: true });

  const logText = fetchWorkflowRunLogText(repo, runId);

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
  return { candidates, result };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runLiveEventMain().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
