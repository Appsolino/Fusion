#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto3Handoff 2026-08-01-06:45:
 * Regression harness for AUTO-2 → AUTO-3 exact handoff correlation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAuto3HandoffId,
  selectAuto3RunIdLegacyUnsafe,
  selectCorrelatedAuto3Run,
  mapAuto3RunToTerminal,
  parseAuto3TerminalMarker,
  auto3ParentExitCode,
} from "../auto3-handoff.mjs";
import { dispatchAndAwaitAuto3 } from "../auto2-finalize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SHA = "3e6a0ad67262152fc846cc0134a424903f0b4dec";
const SHA_OTHER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("AUTO-3 handoff id", () => {
  it("builds deterministic-shaped handoff ids from run metadata", () => {
    const id = buildAuto3HandoffId({
      githubRunId: "30687772141",
      attempt: 1,
      sourceSha: SHA,
      nonce: "deadbeef",
    });
    assert.equal(id, `auto2-30687772141-1-${SHA.slice(0, 12)}-deadbeef`);
  });
});

describe("AUTO-3 run selection race (legacy vs correlated)", () => {
  const olderFailed = {
    id: 30679116104,
    event: "workflow_dispatch",
    head_sha: "79034f5080e9aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    display_title: "Upstream AUTO-3 Deploy",
    name: "Upstream AUTO-3 Deploy",
    status: "completed",
    conclusion: "failure",
    created_at: "2026-08-01T02:00:22Z",
  };
  const olderSuccessSameSha = {
    id: 30000000001,
    event: "workflow_dispatch",
    head_sha: SHA,
    display_title: "Upstream AUTO-3 Deploy",
    name: "Upstream AUTO-3 Deploy",
    status: "completed",
    conclusion: "success",
    created_at: "2026-08-01T01:00:00Z",
  };
  const unrelatedConcurrent = {
    id: 30000000002,
    event: "workflow_dispatch",
    head_sha: SHA_OTHER,
    display_title: "Upstream AUTO-3 Deploy",
    name: "AUTO-3 auto2-other-1-aaaaaaaaaaaa-ffff pr=99 staging",
    status: "in_progress",
    conclusion: null,
    created_at: "2026-08-01T06:28:00Z",
  };

  it("LEGACY: older failed run + delayed new run → incorrectly selects older run", () => {
    // Reproduces AUTO-4 approve-sensitive waiter race: new child not visible yet.
    const runsVisibleBeforeChild = [olderFailed, olderSuccessSameSha];
    const selected = selectAuto3RunIdLegacyUnsafe(runsVisibleBeforeChild, { sourceSha: SHA });
    // Unsafe: display_title != null matches olderFailed first.
    assert.equal(selected, String(olderFailed.id));
  });

  it("CORRELATED: older failed/success + delayed visibility → no attach until handoff appears", () => {
    const handoffId = buildAuto3HandoffId({
      githubRunId: "30687772141",
      attempt: 1,
      sourceSha: SHA,
      nonce: "abc123",
    });
    const dispatchStartedAtMs = Date.parse("2026-08-01T06:27:55Z");
    assert.equal(
      selectCorrelatedAuto3Run([olderFailed, olderSuccessSameSha, unrelatedConcurrent], {
        handoffId,
        dispatchStartedAtMs,
        sourceSha: SHA,
      }),
      null,
    );
    const child = {
      id: 30687790065,
      event: "workflow_dispatch",
      head_sha: "3e6a0ad67262bbbbbbbbbbbbbbbbbbbbbbbbbbbb", // dispatch ref may be tip, not source
      display_title: `AUTO-3 ${handoffId} ${SHA} pr=47 staging`,
      name: `AUTO-3 ${handoffId} ${SHA} pr=47 staging`,
      status: "in_progress",
      conclusion: null,
      created_at: "2026-08-01T06:27:56Z",
    };
    const hit = selectCorrelatedAuto3Run(
      [olderFailed, olderSuccessSameSha, unrelatedConcurrent, child],
      { handoffId, dispatchStartedAtMs, sourceSha: SHA },
    );
    assert.ok(hit);
    assert.equal(String(hit.id), "30687790065");
  });

  it("CORRELATED: same source SHA with different handoff IDs do not cross-attach", () => {
    const handoffA = buildAuto3HandoffId({ githubRunId: "1", attempt: 1, sourceSha: SHA, nonce: "aaa" });
    const handoffB = buildAuto3HandoffId({ githubRunId: "2", attempt: 1, sourceSha: SHA, nonce: "bbb" });
    const runA = {
      id: 11,
      event: "workflow_dispatch",
      name: `AUTO-3 ${handoffA} ${SHA} pr=1 staging`,
      created_at: "2026-08-01T06:30:00Z",
    };
    const runB = {
      id: 22,
      event: "workflow_dispatch",
      name: `AUTO-3 ${handoffB} ${SHA} pr=2 staging`,
      created_at: "2026-08-01T06:30:01Z",
    };
    const started = Date.parse("2026-08-01T06:29:59Z");
    assert.equal(String(selectCorrelatedAuto3Run([runA, runB], { handoffId: handoffA, dispatchStartedAtMs: started }).id), "11");
    assert.equal(String(selectCorrelatedAuto3Run([runA, runB], { handoffId: handoffB, dispatchStartedAtMs: started }).id), "22");
  });

  it("CORRELATED: stays attached to the first exact correlated run", () => {
    const handoffId = buildAuto3HandoffId({ githubRunId: "9", attempt: 1, sourceSha: SHA, nonce: "cccc" });
    const first = {
      id: 101,
      event: "workflow_dispatch",
      name: `AUTO-3 ${handoffId} ${SHA} pr=3 staging`,
      created_at: "2026-08-01T07:00:00Z",
    };
    const duplicate = {
      id: 102,
      event: "workflow_dispatch",
      name: `AUTO-3 ${handoffId} ${SHA} pr=3 staging`,
      created_at: "2026-08-01T07:00:10Z",
    };
    const started = Date.parse("2026-08-01T06:59:50Z");
    assert.equal(String(selectCorrelatedAuto3Run([duplicate, first], { handoffId, dispatchStartedAtMs: started }).id), "101");
  });
});

