#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamAiProtocol 2026-08-07-10:20:
 * Soft timeout must escalate to SIGKILL and settle once.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnCursorWithTimeout, CURSOR_KILL_GRACE_MS } from "../cursor-spawn-timeout.mjs";

function fakeSpawnFactory({ hang = false, exitCode = 0, stdout = "ok" } = {}) {
  /** @type {{ signal: string|null }[]} */
  const kills = [];
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => {
      kills.push({ signal });
      if (signal === "SIGKILL" || !hang) {
        setImmediate(() => child.emit("close", signal === "SIGKILL" ? null : exitCode, signal === "SIGKILL" ? "SIGKILL" : null));
      }
      // SIGTERM on hang: ignore (reproduces cursor-agent behavior)
    };
    setImmediate(() => {
      if (!hang && exitCode === 0) {
        child.stdout.emit("data", stdout);
        child.emit("close", 0, null);
      } else if (!hang) {
        child.stderr.emit("data", "boom");
        child.emit("close", exitCode, null);
      }
    });
    return child;
  };
  return { spawnFn, kills };
}

describe("spawnCursorWithTimeout", () => {
  it("returns stdout on success", async () => {
    const { spawnFn } = fakeSpawnFactory({ stdout: "hello" });
    const r = await spawnCursorWithTimeout({
      bin: "cursor-agent",
      args: [],
      cwd: "/",
      env: process.env,
      timeoutMs: 2000,
      spawnFn,
      label: "test",
    });
    assert.equal(r.ok, true);
    assert.equal(r.stdout, "hello");
  });

  it("SIGTERM then SIGKILL when process ignores soft timeout", async () => {
    const { spawnFn, kills } = fakeSpawnFactory({ hang: true });
    const started = Date.now();
    const r = await spawnCursorWithTimeout({
      bin: "cursor-agent",
      args: [],
      cwd: "/",
      env: process.env,
      timeoutMs: 50,
      spawnFn,
      label: "hung",
    });
    assert.equal(r.ok, false);
    assert.match(r.error.message, /timed out.*SIGKILL/);
    assert.ok(kills.some((k) => k.signal === "SIGTERM"));
    assert.ok(kills.some((k) => k.signal === "SIGKILL"));
    assert.ok(Date.now() - started >= 50 + CURSOR_KILL_GRACE_MS - 20);
  });
});
