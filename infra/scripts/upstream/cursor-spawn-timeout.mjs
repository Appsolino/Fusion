#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamAiProtocol 2026-08-07-10:20:
 * cursor-agent often ignores SIGTERM and can hang past the soft timeout (observed
 * on #135: expert ran ~46m after a 600s timeout reject never settled). Escalate
 * SIGTERM → SIGKILL and settle the promise exactly once.
 */
import { spawn } from "node:child_process";

export const DEFAULT_CURSOR_TIMEOUT_MS = 900_000; // 15m — composer/opus expert+verifier budgets
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
 * }} input
 * @returns {Promise<{ ok: true, stdout: string } | { ok: false, error: Error }>}
 */
export function spawnCursorWithTimeout(input) {
  const timeoutMs = Number(input.timeoutMs ?? DEFAULT_CURSOR_TIMEOUT_MS);
  const spawnFn = input.spawnFn || spawn;
  const label = input.label || "cursor-agent";

  return new Promise((resolve) => {
    let settled = false;
    /** @param {{ ok: true, stdout: string } | { ok: false, error: Error }} value */
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
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

    const softTimer = setTimeout(() => {
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
          error: new Error(`${label} timed out after ${timeoutMs}ms (SIGKILL)`),
        });
      }, CURSOR_KILL_GRACE_MS);
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", (e) => {
      settle({ ok: false, error: e instanceof Error ? e : new Error(String(e)) });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
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