describe("AUTO-3 terminal mapping", () => {
  it("maps markers and conclusions", () => {
    assert.equal(mapAuto3RunToTerminal({ status: "completed", conclusion: "success", terminalMarker: "IDEMPOTENT_NOOP" }).deploymentStatus, "IDEMPOTENT_NOOP");
    assert.equal(mapAuto3RunToTerminal({ status: "completed", conclusion: "success", terminalMarker: "ROLLED_BACK" }).deploymentStatus, "ROLLED_BACK");
    assert.equal(mapAuto3RunToTerminal({ status: "completed", conclusion: "failure", terminalMarker: "CRITICAL" }).deploymentStatus, "CRITICAL");
    assert.equal(mapAuto3RunToTerminal({ status: "completed", conclusion: "failure" }).deploymentStatus, "FAILED");
    assert.equal(mapAuto3RunToTerminal({ status: "completed", conclusion: "success" }).deploymentStatus, "DEPLOYED");
    assert.equal(mapAuto3RunToTerminal({ status: "in_progress", conclusion: null }).terminal, false);
  });

  it("parent exit codes", () => {
    assert.equal(auto3ParentExitCode("DEPLOYED"), 0);
    assert.equal(auto3ParentExitCode("IDEMPOTENT_NOOP"), 0);
    assert.equal(auto3ParentExitCode("ROLLED_BACK"), 2);
    assert.equal(auto3ParentExitCode("FAILED"), 2);
    assert.equal(auto3ParentExitCode("BLOCKED"), 2);
    assert.equal(auto3ParentExitCode("CRITICAL"), 2);
  });

  it("parses terminal marker from logs", () => {
    assert.equal(parseAuto3TerminalMarker("foo\nAUTO3_TERMINAL_STATUS=ROLLED_BACK\nbar"), "ROLLED_BACK");
    assert.equal(parseAuto3TerminalMarker("no marker"), null);
  });
});

