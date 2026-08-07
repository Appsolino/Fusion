#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamLatency 2026-08-07-14:20:
 * pnpm appsolino:maintenance-latency-report — scientific latency summary from
 * audit extracts + maintenance-latency-*.json artifacts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLatencyArtifacts, fmtMs } from "./latency-tracker.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

/**
 * @param {number[]} values
 */
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * @param {number[]} values
 */
function stats(values) {
  if (!values.length) return { n: 0, avg: null, p50: null, p90: null, p95: null, max: null, sum: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    n: values.length,
    avg: Math.round(sum / values.length),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    max: Math.max(...values),
    sum,
  };
}

/**
 * @param {{ proofsDir?: string, auditPath?: string, limit?: number }} [opts]
 */
export function buildMaintenanceLatencyReport(opts = {}) {
  const proofsDir = opts.proofsDir || join(repoRoot, ".appsolino/proofs");
  const auditPath = opts.auditPath || join(proofsDir, "latency-audit-expert-runs.json");
  const limit = Math.max(1, Number(opts.limit || 20));

  /** @type {object[]} */
  let runs = [];
  if (existsSync(auditPath)) {
    try {
      const raw = JSON.parse(readFileSync(auditPath, "utf8"));
      runs = Array.isArray(raw) ? raw : raw.runs || [];
    } catch {
      runs = [];
    }
  }
  const artifacts = loadLatencyArtifacts(proofsDir);
  const recentArtifacts = artifacts.slice(-limit);

  const queue = runs.map((r) => Number(r.runnerQueueMs ?? r.queueMs ?? 0)).filter((n) => Number.isFinite(n));
  const expert = runs.map((r) => Number(r.expertStepMs ?? r.expertLatencyMs ?? 0)).filter((n) => n > 0);
  const wall = runs.map((r) => Number(r.wallClockMs ?? r.totalWallClockMs ?? r.wallMs ?? 0)).filter((n) => n > 0);

  const slowest = [...runs]
    .filter((r) => Number(r.wallClockMs ?? r.totalWallClockMs ?? r.wallMs ?? 0) > 0)
    .sort(
      (a, b) =>
        Number(b.wallClockMs ?? b.totalWallClockMs ?? b.wallMs) -
        Number(a.wallClockMs ?? a.totalWallClockMs ?? a.wallMs),
    )
    .slice(0, 5)
    .map((r) => ({
      runId: r.runId || r.id,
      wallMs: r.wallClockMs ?? r.totalWallClockMs ?? r.wallMs,
      queueMs: r.runnerQueueMs ?? r.queueMs,
      expertMs: r.expertStepMs ?? r.expertLatencyMs,
      notes: r.notes || r.conclusion || null,
    }));

  const classificationMinutes = {};
  for (const a of recentArtifacts) {
    for (const c of a.latencyClassification || []) {
      classificationMinutes[c] = (classificationMinutes[c] || 0) + (a.wastedMs || 0) / 60_000;
    }
  }

  return {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    sample: {
      auditRuns: runs.length,
      latencyArtifacts: recentArtifacts.length,
      limit,
    },
    totals: {
      wall: stats(wall),
      runnerQueue: stats(queue),
      expertStep: stats(expert),
    },
    slowestFive: slowest,
    artifactClassifications: classificationMinutes,
    proposedSlos: {
      runnerQueueP95Ms: 60_000,
      normalCycleTargetMs: 8 * 60_000,
      sensitiveReviewTargetMs: 12 * 60_000,
      repairCycleTargetMs: 12 * 60_000,
      expertPhaseMs: 6 * 60_000,
      verifierPhaseMs: 4 * 60_000,
      hardCycleMs: 20 * 60_000,
    },
  };
}

/**
 * @param {ReturnType<typeof buildMaintenanceLatencyReport>} report
 */
export function formatMaintenanceLatencyReport(report) {
  const t = report.totals;
  const lines = [
    "APPSOLINO MAINTENANCE LATENCY REPORT",
    `generated: ${report.generatedAt}`,
    `audit runs: ${report.sample.auditRuns} | artifacts: ${report.sample.latencyArtifacts}`,
    "",
    `median total duration:  ${t.wall.p50 != null ? fmtMs(t.wall.p50) : "n/a"}`,
    `p95 total duration:     ${t.wall.p95 != null ? fmtMs(t.wall.p95) : "n/a"}`,
    `median runner queue:    ${t.runnerQueue.p50 != null ? fmtMs(t.runnerQueue.p50) : "n/a"}`,
    `p95 runner queue:       ${t.runnerQueue.p95 != null ? fmtMs(t.runnerQueue.p95) : "n/a"}`,
    `median expert step:     ${t.expertStep.p50 != null ? fmtMs(t.expertStep.p50) : "n/a"}`,
    "",
    "Slowest five (audit):",
    ...report.slowestFive.map(
      (s) =>
        `  ${s.runId}: wall=${fmtMs(s.wallMs)} queue=${fmtMs(s.queueMs || 0)} expert=${fmtMs(s.expertMs || 0)} ${s.notes || ""}`,
    ),
    "",
    "Proposed SLOs:",
    `  runner queue p95 <= ${fmtMs(report.proposedSlos.runnerQueueP95Ms)}`,
    `  hard cycle <= ${fmtMs(report.proposedSlos.hardCycleMs)}`,
  ];
  return lines.join("\n");
}

function main() {
  const json = process.argv.includes("--json");
  const report = buildMaintenanceLatencyReport();
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatMaintenanceLatencyReport(report)}\n`);
  }
}

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main();
}
