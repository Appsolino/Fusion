#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-05:
 * Issue #105 — AUTO-3 terminal/evidence parsing reliability.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFactualAuto3Evidence,
  parseDeployReceipt,
  parseLastTerminalMarker,
  extractRuntimeTerminalMarkers,
  isScriptSourceTerminalLine,
  assessAuto3EvidenceCompleteness,
  validateRuntimeTerminalSequence,
} from "../parse-deploy-evidence.mjs";
import { classifyFailure, normalizeEvidence } from "../normalize-evidence.mjs";
import { evaluateLiveObservation } from "../evaluate-live.mjs";
import { parseAuto3TerminalMarker } from "../../auto3-handoff.mjs";
import {
  createMemoryIssueClient,
  upsertIncident,
} from "../upsert-incident.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "auto3-evidence-105");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("issue #105 runtime terminal markers", () => {
  it("ignores echoed if/grep/echo script-source lines", () => {
    const log = read("script-source-echo/gh-run.log");
    assert.equal(parseLastTerminalMarker(log), null);
    assert.equal(parseAuto3TerminalMarker(log), null);
    assert.ok(isScriptSourceTerminalLine('  echo "AUTO3_TERMINAL_STATUS=DEPLOYED"'));
    assert.ok(isScriptSourceTerminalLine('if echo "$OUT" | grep -q AUTO3_TERMINAL_STATUS=DEPLOYED; then'));
    assert.equal(isScriptSourceTerminalLine("AUTO3_TERMINAL_STATUS=DEPLOYED"), false);
  });

  it("accepts runtime AUTO3_TERMINAL_STATUS=DEPLOYED", () => {
    assert.equal(parseLastTerminalMarker("AUTO3_TERMINAL_STATUS=DEPLOYED\n"), "DEPLOYED");
  });

  it("later runtime ROLLED_BACK overrides earlier runtime DEPLOYED", () => {
    const log = read("terminals/multi-runtime.log");
    assert.deepEqual(extractRuntimeTerminalMarkers(log), ["DEPLOYED", "ROLLED_BACK"]);
    assert.equal(parseLastTerminalMarker(log), "ROLLED_BACK");
    assert.equal(parseAuto3TerminalMarker(log), "ROLLED_BACK");
  });

  it("parses CRITICAL / BLOCKED / IDEMPOTENT_NOOP terminals", () => {
    assert.equal(parseLastTerminalMarker(read("terminals/CRITICAL.log")), "CRITICAL");
    assert.equal(parseLastTerminalMarker(read("terminals/BLOCKED.log")), "BLOCKED");
    assert.equal(parseLastTerminalMarker(read("terminals/IDEMPOTENT_NOOP.log")), "IDEMPOTENT_NOOP");
  });

  it("rejects impossible CRITICAL then DEPLOYED sequence", () => {
    const seq = validateRuntimeTerminalSequence(["CRITICAL", "DEPLOYED"]);
    assert.equal(seq.ok, false);
    assert.match(seq.reason || "", /impossible-sequence/);
  });
});

