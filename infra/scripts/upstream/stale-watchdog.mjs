#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamLatency 2026-08-07-14:05:
 * Mid-flight stale-candidate watchdog. Freshness must not wait for repair-loop
 * boundaries — kill expert/verifier children when upstream or Appsolino main moves.
 */
import { assertFinalizerFreshness } from "./rolling-candidate.mjs";

export const DEFAULT_WATCHDOG_INTERVAL_MS = Number(process.env.UPSTREAM_STALE_WATCHDOG_MS || 45_000);

/**
 * @param {{
 *   intervalMs?: number,
 *   candidateUpstreamSha?: string|null,
 *   candidateBaseAppsolinoSha?: string|null,
 *   recheckUpstreamFn?: () => Promise<string|null>|string|null,
 *   recheckAppsolinoMainFn?: () => Promise<string|null>|string|null,
 *   abortController?: AbortController,
 *   onStale?: (info: object) => void,
 *   nowFn?: () => number,
 * }} input
 */
export function startStaleWatchdog(input) {
  const intervalMs = Math.max(5_000, Number(input.intervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS));
  const abortController = input.abortController || new AbortController();
  let stopped = false;
  let lastCheck = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let timer = null;

  async function tick() {
    if (stopped) return;
    try {
      const liveUpstream =
        typeof input.recheckUpstreamFn === "function" ? await input.recheckUpstreamFn() : null;
      const liveMain =
        typeof input.recheckAppsolinoMainFn === "function" ? await input.recheckAppsolinoMainFn() : null;
      const race = assertFinalizerFreshness({
        candidateUpstreamSha: input.candidateUpstreamSha,
        liveUpstreamHead: liveUpstream,
        candidateBaseAppsolinoSha: input.candidateBaseAppsolinoSha,
        liveAppsolinoMain: liveMain,
      });
      lastCheck = {
        at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        liveUpstream,
        liveMain,
        ok: race.ok,
        reason: race.reason || null,
        mismatch: race.mismatch || null,
      };
      if (!race.ok && race.action === "REFRESH_REQUIRED") {
        const classification =
          race.mismatch === "appsolino-base" || /appsolino/i.test(String(race.reason || ""))
            ? "STALE_APPSOLINO_BASE"
            : "STALE_UPSTREAM";
        const info = {
          ...lastCheck,
          action: "REFRESH_REQUIRED",
          classification,
          reason: race.reason,
        };
        if (!abortController.signal.aborted) {
          abortController.abort(info);
        }
        if (typeof input.onStale === "function") input.onStale(info);
        stop();
      }
    } catch (err) {
      lastCheck = {
        at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        ok: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  // Immediate first check so we do not wait a full interval when already stale.
  void tick();

  return {
    abortController,
    stop,
    getLastCheck: () => lastCheck,
    get signal() {
      return abortController.signal;
    },
  };
}

/**
 * Read abort reason from AbortSignal (Node stores it on signal.reason).
 * @param {AbortSignal} signal
 */
export function staleAbortInfo(signal) {
  if (!signal?.aborted) return null;
  const r = signal.reason;
  if (r && typeof r === "object") return r;
  return { action: "REFRESH_REQUIRED", reason: String(r || "aborted"), classification: "STALE_UPSTREAM" };
}
