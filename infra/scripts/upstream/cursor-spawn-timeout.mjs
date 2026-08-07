#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamAiProtocol 2026-08-07-10:20:
 * cursor-agent often ignores SIGTERM and can hang past the soft timeout (observed
 * on #135: expert ran ~46m after a 600s timeout reject never settled). Escalate
 * SIGTERM → SIGKILL and settle the promise exactly once.
 *
 * FNXC:UpstreamLatency 2026-08-07-14:05:
 * Also honor AbortSignal (stale-candidate watchdog / cycle budget) with the same
 * SIGTERM→SIGKILL escalation so mid-flight REFRESH_REQUIRED does not burn 10–15m.
 */
import { spawn } from "node:child_process";

export const DEFAULT_CURSOR_TIMEOUT_MS = 900_000; // 15m legacy per-child ceiling; cycle budget usually lower
export const CURSOR_KILL_GRACE_MS = 10_000;

/**
 * @param {{
 *   bin: string,
 *   args: string[],
 *   cwd: string,
 *   env: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   spawnFn?: typeof spawn,
 *   label?: string,
 *   abortSignal?: AbortSignal|null,
 *   onActivity?: (() => void)|null,
 * }} input
 * @returns {Promise<{ ok: true, stdout: string } | { ok: false, error: Error, aborted?: boolean, abortReason?: unknown }>}
 */
export function spawnCursorWithTimeout(input) {
  const timeoutMs = Number(input.timeoutMs ?? DEFAULT_CURSOR_TIMEOUT_MS);
  const spawnFn = input.spawnFn || spawn;
  const label = input.label || "cursor-agent";
  const abortSignal = input.abortSignal || null;
  const onActivity = typeof input.onActivity === "function" ? input.onActivity : null;

  if (timeoutMs <= 0) {
    return Promise.resolve({
      ok: false,
      error: new Error(`${label} refused: cycle/phase budget already exhausted (timeoutMs=0)`),
      aborted: true,
      abortReason: "LATENCY_BUDGET_EXHAUSTED",
    });
  }

  if (abortSignal?.aborted) {
    return Promise.resolve({
      ok: false,
      error: new Error(`${label} aborted before start`),
      aborted: true,
      abortReason: abortSignal.reason,
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    /** @param {{ ok: true, stdout: string } | { ok: false, error: Error, aborted?: boolean, abortReason?: unknown }} value */
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      if (abortSignal && onAbort) {
        try {
          abortSignal.removeEventListener("abort", onAbort);
        } catch {
          /* ignore */
        }
      }
      resolve(value);
    };

    const child = spawnFn(input.bin, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let hardTimer = null;
    let aborting = false;

    const escalateKill = (reasonMsg) => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      hardTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        settle({
          ok: false,
          error: new Error(reasonMsg),
          aborted: aborting,
          abortReason: abortSignal?.reason,
        });
      }, CURSOR_KILL_GRACE_MS);
    };

    const softTimer = setTimeout(() => {
      escalateKill(`${label} timed out after ${timeoutMs}ms (SIGKILL)`);
    }, timeoutMs);

    /** @type {(() => void)|null} */
    let onAbort = null;
    if (abortSignal) {
      onAbort = () => {
        aborting = true;
        escalateKill(`${label} aborted mid-flight (stale/budget) — SIGKILL`);
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (d) => {
      out += d;
      if (onActivity) onActivity();
    });
    child.stderr.on("data", (d) => {
      err += d;
      if (onActivity) onActivity();
    });
    child.on("error", (e) => {
      settle({ ok: false, error: e instanceof Error ? e : new Error(String(e)) });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      if (aborting) {
        settle({
          ok: false,
          error: new Error(`${label} aborted mid-flight (stale/budget)`),
          aborted: true,
          abortReason: abortSignal?.reason,
        });
        return;
      }
      if (code !== 0) {
        settle({
          ok: false,
          error: new Error(
            `${label} exit ${code}${signal ? ` signal=${signal}` : ""}: ${err.slice(0, 500)}`,
          ),
        });
        return;
      }
      settle({ ok: true, stdout: out });
    });
  });
}