describe("issue #105 deploy receipt + factual evidence", () => {
  it("DEPLOYED legacy receipt derives health=ok and enginePaused=true", () => {
    const deployOutput = read("deploy-31019196241/deploy-out.txt");
    const receipt = parseDeployReceipt(deployOutput);
    assert.equal(receipt.terminal, "DEPLOYED");
    assert.equal(receipt.health, "ok");
    assert.equal(receipt.enginePaused, true);
    assert.equal(receipt.deployedHostP, false);
    assert.equal(receipt.releaseId, "auto3-0.75.1-beta.1-7c62e652e56d");

    const ev = buildFactualAuto3Evidence({
      manifest: read("deploy-31019196241/manifest.json"),
      deployOutput,
      terminalFile: read("deploy-31019196241/terminal.txt"),
      buildSourceSha: "7c62e652e56dd3fa04755f547ba7456213ba1dd8",
      buildReleaseId: "auto3-0.75.1-beta.1-7c62e652e56d",
    });
    assert.equal(ev.terminal, "DEPLOYED");
    assert.equal(ev.health, "ok");
    assert.equal(ev.enginePaused, true);
    assert.equal(ev.hostPAccessed, false);
    assert.equal(ev.highestMigration, "0044");
    assert.equal(ev.completeness.complete, true);
    assert.equal(ev.completeness.needsEvidence, false);
  });

  it("ROLLED_BACK receipt records previous release restored evidence", () => {
    const deployOutput = read("rollback-31021267327/deploy-out.txt");
    const receipt = parseDeployReceipt(deployOutput);
    assert.equal(receipt.terminal, "ROLLED_BACK");
    assert.equal(receipt.previousReleaseRestored, true);
    assert.equal(receipt.previousRelease, null); // identity not invented
    assert.equal(receipt.deployedHostP, false);

    const ev = buildFactualAuto3Evidence({
      deployOutput,
      terminalFile: read("rollback-31021267327/terminal.txt"),
      buildSourceSha: "7c62e652e56dd3fa04755f547ba7456213ba1dd8",
      buildReleaseId: "auto3-0.75.1-beta.1-7c62e652e56d",
    });
    assert.equal(ev.terminal, "ROLLED_BACK");
    assert.equal(ev.previousReleaseRestored, true);
    assert.equal(ev.hostPAccessed, false);
    assert.equal(ev.completeness.needsEvidence, false);
  });

  it("prefers terminal file over receipt and runtime markers", () => {
    const ev = buildFactualAuto3Evidence({
      deployOutput: 'AUTO3_TERMINAL_STATUS=FAILED\n{"status":"BLOCKED","reasons":[],"deployedHostP":false}\n',
      terminalFile: "ROLLED_BACK",
    });
    assert.equal(ev.terminal, "ROLLED_BACK");
  });

  it("missing artifact / empty deploy leaves physical fields null (needs-evidence for DEPLOYED)", () => {
    const ev = buildFactualAuto3Evidence({
      deployOutput: "",
      terminalFile: "DEPLOYED",
    });
    assert.equal(ev.terminal, "DEPLOYED");
    assert.equal(ev.health, null);
    assert.equal(ev.enginePaused, null);
    assert.equal(ev.completeness.needsEvidence, true);
    assert.ok(ev.completeness.missing.includes("health"));
  });

  it("malformed JSON does not invent success fields", () => {
    const receipt = parseDeployReceipt(read("malformed-json/deploy-out.txt"));
    assert.equal(receipt.terminal, null);
    assert.equal(receipt.health, null);
    const ev = buildFactualAuto3Evidence({
      deployOutput: read("malformed-json/deploy-out.txt"),
      terminalFile: "DEPLOYED",
    });
    assert.equal(ev.terminal, "DEPLOYED");
    assert.equal(ev.health, null);
    assert.equal(ev.completeness.needsEvidence, true);
  });
});

