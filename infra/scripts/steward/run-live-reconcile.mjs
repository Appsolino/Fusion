#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-02-04:55:
 * Hourly/live reconciliation with real handoff relationships (not handoffs:[]).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildHandoffsFromRuns, isAuto2ParentWorkflow, isAuto3Workflow } from "./build-handoffs.mjs";
import { reconcileRuns } from "./reconcile-runs.mjs";
import { downloadAuto3EvidenceArtifact } from "./run-live-event.mjs";

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
  if (r.status !== 0) return { ok: false, data: null, stderr: r.stderr || "" };
  try {
    return { ok: true, data: JSON.parse(r.stdout || "{}") };
  } catch {
    return { ok: false, data: null, stderr: "json parse failed" };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("require --repo");

  const runsResp = ghJson([
    "api",
    `repos/${repo}/actions/runs?per_page=50`,
  ]);
  const all = runsResp.data?.workflow_runs || [];
  const auto2Runs = all.filter((r) => isAuto2ParentWorkflow(r.name || ""));
  const auto3Runs = all.filter((r) => isAuto3Workflow(r.name || ""));

  // Also pull AUTO-3 workflow_dispatch runs specifically (handoff in run-name).
  const auto3Dispatch = ghJson([
    "api",
    `repos/${repo}/actions/workflows/upstream-auto3-deploy.yml/runs?event=workflow_dispatch&per_page=30`,
  ]);
  const mergedAuto3 = [...auto3Runs];
  for (const r of auto3Dispatch.data?.workflow_runs || []) {
    if (!mergedAuto3.some((x) => String(x.id) === String(r.id))) mergedAuto3.push(r);
  }

  const work = join(tmpdir(), `steward-reconcile-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  /** @type {Record<string, object>} */
  const evidenceByRunId = {};
  for (const r of mergedAuto3.slice(0, 15)) {
    if (String(r.status) !== "completed") continue;
    const ev = downloadAuto3EvidenceArtifact(repo, r.id, join(work, String(r.id)));
    if (ev) evidenceByRunId[String(r.id)] = ev;
  }

  const handoffs = buildHandoffsFromRuns({
    auto2Runs,
    auto3Runs: mergedAuto3,
    evidenceByRunId,
    nowMs: Date.now(),
  });

  const once = reconcileRuns({
    nowMs: Date.now(),
    handoffs,
    recentRuns: all,
  });

  const payload = {
    source: "live-reconcile",
    handoffCount: handoffs.length,
    handoffs,
    once,
    candidates: once.candidates,
  };

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (args["upsert-out"]) {
    mkdirSync(dirname(args["upsert-out"]), { recursive: true });
    writeFileSync(args["upsert-out"], `${JSON.stringify({ candidates: once.candidates }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
