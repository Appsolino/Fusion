#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-03:
 * Regression: shared evidence helpers must not execute CLI on import;
 * schedule/reconcile must not require --run-id.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STEWARD = join(HERE, "..");
const ROOT = join(STEWARD, "../../..");

describe("live-evidence import has no CLI side effects", () => {
  it("imports successfully without requiring --run-id", async () => {
    const mod = await import("../live-evidence.mjs");
    assert.equal(typeof mod.downloadAuto3EvidenceArtifact, "function");
  });

  it("node -e import prints import-ok only", () => {
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", 'await import("./infra/scripts/steward/live-evidence.mjs"); console.log("import-ok")'],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^import-ok\n$/);
    assert.doesNotMatch(r.stderr || "", /require --repo and --run-id/);
  });
});

describe("run-live-event CLI vs module import", () => {
  it("importing run-live-event does not require --run-id", async () => {
    const mod = await import(`${pathToFileURL(join(STEWARD, "run-live-event.mjs")).href}?t=${Date.now()}`);
    assert.equal(typeof mod.runLiveEventMain, "function");
  });

  it("direct CLI without --run-id still fails", () => {
    const r = spawnSync(
      process.execPath,
      [join(STEWARD, "run-live-event.mjs"), "--repo=Appsolino/Fusion"],
      { encoding: "utf8" },
    );
    assert.notEqual(r.status, 0);
    assert.match(`${r.stderr}${r.stdout}`, /require --repo and --run-id/);
  });
});

describe("run-live-reconcile schedule-shaped path", () => {
  it("accepts --repo without --run-id and reaches reconcileRuns", async () => {
    const { executeLiveReconcile } = await import("../run-live-reconcile.mjs");
    const dir = mkdtempSync(join(tmpdir(), "steward-reconcile-test-"));
    try {
      const out = join(dir, "out.json");
      const upsertOut = join(dir, "upsert.json");
      const payload = executeLiveReconcile({
        repo: "Appsolino/Fusion",
        out,
        upsertOut,
        nowMs: 1_725_000_000_000,
        listRuns: () => ({ ok: true, data: { workflow_runs: [] } }),
        listAuto3Dispatch: () => ({ ok: true, data: { workflow_runs: [] } }),
        downloadEvidence: () => {
          throw new Error("download should not run with empty AUTO-3 set");
        },
      });
      assert.equal(payload.source, "live-reconcile");
      assert.ok(payload.once);
      assert.ok(Array.isArray(payload.candidates));
      assert.equal(payload.handoffCount, 0);
      const written = JSON.parse(readFileSync(upsertOut, "utf8"));
      assert.deepEqual(written, { candidates: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CLI requires --repo only (no --run-id)", () => {
    const r = spawnSync(
      process.execPath,
      [join(STEWARD, "run-live-reconcile.mjs")],
      { encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: "" } },
    );
    assert.notEqual(r.status, 0);
    assert.match(`${r.stderr}${r.stdout}`, /require --repo/);
    assert.doesNotMatch(`${r.stderr}${r.stdout}`, /require --repo and --run-id/);
  });
});