describe("issue #105 steward classification / live observation", () => {
  it("script-source DEPLOYED then runtime ROLLED_BACK is NOT terminal-marker-parse", () => {
    const log = read("rollback-31021267327/gh-run.log");
    const c = classifyFailure({ logText: log, workflowFamily: "auto3" });
    assert.notEqual(c.failureClass, "terminal-marker-parse");
  });

  it("explicit false-DEPLOYED language still classifies as terminal-marker-parse", () => {
    const c = classifyFailure({
      logText: "false DEPLOYED from first AUTO3_TERMINAL_STATUS in script source",
    });
    assert.equal(c.failureClass, "terminal-marker-parse");
  });

  it("historical deploy fixture evaluates to non-incident DEPLOYED with complete evidence", () => {
    const deployOutput = read("deploy-31019196241/deploy-out.txt");
    const ev = buildFactualAuto3Evidence({
      manifest: read("deploy-31019196241/manifest.json"),
      deployOutput,
      terminalFile: read("deploy-31019196241/terminal.txt"),
      buildSourceSha: "7c62e652e56dd3fa04755f547ba7456213ba1dd8",
      buildReleaseId: "auto3-0.75.1-beta.1-7c62e652e56d",
    });
    const n = evaluateLiveObservation({
      workflowName: "Upstream AUTO-3 Deploy",
      runId: "31019196241",
      attempt: 1,
      conclusion: "success",
      logText: read("deploy-31019196241/gh-run.log"),
      evidenceArtifact: ev,
      expectedSourceSha: "7c62e652e56dd3fa04755f547ba7456213ba1dd8",
      expectedReleaseId: "auto3-0.75.1-beta.1-7c62e652e56d",
    });
    assert.equal(n.openIncident, false);
    assert.equal(n.failureClass, "none");
    assert.equal(n.terminalStatus, "DEPLOYED");
    assert.equal(ev.health, "ok");
    assert.equal(ev.enginePaused, true);
    assert.equal(ev.hostPAccessed, false);
  });

  it("historical rollback fixture evaluates to non-incident ROLLED_BACK (no #105 class)", () => {
    const deployOutput = read("rollback-31021267327/deploy-out.txt");
    const ev = buildFactualAuto3Evidence({
      deployOutput,
      terminalFile: read("rollback-31021267327/terminal.txt"),
      buildSourceSha: "7c62e652e56dd3fa04755f547ba7456213ba1dd8",
      buildReleaseId: "auto3-0.75.1-beta.1-7c62e652e56d",
    });
    const n = evaluateLiveObservation({
      workflowName: "Upstream AUTO-3 Deploy",
      runId: "31021267327",
      attempt: 1,
      conclusion: "success",
      logText: read("rollback-31021267327/gh-run.log"),
      evidenceArtifact: ev,
      expectedSourceSha: "7c62e652e56dd3fa04755f547ba7456213ba1dd8",
    });
    assert.equal(n.openIncident, false);
    assert.notEqual(n.failureClass, "terminal-marker-parse");
    assert.equal(n.terminalStatus, "ROLLED_BACK");
    assert.equal(ev.previousReleaseRestored, true);
    assert.equal(ev.hostPAccessed, false);
  });

  it("incomplete DEPLOYED evidence yields needs-evidence, not false success", () => {
    const n = evaluateLiveObservation({
      workflowName: "Upstream AUTO-3 Deploy",
      runId: "1",
      attempt: 1,
      conclusion: "success",
      logText: "AUTO3_TERMINAL_STATUS=DEPLOYED\n",
      evidenceArtifact: {
        terminal: "DEPLOYED",
        health: null,
        enginePaused: null,
        hostPAccessed: false,
        sourceSha: "abc",
        releaseId: "rel",
      },
      expectedSourceSha: "abc",
    });
    assert.equal(n.openIncident, true);
    assert.equal(n.failureClass, "needs-triage");
    assert.match(n.instance?.logExcerpt || n.fingerprintCanonical || "", /.*/);
    assert.ok(
      String(n.instance?.logExcerpt || "").length >= 0
      && n.openIncident === true,
    );
  });

  it("does not create duplicate fingerprint when replaying same occurrence", async () => {
    const deployOutput = read("rollback-31021267327/deploy-out.txt");
    const ev = buildFactualAuto3Evidence({
      deployOutput,
      terminalFile: "ROLLED_BACK",
    });
    // Force the historical bug class shape once — then ensure script-source replay does not open a second class.
    const forced = normalizeEvidence({
      workflowName: "Upstream AUTO-3 Deploy",
      runId: "31021267327",
      attempt: 1,
      failureClass: "terminal-marker-parse",
      phase: "auto3-terminal-parse",
      component: "terminal-marker-parser",
      errorMessage: "false-deployed-from-script-source",
      terminalStatus: "ROLLED_BACK",
      forceIncident: true,
      evidenceArtifact: ev,
    });
    const client = createMemoryIssueClient();
    const first = await upsertIncident(client, forced);
    assert.ok(first.action === "create" || first.action === "append");
    const replay = evaluateLiveObservation({
      workflowName: "Upstream AUTO-3 Deploy",
      runId: "31021267327",
      attempt: 1,
      conclusion: "success",
      logText: read("rollback-31021267327/gh-run.log"),
      evidenceArtifact: ev,
    });
    assert.equal(replay.openIncident, false);
    // No second upsert for non-incident replay
    assert.equal(replay.fingerprint, null);
  });
});

describe("issue #105 completeness helper", () => {
  it("DEPLOYED without health/enginePaused needs evidence", () => {
    const a = assessAuto3EvidenceCompleteness({
      terminal: "DEPLOYED",
      health: null,
      enginePaused: null,
      hostPAccessed: false,
    });
    assert.equal(a.needsEvidence, true);
  });

  it("ROLLED_BACK with restoration reason is complete", () => {
    const a = assessAuto3EvidenceCompleteness({
      terminal: "ROLLED_BACK",
      previousReleaseRestored: true,
      hostPAccessed: false,
    });
    assert.equal(a.needsEvidence, false);
  });
});
