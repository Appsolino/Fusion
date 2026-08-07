#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-20:04:
 * Provenance evidence grounding, lease anti-thrash, release observation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyUpstream, LARGE_FILE_COUNT } from "../auto2-classify-upstream.mjs";
import {
  classifyChangeProvenance,
  classifyUpstreamWithProvenance,
} from "../upstream/provenance-risk.mjs";
import { extractProvenanceEvidenceFromSyncStatus } from "../upstream/provenance-evidence.mjs";
import {
  canAcquireCandidateLease,
  LEASE_LABEL_SENSITIVE,
  LEASE_LABEL_REPAIR,
} from "../upstream/candidate-lease.mjs";
import { classifyReleaseFreshness } from "../upstream/release-freshness.mjs";
import { observeReleaseFreshness } from "../upstream/observe-release-freshness.mjs";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("provenance-risk", () => {
  it("missing evidence never yields EXACT_UPSTREAM", () => {
    const p = classifyChangeProvenance({ isAutomationUpstreamPr: true });
    assert.equal(p.provenance, "MIXED");
    assert.match(p.reasons.join(" "), /incomplete/);
  });

  it("pure upstream with complete evidence → EXACT_UPSTREAM", () => {
    const p = classifyChangeProvenance({
      isAutomationUpstreamPr: true,
      evidenceComplete: true,
      conflictResolutionRecorded: false,
      conflictedFiles: [],
      localPatchPathsTouched: [],
      appsolinoOnlyPaths: [],
    });
    assert.equal(p.provenance, "EXACT_UPSTREAM");
  });

  it("resolved AUTO-1 conflict remains CONFLICT_RESOLUTION after mergeable", () => {
    const evidence = extractProvenanceEvidenceFromSyncStatus({
      outcome: "merged",
      conflictedFiles: [],
      upstreamFixedConflictResolution: {
        action: "TAKE_UPSTREAM",
        retiredPatchIds: ["FIX-LANE-WIRING-TOUCH-FIXTURE"],
        resolvedConflictedFiles: ["packages/engine/src/x.ts"],
      },
    });
    assert.equal(evidence.evidenceComplete, true);
    assert.equal(evidence.conflictResolutionRecorded, true);
    const p = classifyChangeProvenance({
      isAutomationUpstreamPr: true,
      evidenceComplete: true,
      conflictResolutionRecorded: evidence.conflictResolutionRecorded,
      conflictedFiles: evidence.conflictedFiles,
      localPatchPathsTouched: evidence.localPatchPathsTouched,
      appsolinoOnlyPaths: evidence.appsolinoOnlyPaths,
    });
    assert.equal(p.provenance, "CONFLICT_RESOLUTION");
  });

  it("local patch adaptation → MIXED", () => {
    const p = classifyChangeProvenance({
      isAutomationUpstreamPr: true,
      evidenceComplete: true,
      localPatchPathsTouched: [".appsolino/patches/FIX-ISS-UI-001.json"],
    });
    assert.equal(p.provenance, "MIXED");
  });

  it("does not escalate automation absorb to sensitive on volume alone", () => {
    const files = Array.from({ length: LARGE_FILE_COUNT }, (_, i) => `docs/note-${i}.md`);
    const r = classifyUpstream({
      changedFiles: files,
      commitCount: 1,
      isAutomationPr: true,
    });
    assert.notEqual(r.riskClass, "sensitive");
    assert.match(r.reasons.join(" "), /observability/);
  });

  it("EXACT_UPSTREAM + HIGH impact keeps no human / prefer sensitive review", () => {
    const files = [
      "packages/core/migrations/0045_foo.sql",
      ...Array.from({ length: 100 }, (_, i) => `packages/engine/src/f${i}.ts`),
    ];
    const r = classifyUpstreamWithProvenance({
      changedFiles: files,
      commitCount: 13,
      isAutomationPr: true,
      evidenceComplete: true,
      conflictResolutionRecorded: false,
      conflictedFiles: [],
      localPatchPathsTouched: [],
      appsolinoOnlyPaths: [],
    });
    assert.equal(r.provenance, "EXACT_UPSTREAM");
    assert.equal(r.integrationImpact, "HIGH");
    assert.equal(r.riskClass, "sensitive");
    assert.equal(r.humanReviewRequired, false);
    assert.equal(r.preferSensitiveReview, true);
  });
});

