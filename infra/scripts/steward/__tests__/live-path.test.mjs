#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-02-04:55:
 * Strict success interpretation + live evidence / handoff regression coverage.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvidence } from "../normalize-evidence.mjs";
import { buildFactualAuto3Evidence, parseReleaseManifest, parseDeployReceipt } from "../parse-deploy-evidence.mjs";
import { evaluateLiveObservation } from "../evaluate-live.mjs";
import { buildHandoffsFromRuns } from "../build-handoffs.mjs";
import { reconcileRuns } from "../reconcile-runs.mjs";
import {
  createMemoryIssueClient,
  upsertIncident,
  buildNewIssueContent,
} from "../upsert-incident.mjs";
import { fingerprintMarkerHtml } from "../policy.mjs";

describe("strict success boolean", () => {
  for (const value of ["false", "0", 1, {}, []]) {
    it(`does not treat ${JSON.stringify(value)} as success`, () => {
      const n = normalizeEvidence({
        workflowName: "Upstream AUTO-3 Deploy",
        runId: 1,
        terminalStatus: "FAILED",
        success: value,
        errorMessage: "should still open",
        forceIncident: true,
      });
      // forceIncident opens; critical is that success short-circuit did not fire
      assert.equal(n.openIncident, true);
      assert.notEqual(n.failureClass, "none");
    });
  }

  it("only literal true is success / no incident", () => {
    const n = normalizeEvidence({
      workflowName: "Upstream AUTO-3 Deploy",
      runId: 2,
      terminalStatus: "DEPLOYED",
      success: true,
    });
    assert.equal(n.openIncident, false);
    assert.equal(n.failureClass, "none");
  });
});

describe("factual AUTO-3 evidence", () => {
  const manifest = {
    sourceSha: "16f24ed3b47321cc1b5aa693b2fac7e13a00b379",
    releaseId: "auto3-0.74.0-beta.6-16f24ed3b473",
    applicationVersion: "0.74.0-beta.6",
    requiredSchemaCeiling: "0039",
    expectedHealthVersion: "0.74.0-beta.6",
  };

  it("reads applicationVersion from manifest, not invented defaults", () => {
    const p = parseReleaseManifest(JSON.stringify(manifest));
    assert.equal(p.applicationVersion, "0.74.0-beta.6");
    const ev = buildFactualAuto3Evidence({
      manifest,
      deployOutput: "",
      buildSourceSha: manifest.sourceSha,
      buildReleaseId: manifest.releaseId,
    });
    assert.equal(ev.applicationVersion, "0.74.0-beta.6");
    assert.equal(ev.health, null);
    assert.equal(ev.enginePaused, null);
    assert.equal(ev.hostPAccessed, null);
    assert.equal(ev.previousRelease, null);
  });

  it("parses deploy receipt fields when present", () => {
    const receipt = {
      status: "BLOCKED",
      reasons: ["version mismatch"],
      profile: "staging",
      deployedHostP: false,
      sourceSha: manifest.sourceSha,
      releaseId: manifest.releaseId,
      applicationVersion: "0.74.0-beta.6",
      previousRelease: "auto3-0.74.0-beta.5-5f1b923bd815",
      highestMigration: "0039",
      health: "ok",
      enginePaused: true,
      recordedUtc: "2026-08-01T15:00:00Z",
    };
    const text = `noise\n${JSON.stringify(receipt, null, 2)}\n`;
    const parsed = parseDeployReceipt(text);
    assert.equal(parsed.terminal, "BLOCKED");
    assert.equal(parsed.deployedHostP, false);
    assert.equal(parsed.enginePaused, true);
    const ev = buildFactualAuto3Evidence({
      manifest,
      deployOutput: text,
      buildSourceSha: manifest.sourceSha,
      buildReleaseId: manifest.releaseId,
    });
    assert.equal(ev.terminal, "BLOCKED");
    assert.equal(ev.hostPAccessed, false);
    assert.equal(ev.enginePaused, true);
    assert.equal(ev.highestMigration, "0039");
    assert.equal(ev.previousRelease, "auto3-0.74.0-beta.5-5f1b923bd815");
  });
});

describe("parent success / child BLOCKED", () => {
  it("opens parent-child-disagreement (PR #55 class)", () => {
    const n = evaluateLiveObservation({
      workflowName: "Upstream AUTO-2 Approve Sensitive",
      runId: "30705071215",
      attempt: 1,
      conclusion: "success",
      parentRunId: "30705071215",
      parentConclusion: "success",
      childRunId: "30705088925",
      childConclusion: "failure",
      childStatus: "completed",
      evidenceArtifact: {
        terminal: "BLOCKED",
        sourceSha: "16f24ed3b47321cc1b5aa693b2fac7e13a00b379",
        releaseId: "auto3-0.74.0-beta.6-16f24ed3b473",
        hostPAccessed: false,
      },
      expectedSourceSha: "16f24ed3b47321cc1b5aa693b2fac7e13a00b379",
      logText: "AUTO3_TERMINAL_STATUS=DEPLOYED\nAUTO3_TERMINAL_STATUS=BLOCKED\n",
    });
    assert.equal(n.openIncident, true);
    assert.equal(n.failureClass, "parent-child-disagreement");
    assert.equal(n.instance.childTerminal, "BLOCKED");
  });
});

