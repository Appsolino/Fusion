#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamLatency 2026-08-07-14:05:
 * Permanent latency evidence artifact + 60s heartbeat for expert-maintenance runs.
 * Separates runner queue / setup / AI / stale / protocol so Cursor never lumps them.
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {{
 *   runId?: string,
 *   candidatePr?: number|string|null,
 *   candidateSha?: string|null,
 *   upstreamSha?: string|null,
 *   appsolinoBaseSha?: string|null,
 *   mode?: string,
 *   cycleBudget?: ReturnType<import('./cycle-budget.mjs').createCycleBudget>|null,
 *   triggeredAt?: string,
 *   runnerStartedAt?: string|null,
 *   dispatchDelayMs?: number,
 *   runnerQueueMs?: number,
 *   heartbeatMs?: number,
 *   logFn?: (line: string) => void,
 * }} opts
 */
export function createLatencyTracker(opts = {}) {
  const startedAt = Date.now();
  const heartbeatMs = Math.max(5_000, Number(opts.heartbeatMs ?? 60_000));
  const logFn = opts.logFn || ((line) => console.log(line));
  /** @type {object[]} */
  const phases = [];
  /** @type {string[]} */
  const classifications = [];
  let currentPhase = null;
  let lastActivityAt = startedAt;
  let heartbeatTimer = null;
  let wastedMs = 0;

  const meta = {
    runId: opts.runId || process.env.GITHUB_RUN_ID || `local-${startedAt}`,
    candidatePr: opts.candidatePr ?? null,
    candidateSha: opts.candidateSha || null,
    upstreamSha: opts.upstreamSha || null,
    appsolinoBaseSha: opts.appsolinoBaseSha || null,
    mode: opts.mode || "repair",
    triggeredAt: opts.triggeredAt || new Date(startedAt).toISOString().replace(/\.\d{3}Z$/, "Z"),
    runnerStartedAt: opts.runnerStartedAt || process.env.GITHUB_RUN_STARTED_AT || null,
    dispatchDelayMs: Number(opts.dispatchDelayMs || 0),
    runnerQueueMs: Number(opts.runnerQueueMs || 0),
  };

  function markActivity() {
    lastActivityAt = Date.now();
  }

  function emitHeartbeat() {
    const budget = opts.cycleBudget;
    const phaseElapsed = currentPhase ? Date.now() - currentPhase.startedMs : 0;
    const lines = [
      "LONG-RUN STATUS / maintenance heartbeat",
      `Run: ${meta.runId}`,
      `Candidate: #${meta.candidatePr || "n/a"} sha=${(meta.candidateSha || "").slice(0, 12) || "n/a"}`,
      `Mode: ${meta.mode}`,
      `Elapsed: ${fmtMs(Date.now() - startedAt)}`,
      `Current phase: ${currentPhase ? `${currentPhase.name} attempt ${currentPhase.attempt}` : "idle"}`,
      `Phase elapsed: ${fmtMs(phaseElapsed)}`,
      `Model: ${currentPhase?.model || "n/a"}`,
      `Last activity: ${fmtMs(Date.now() - lastActivityAt)} ago`,
      budget
        ? `Budget: cycle=${fmtMs(budget.cycleBudgetMs)} used=${fmtMs(budget.elapsedMs())} remaining=${fmtMs(budget.remainingMs())}`
        : "Budget: n/a",
      `Classification so far: ${classifications.join(", ") || "none"}`,
    ];
    logFn(lines.join("\n"));
  }

  return {
    meta,
    markActivity,
    /**
     * @param {{ name: string, attempt?: number, model?: string|null, classification?: string|null }} phase
     */
    beginPhase(phase) {
      currentPhase = {
        name: phase.name,
        attempt: phase.attempt ?? 1,
        model: phase.model || null,
        classification: phase.classification || null,
        startedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        startedMs: Date.now(),
        endedAt: null,
        latencyMs: null,
        result: null,
      };
      markActivity();
      if (phase.classification) classifications.push(phase.classification);
    },
    /**
     * @param {{ result?: string, classification?: string|null, wasted?: boolean }} [end]
     */
    endPhase(end = {}) {
      if (!currentPhase) return;
      const endedMs = Date.now();
      currentPhase.endedAt = new Date(endedMs).toISOString().replace(/\.\d{3}Z$/, "Z");
      currentPhase.latencyMs = endedMs - currentPhase.startedMs;
      currentPhase.result = end.result || null;
      if (end.classification) {
        currentPhase.classification = end.classification;
        classifications.push(end.classification);
      }
      if (end.wasted) wastedMs += currentPhase.latencyMs;
      phases.push({ ...currentPhase });
      currentPhase = null;
      markActivity();
    },
    /** @param {string} c */
    classify(c) {
      if (c) classifications.push(c);
    },
    /** @param {number} ms */
    addWastedMs(ms) {
      wastedMs += Math.max(0, Number(ms) || 0);
    },
    startHeartbeat() {
      if (heartbeatTimer) return;
      heartbeatTimer = setInterval(emitHeartbeat, heartbeatMs);
      if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
    },
    stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    },
    /**
     * @param {string} dir
     * @param {object} [extra]
     */
    writeArtifact(dir, extra = {}) {
      mkdirSync(dir, { recursive: true });
      const budget = opts.cycleBudget;
      const artifact = {
        ...meta,
        phases,
        totalWallClockMs: Date.now() - startedAt,
        latencyClassification: [...new Set(classifications)],
        wastedMs,
        cycleBudgetMs: budget?.cycleBudgetMs ?? null,
        remainingBudgetMs: budget?.remainingMs?.() ?? null,
        budgetSnapshot: budget?.snapshot?.() ?? null,
        ...extra,
        recordedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      };
      const path = join(dir, `maintenance-latency-${meta.runId}.json`);
      writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
      return { path, artifact };
    },
    snapshot() {
      return {
        ...meta,
        phases: [...phases],
        currentPhase,
        totalWallClockMs: Date.now() - startedAt,
        latencyClassification: [...new Set(classifications)],
        wastedMs,
      };
    },
  };
}

/**
 * @param {number} ms
 */
export function fmtMs(ms) {
  const n = Math.max(0, Math.floor(Number(ms) || 0));
  const h = Math.floor(n / 3_600_000);
  const m = Math.floor((n % 3_600_000) / 60_000);
  const s = Math.floor((n % 60_000) / 1000);
  if (h > 0) return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

/**
 * Load latency artifacts from a proofs directory (for report CLI).
 * @param {string} dir
 */
export function loadLatencyArtifacts(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("maintenance-latency-") && f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