describe("dispatchAndAwaitAuto3 correlation integration", () => {
  it("ignores older failed run until handoff appears, then follows exact child success", () => {
    const calls = [];
    let poll = 0;
    const handoffNonce = "feedface";
    const handoffId = buildAuto3HandoffId({
      githubRunId: "555",
      attempt: 1,
      sourceSha: SHA,
      nonce: handoffNonce,
    });
    const gh = (args) => {
      calls.push(args);
      if (args[0] === "api" && String(args[1]).includes("/commits/main")) {
        return { status: 0, stdout: SHA, stderr: "" };
      }
      if (args[0] === "workflow" && args[1] === "run") {
        assert.ok(args.some((a) => String(a).startsWith("handoff_id=")));
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "api" && String(args[1]).includes("upstream-auto3-deploy.yml/runs")) {
        poll += 1;
        const older = {
          id: 30679116104,
          event: "workflow_dispatch",
          name: "Upstream AUTO-3 Deploy",
          display_title: "Upstream AUTO-3 Deploy",
          created_at: "2026-08-01T02:00:22Z",
          status: "completed",
          conclusion: "failure",
        };
        const child = {
          id: 30687790065,
          event: "workflow_dispatch",
          name: `AUTO-3 ${handoffId} ${SHA} pr=47 staging`,
          display_title: `AUTO-3 ${handoffId} ${SHA} pr=47 staging`,
          created_at: new Date().toISOString(),
          status: poll >= 3 ? "completed" : "in_progress",
          conclusion: poll >= 3 ? "success" : null,
        };
        const list = poll < 3 ? [older] : [older, child];
        return { status: 0, stdout: JSON.stringify({ workflow_runs: list }), stderr: "" };
      }
      if (args[0] === "api" && String(args[1]).includes("/actions/runs/30687790065") && !String(args[1]).includes("logs")) {
        return {
          status: 0,
          stdout: JSON.stringify({ status: "completed", conclusion: "success" }),
          stderr: "",
        };
      }
      if (args[0] === "run" && args[1] === "view") {
        return { status: 0, stdout: "AUTO3_TERMINAL_STATUS=DEPLOYED\n", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
    };

    const result = dispatchAndAwaitAuto3(gh, "Appsolino/Fusion", "47", {
      pollMs: 1,
      timeoutMs: 5_000,
      handoffNonce,
      githubRunId: "555",
      githubRunAttempt: "1",
      nowMs: Date.now(),
      sleep: () => {},
    });
    assert.equal(result.status, "DEPLOYED");
    assert.equal(String(result.auto3RunId), "30687790065");
    assert.equal(result.handoffId, handoffId);
    assert.equal(result.sourceSha, SHA);
    // Must never have queried the older failed run id as the attached child.
    const attachedOld = calls.some((c) => String(c[1] || "").includes("/actions/runs/30679116104"));
    assert.equal(attachedOld, false);
  });

  it("returns BLOCKED when correlated run never appears (no fallback)", () => {
    const gh = (args) => {
      if (args[0] === "api" && String(args[1]).includes("/commits/main")) {
        return { status: 0, stdout: SHA, stderr: "" };
      }
      if (args[0] === "workflow" && args[1] === "run") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "api" && String(args[1]).includes("upstream-auto3-deploy.yml/runs")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            workflow_runs: [{
              id: 30679116104,
              event: "workflow_dispatch",
              name: "Upstream AUTO-3 Deploy",
              display_title: "Upstream AUTO-3 Deploy",
              created_at: "2026-08-01T02:00:22Z",
              status: "completed",
              conclusion: "failure",
            }],
          }),
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: "no" };
    };
    const result = dispatchAndAwaitAuto3(gh, "Appsolino/Fusion", "47", {
      pollMs: 1,
      timeoutMs: 20,
      handoffNonce: "timeout1",
      githubRunId: "777",
      sleep: () => {},
    });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.auto3RunId, null);
    assert.match(result.reasons.join(" "), /timeout|never appeared|no correlated/i);
  });

  it("maps exact child failure / rollback markers", () => {
    for (const [marker, expected] of [
      ["FAILED", "FAILED"],
      ["ROLLED_BACK", "ROLLED_BACK"],
      ["CRITICAL", "CRITICAL"],
      ["IDEMPOTENT_NOOP", "IDEMPOTENT_NOOP"],
    ]) {
      let listed = false;
      const handoffNonce = `n${marker.slice(0, 4).toLowerCase()}`;
      const handoffId = buildAuto3HandoffId({ githubRunId: "8", attempt: 1, sourceSha: SHA, nonce: handoffNonce });
      const gh = (args) => {
        if (args[0] === "api" && String(args[1]).includes("/commits/main")) {
          return { status: 0, stdout: SHA, stderr: "" };
        }
        if (args[0] === "workflow" && args[1] === "run") return { status: 0, stdout: "", stderr: "" };
        if (args[0] === "api" && String(args[1]).includes("upstream-auto3-deploy.yml/runs")) {
          listed = true;
          return {
            status: 0,
            stdout: JSON.stringify({
              workflow_runs: [{
                id: 42,
                event: "workflow_dispatch",
                name: `AUTO-3 ${handoffId} ${SHA} pr=1 staging`,
                created_at: new Date().toISOString(),
                status: "completed",
                conclusion: marker === "IDEMPOTENT_NOOP" || marker === "ROLLED_BACK" ? "success" : "failure",
              }],
            }),
            stderr: "",
          };
        }
        if (args[0] === "api" && String(args[1]).includes("/actions/runs/42")) {
          return {
            status: 0,
            stdout: JSON.stringify({
              status: "completed",
              conclusion: marker === "IDEMPOTENT_NOOP" || marker === "ROLLED_BACK" ? "success" : "failure",
            }),
            stderr: "",
          };
        }
        if (args[0] === "run" && args[1] === "view") {
          return { status: 0, stdout: `AUTO3_TERMINAL_STATUS=${marker}\n`, stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "x" };
      };
      const result = dispatchAndAwaitAuto3(gh, "Appsolino/Fusion", "1", {
        pollMs: 1,
        timeoutMs: 2000,
        handoffNonce,
        githubRunId: "8",
        sleep: () => {},
      });
      assert.equal(result.status, expected, marker);
      assert.ok(listed);
    }
  });

  it("repeat await on already-terminal correlated run does not re-dispatch (caller controls dispatch)", () => {
    // dispatchAndAwaitAuto3 always dispatches once per call; uncontrolled retry loops are a caller concern.
    // Prove a single call performs exactly one workflow run.
    let dispatches = 0;
    const handoffNonce = "onceonly";
    const handoffId = buildAuto3HandoffId({ githubRunId: "3", attempt: 1, sourceSha: SHA, nonce: handoffNonce });
    const gh = (args) => {
      if (args[0] === "api" && String(args[1]).includes("/commits/main")) return { status: 0, stdout: SHA, stderr: "" };
      if (args[0] === "workflow" && args[1] === "run") {
        dispatches += 1;
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "api" && String(args[1]).includes("upstream-auto3-deploy.yml/runs")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            workflow_runs: [{
              id: 99,
              event: "workflow_dispatch",
              name: `AUTO-3 ${handoffId} ${SHA} pr=1 staging`,
              created_at: new Date().toISOString(),
              status: "completed",
              conclusion: "success",
            }],
          }),
          stderr: "",
        };
      }
      if (args[0] === "api" && String(args[1]).includes("/actions/runs/99")) {
        return { status: 0, stdout: JSON.stringify({ status: "completed", conclusion: "success" }), stderr: "" };
      }
      if (args[0] === "run" && args[1] === "view") {
        return { status: 0, stdout: "AUTO3_TERMINAL_STATUS=IDEMPOTENT_NOOP\n", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "x" };
    };
    const result = dispatchAndAwaitAuto3(gh, "Appsolino/Fusion", "1", {
      pollMs: 1,
      timeoutMs: 2000,
      handoffNonce,
      githubRunId: "3",
      sleep: () => {},
    });
    assert.equal(result.status, "IDEMPOTENT_NOOP");
    assert.equal(dispatches, 1);
  });
});

describe("AUTO-3 / AUTO-2 workflow static guards", () => {
  it("AUTO-3 accepts handoff_id and sets run-name", () => {
    const yml = readFileSync(join(ROOT, ".github/workflows/upstream-auto3-deploy.yml"), "utf8");
    assert.match(yml, /handoff_id:/);
    assert.match(yml, /run-name:/);
    assert.match(yml, /AUTO3_TERMINAL_STATUS=/);
    assert.doesNotMatch(yml, /HOST_D_DEPLOY_SSH_KEY[\s\S]*jobs:[\s\S]*build:/);
  });

  it("candidate validate still has no Host D / App write token", () => {
    const yml = readFileSync(join(ROOT, ".github/workflows/upstream-auto2-validate.yml"), "utf8");
    assert.doesNotMatch(yml, /uses:\s*actions\/create-github-app-token@/);
    assert.doesNotMatch(yml, /HOST_D_DEPLOY_SSH_KEY/);
  });
});
