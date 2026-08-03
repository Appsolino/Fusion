#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-03:
 * Hourly/live reconciliation with real handoff relationships (not handoffs:[]).
 * CLI entrypoint only — shared evidence helpers live in live-evidence.mjs.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { buildHandoffsFromRuns, isAuto2ParentWorkflow, isAuto3Workflow } from "./build-handoffs.mjs";
import { reconcileRuns } from "./reconcile-runs.mjs";
import { downloadAuto3EvidenceArtifact } from "./live-evidence.mjs";

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

function ghText(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/**
 * Schedule / manual reconcile body. Does not require a workflow run id.
 * @param {{
 *   repo: string,
 *   out?: string,
 *   upsertOut?: string,
 *   nowMs?: number,
 *   listRuns?: () => { ok: boolean, data: any },
 *   listAuto3Dispatch?: () => { ok: boolean, data: any },
 *   downloadEvidence?: typeof downloadAuto3EvidenceArtifact,
 *   fetchRunLog?: (repo: string, runId: string|number) => string,
 * }} opts
 */
export function executeLiveReconcile(opts) {
  const {
    repo,
    out,
    upsertOut,
    nowMs = Date.now(),
    listRuns = () =>
      ghJson([
        "api",
        `repos/${repo}/actions/runs?per_page=50`,
      ]),
    listAuto3Dispatch = () =>
      ghJson([
        "api",
        `repos/${repo}/actions/workflows/upstream-auto3-deploy.yml/runs?event=workflow_dispatch&per_page=30`,
      ]),
    downloadEvidence = downloadAuto3EvidenceArtifact,
    fetchRunLog = (r, runId) => {
      const logs = ghText(["run", "view", String(runId), "--repo", r, "--log"]);
      return (logs.stdout || "").slice(0, 200_000);
    },
  } = opts;
  if (!repo) throw new Error("require --repo");

  const runsResp = listRuns();
  const all = runsResp.data?.workflow_runs || [];
  const auto2Runs = all.filter((r) => isAuto2ParentWorkflow(r.name || ""));
  const auto3Runs = all.filter((r) => isAuto3Workflow(r.name || ""));

  const auto3Dispatch = listAuto3Dispatch();
  const mergedAuto3 = [...auto3Runs];
  for (const r of auto3Dispatch.data?.workflow_runs || []) {
    if (!mergedAuto3.some((x) => String(x.id) === String(r.id))) mergedAuto3.push(r);
  }

  const work = join(tmpdir(), `steward-reconcile-${nowMs}`);
  mkdirSync(work, { recursive: true });
  /** @type {Record<string, object>} */
  const evidenceByRunId = {};
  for (const r of mergedAuto3.slice(0, 15)) {
    if (String(r.status) !== "completed") continue;
    const ev = downloadEvidence(repo, r.id, join(work, String(r.id)));
    if (ev) evidenceByRunId[String(r.id)] = ev;
  }

  /** @type {Record<string, string>} */
  const logsByRunId = {};
  for (const r of auto2Runs.slice(0, 20)) {
    if (String(r.status) !== "completed") continue;
    try {
      logsByRunId[String(r.id)] = fetchRunLog(repo, r.id);
    } catch {
      // Log fetch failures must not crash reconcile; action may stay unknown.
    }
  }

  const handoffs = buildHandoffsFromRuns({
    auto2Runs,
    auto3Runs: mergedAuto3,
    evidenceByRunId,
    logsByRunId,
    nowMs,
  });

  const once = reconcileRuns({
    nowMs,
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

  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (upsertOut) {
    mkdirSync(dirname(upsertOut), { recursive: true });
    writeFileSync(upsertOut, `${JSON.stringify({ candidates: once.candidates }, null, 2)}\n`);
  }

  return payload;
}

export async function runLiveReconcileMain(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("require --repo");

  const payload = executeLiveReconcile({
    repo,
    out: args.out,
    upsertOut: args["upsert-out"],
  });

  if (!args.out && !args["upsert-out"]) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  return payload;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runLiveReconcileMain().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