describe("candidate-lease", () => {
  it("acquires when free", () => {
    const r = canAcquireCandidateLease({
      labels: [],
      headRefOid: HEAD,
      requestedMode: "sensitive-review",
      validatedHead: HEAD,
    });
    assert.equal(r.ok, true);
    assert.equal(r.action, "ACQUIRE");
    assert.equal(r.dispatch, true);
  });

  it("ALREADY_RUNNING when same mode active — no dispatch thrash", () => {
    const r = canAcquireCandidateLease({
      labels: [{ name: LEASE_LABEL_SENSITIVE }],
      headRefOid: HEAD,
      requestedMode: "sensitive-review",
      validatedHead: HEAD,
      activeSameModeRun: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.action, "ALREADY_RUNNING");
    assert.equal(r.dispatch, false);
  });

  it("RETRY_AFTER_TERMINAL when label held but run finished", () => {
    const r = canAcquireCandidateLease({
      labels: [{ name: LEASE_LABEL_SENSITIVE }],
      headRefOid: HEAD,
      requestedMode: "sensitive-review",
      validatedHead: HEAD,
      activeSameModeRun: false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.action, "RETRY_AFTER_TERMINAL");
    assert.equal(r.dispatch, true);
  });

  it("allows sensitive → repair handoff", () => {
    const r = canAcquireCandidateLease({
      labels: [{ name: LEASE_LABEL_SENSITIVE }],
      headRefOid: HEAD,
      requestedMode: "repair",
      validatedHead: HEAD,
    });
    assert.equal(r.ok, true);
    assert.equal(r.action, "HANDOFF");
  });

  it("refuses concurrent sensitive while repair held", () => {
    const r = canAcquireCandidateLease({
      labels: [{ name: LEASE_LABEL_REPAIR }],
      headRefOid: HEAD,
      requestedMode: "sensitive-review",
      validatedHead: HEAD,
    });
    assert.equal(r.ok, false);
    assert.equal(r.action, "LEASE_HELD");
  });

  it("new head requires refresh", () => {
    const r = canAcquireCandidateLease({
      labels: [{ name: LEASE_LABEL_SENSITIVE }],
      headRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      requestedMode: "sensitive-review",
      validatedHead: HEAD,
      activeSameModeRun: true,
    });
    assert.equal(r.action, "REFRESH_REQUIRED");
  });
});

describe("release-freshness", () => {
  it("flags source 0.75.1 vs published 0.73.0 as RELEASE_STALE", () => {
    const r = classifyReleaseFreshness({
      sourceVersion: "0.75.1",
      latestPublishedVersion: "v0.73.0",
    });
    assert.equal(r.status, "RELEASE_STALE");
  });

  it("observeReleaseFreshness writes RELEASE_STALE from mocked gh", () => {
    const dir = mkdtempSync(join(tmpdir(), "rel-fresh-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "0.75.1" }));
    mkdirSync(join(dir, ".appsolino"), { recursive: true });
    const runGh = (args) => {
      const joined = args.join(" ");
      if (joined.includes("Appsolino/Fusion/releases/latest")) {
        return { status: 0, stdout: JSON.stringify({ tag: "v0.73.0", sha: "main" }), stderr: "" };
      }
      if (joined.includes("Appsolino/Fusion/tags")) {
        return { status: 0, stdout: JSON.stringify({ name: "v0.73.0", sha: "abc" }), stderr: "" };
      }
      if (joined.includes("Runfusion/Fusion/releases/latest")) {
        return { status: 0, stdout: JSON.stringify({ tag: "v0.75.1", sha: "main" }), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "no" };
    };
    const out = observeReleaseFreshness({
      repoDir: dir,
      runGh,
      appsolinoRepo: "Appsolino/Fusion",
      upstreamRepo: "Runfusion/Fusion",
    });
    assert.equal(out.status, "RELEASE_STALE");
    assert.equal(out.sourceVersion, "0.75.1");
    assert.equal(out.latestPublishedVersion, "0.73.0");
    const disk = JSON.parse(readFileSync(join(dir, ".appsolino/release-freshness.json"), "utf8"));
    assert.equal(disk.status, "RELEASE_STALE");
  });
});