describe("live-shaped handoff reconciliation", () => {
  it("builds handoffs and detects missing child + disagreement", () => {
    const handoffs = buildHandoffsFromRuns({
      auto2Runs: [
        {
          id: 30705071215,
          name: "Upstream AUTO-2 Approve Sensitive",
          status: "completed",
          conclusion: "success",
          created_at: "2026-08-01T14:00:00Z",
          updated_at: "2026-08-01T14:05:00Z",
          head_sha: "16f24ed3b47321cc1b5aa693b2fac7e13a00b379",
        },
        {
          id: 30800000001,
          name: "Upstream AUTO-2 Finalize",
          status: "completed",
          conclusion: "success",
          created_at: "2026-08-01T12:00:00Z",
          updated_at: "2026-08-01T12:01:00Z",
          head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
      auto3Runs: [
        {
          id: 30705088925,
          name: "AUTO-3 auto2-30705071215-1-16f24ed3b473-abcd staging",
          display_title: "AUTO-3 auto2-30705071215-1-16f24ed3b473-abcd 16f24ed3b47321cc1b5aa693b2fac7e13a00b379 pr=55 staging",
          event: "workflow_dispatch",
          status: "completed",
          conclusion: "failure",
          created_at: "2026-08-01T14:02:00Z",
          head_sha: "16f24ed3b47321cc1b5aa693b2fac7e13a00b379",
          head_branch: "main",
        },
      ],
      evidenceByRunId: {
        "30705088925": { terminal: "BLOCKED", sourceSha: "16f24ed3b47321cc1b5aa693b2fac7e13a00b379" },
      },
      logsByRunId: {
        "30705071215": "handoff=auto2-30705071215-1-16f24ed3b473-abcd run=30705088925",
      },
    });

    assert.ok(handoffs.length >= 2);
    const disagree = handoffs.find((h) => String(h.parentRunId) === "30705071215");
    assert.ok(disagree);
    assert.equal(disagree.childTerminal, "BLOCKED");

    const r = reconcileRuns({
      nowMs: Date.parse("2026-08-01T16:00:00Z"),
      missingChildTimeoutMs: 45 * 60 * 1000,
      handoffs,
    });
    assert.ok(r.candidates.some((c) => c.failureClass === "parent-child-disagreement"));
    assert.ok(r.candidates.some((c) => c.failureClass === "missing-child-timeout"));
  });
});

describe("duplicate-race upsert", () => {
  it("re-search before create appends when another steward won the race", async () => {
    const n = normalizeEvidence({
      workflowName: "Upstream AUTO-3 Deploy",
      runId: 100,
      attempt: 1,
      failureClass: "version-gate-drift",
      phase: "trusted-host-d-deploy",
      component: "installer",
      errorMessage: "package-version-mismatch",
      terminalStatus: "BLOCKED",
      forceIncident: true,
    });
    const seed = buildNewIssueContent(n);
    /** @type {import("../upsert-incident.mjs").IssueLike[]} */
    const issues = [];
    let searches = 0;
    let creates = 0;
    const client = {
      async searchIssuesByMarker(fp) {
        searches += 1;
        if (searches === 1) {
          // Another steward creates after our empty plan search.
          issues.push({
            number: 7,
            title: seed.title,
            state: "open",
            body: `${fingerprintMarkerHtml(n.fingerprint)}\n\noccurrence-id: workflow-run:99:attempt:1\n`,
          });
          return [];
        }
        return issues.filter((i) => (i.body || "").includes(`sha256:${fp}`));
      },
      async createIssue() {
        creates += 1;
        throw new Error("create should not run after re-search finds issue");
      },
      async updateIssue(number, patch) {
        const issue = issues.find((i) => i.number === number);
        if (!issue) throw new Error("missing");
        if (patch.body != null) issue.body = patch.body;
        if (patch.state != null) issue.state = patch.state;
        return issue;
      },
    };
    const r = await upsertIncident(client, n);
    assert.equal(r.action, "append");
    assert.equal(creates, 0);
    assert.equal(issues.length, 1);
    assert.ok(issues[0].body.includes(n.instance.occurrenceId));
  });
});
