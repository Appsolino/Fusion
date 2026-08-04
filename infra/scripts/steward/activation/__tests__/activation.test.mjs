#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isGateEnabled,
  loadActivationPolicy,
  summarizeActivation,
} from "../resolve-activation.mjs";
import {
  loadLedger,
  updatePhase,
  addOwnerAction,
  resolveLiveMainSha,
} from "../../programme/ledger.mjs";

describe("activation gates", () => {
  it("killSwitch disables all gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "act-"));
    try {
      const path = join(dir, "policy.json");
      writeFileSync(
        path,
        JSON.stringify({
          schemaVersion: 1,
          killSwitch: true,
          gates: {
            s1aAutoHandoff: { enabled: true, envOverride: "S1A_AUTO_HANDOFF" },
          },
        }),
      );
      assert.equal(
        isGateEnabled("s1aAutoHandoff", {
          policy: loadActivationPolicy({ policyPath: path }),
          env: {},
        }),
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("env override can enable when policy disabled", () => {
    const summary = summarizeActivation({
      env: { S1A_AUTO_HANDOFF: "true" },
    });
    assert.equal(summary.effective.s1aAutoHandoff, true);
    assert.equal(summary.effective.s0HandoffS1a, false);
  });

  it("default policy keeps auto handoff off", () => {
    const summary = summarizeActivation({ env: {} });
    assert.equal(summary.killSwitch, false);
    assert.equal(summary.effective.s1aAutoHandoff, false);
    assert.equal(summary.effective.s1bEnabled, false);
  });
});

describe("programme ledger", () => {
  it("loads tracking issue and baselines", () => {
    const ledger = loadLedger();
    assert.equal(ledger.trackingIssue, 78);
    assert.equal(ledger.repository, "Appsolino/Fusion");
    assert.ok(ledger.s1aImplementationBaselineSha);
    assert.ok(ledger.documentationClosureMergeSha);
  });

  it("updatePhase and owner actions are durable", () => {
    const dir = mkdtempSync(join(tmpdir(), "led-"));
    const path = join(dir, "ledger.json");
    try {
      writeFileSync(
        path,
        JSON.stringify({
          schemaVersion: 1,
          programme: "t",
          trackingIssue: 78,
          phases: { "1-control-plane": { status: "PENDING" } },
          openOwnerActions: [],
        }),
      );
      updatePhase("1-control-plane", { status: "IN_PROGRESS" }, { path });
      addOwnerAction({ id: "xai-key", title: "Add XAI_API_KEY" }, { path });
      addOwnerAction({ id: "xai-key", title: "Add XAI_API_KEY" }, { path });
      const led = loadLedger(path);
      assert.equal(led.phases["1-control-plane"].status, "IN_PROGRESS");
      assert.equal(led.openOwnerActions.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveLiveMainSha works against this checkout", () => {
    const sha = resolveLiveMainSha({ cwd: process.cwd() });
    assert.match(sha, /^[0-9a-f]{40}$/);
  });
});
