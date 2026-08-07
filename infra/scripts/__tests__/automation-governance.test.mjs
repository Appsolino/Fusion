#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-20:15:
 * Provenance schema completeness, maintenance vs product delta, lease run-name matching.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyUpstream, LARGE_FILE_COUNT } from "../auto2-classify-upstream.mjs";
import {
  classifyChangeProvenance,
  classifyUpstreamWithProvenance,
} from "../upstream/provenance-risk.mjs";
import {
  extractProvenanceEvidenceFromSyncStatus,
  buildProvenanceEvidenceBlock,
  classifyPathProvenanceRole,
  PROVENANCE_EVIDENCE_VERSION,
} from "../upstream/provenance-evidence.mjs";
import {
  canAcquireCandidateLease,
  matchExpertRunByIdentity,
  parseExpertRunIdentity,
  hasActiveExpertSameModeRun,
  LEASE_LABEL_SENSITIVE,
  LEASE_LABEL_REPAIR,
} from "../upstream/candidate-lease.mjs";
import { classifyReleaseFreshness } from "../upstream/release-freshness.mjs";
import { observeReleaseFreshness } from "../upstream/observe-release-freshness.mjs";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MAIN_SHA = "e3c3986bf290964964f0a646e86a0963db25c9d8";
const CANDIDATE = "1f9b0e644abb27e19803637803d74e37d7c45ce2";

function completeExactUpstreamStatus(overrides = {}) {
  return {
    outcome: "merged",
    conflictedFiles: [],
    ...buildProvenanceEvidenceBlock({
      conflictReconciliationComplete: true,
      patchReconciliationComplete: true,
      localDeltaClassificationComplete: true,
      localDeltaKind: "NONE",
      appsolinoProductPaths: [],
      adaptedPaths: [],
    }),
    ...overrides,
  };
}

describe("provenance-evidence-schema", () => {
  it("missing status → incomplete", () => {
    const e = extractProvenanceEvidenceFromSyncStatus(null);
    assert.equal(e.evidenceComplete, false);
  });

  it("empty {} → incomplete (not EXACT_UPSTREAM)", () => {
    const e = extractProvenanceEvidenceFromSyncStatus({});
    assert.equal(e.evidenceComplete, false);
    const p = classifyChangeProvenance({
      isAutomationUpstreamPr: true,
      evidenceComplete: e.evidenceComplete,
    });
    assert.equal(p.provenance, "MIXED");
  });

  it("old schema status without provenanceEvidenceVersion → incomplete", () => {
    const e = extractProvenanceEvidenceFromSyncStatus({
      outcome: "merged",
      conflictedFiles: [],
      upstreamFixedConflictResolution: null,
    });
    assert.equal(e.evidenceComplete, false);
  });

  it("partial new schema (missing a completion flag) → incomplete", () => {
    const e = extractProvenanceEvidenceFromSyncStatus({
      provenanceEvidenceVersion: PROVENANCE_EVIDENCE_VERSION,
      conflictReconciliationComplete: true,
      patchReconciliationComplete: true,
      // localDeltaClassificationComplete missing
    });
    assert.equal(e.evidenceComplete, false);
  });

  it("complete exact-upstream evidence → EXACT_UPSTREAM", () => {
    const e = extractProvenanceEvidenceFromSyncStatus(completeExactUpstreamStatus(), {
      prChangedFiles: [
        "packages/engine/src/x.ts",
        ".appsolino/upstream-sync-status.json",
        ".appsolino/upstream-freshness.json",
        ".appsolino/release-freshness.json",
        ".appsolino/patches/proofs/fix-iss-ui-001-1f9b0e644abb.json",
      ],
    });
    assert.equal(e.evidenceComplete, true);
    assert.equal(e.conflictResolutionRecorded, false);
    assert.equal(e.appsolinoOnlyPaths.length, 0);
    assert.equal(e.localPatchPathsTouched.length, 0);
    assert.ok(e.maintenanceMetadataPaths.length >= 3);
    const p = classifyChangeProvenance({
      isAutomationUpstreamPr: true,
      evidenceComplete: true,
      conflictResolutionRecorded: false,
      conflictedFiles: e.conflictedFiles,
      localPatchPathsTouched: e.localPatchPathsTouched,
      appsolinoOnlyPaths: e.appsolinoOnlyPaths,
    });
    assert.equal(p.provenance, "EXACT_UPSTREAM");
  });

  it("complete conflict-resolution evidence stays CONFLICT_RESOLUTION after mergeable", () => {
    const e = extractProvenanceEvidenceFromSyncStatus({
      ...completeExactUpstreamStatus(),
      upstreamFixedConflictResolution: {
        action: "TAKE_UPSTREAM",
        retiredPatchIds: ["FIX-LANE-WIRING-TOUCH-FIXTURE"],
        resolvedConflictedFiles: ["packages/engine/src/x.ts"],
      },
    });
    assert.equal(e.evidenceComplete, true);
    assert.equal(e.conflictResolutionRecorded, true);
    const p = classifyChangeProvenance({
      isAutomationUpstreamPr: true,
      evidenceComplete: true,
      conflictResolutionRecorded: true,
      conflictedFiles: e.conflictedFiles,
      localPatchPathsTouched: [],
      appsolinoOnlyPaths: [],
    });
    assert.equal(p.provenance, "CONFLICT_RESOLUTION");
  });

  it("local adaptation kind ADAPTED → MIXED via durable paths", () => {
    const e = extractProvenanceEvidenceFromSyncStatus(
      completeExactUpstreamStatus({
        ...buildProvenanceEvidenceBlock({
          conflictReconciliationComplete: true,
          patchReconciliationComplete: true,
          localDeltaClassificationComplete: true,
          localDeltaKind: "ADAPTED",
          appsolinoProductPaths: ["packages/dashboard/app/Foo.tsx"],
          adaptedPaths: [".appsolino/patches/FIX-ISS-UI-001.json"],
        }),
      }),
    );
    assert.equal(e.localPatchPathsTouched.length, 1);
    assert.equal(e.appsolinoOnlyPaths.length, 1);
    const p = classifyChangeProvenance({
      isAutomationUpstreamPr: true,
      evidenceComplete: true,
      localPatchPathsTouched: e.localPatchPathsTouched,
      appsolinoOnlyPaths: e.appsolinoOnlyPaths,
    });
    assert.equal(p.provenance, "MIXED");
  });

  it("classifies maintenance vs product path roles", () => {
    assert.equal(
      classifyPathProvenanceRole(".appsolino/upstream-sync-status.json"),
      "MAINTENANCE_METADATA",
    );
    assert.equal(
      classifyPathProvenanceRole(".appsolino/patches/proofs/x.json"),
      "MAINTENANCE_METADATA",
    );
    assert.equal(
      classifyPathProvenanceRole("packages/engine/src/a.ts"),
      "UPSTREAM_PRODUCT_DELTA",
    );
  });
});

describe("provenance-risk", () => {
  it("does not escalate automation absorb to sensitive on volume alone", () => {
    const files = Array.from({ length: LARGE_FILE_COUNT }, (_, i) => `docs/note-${i}.md`);
    const r = classifyUpstream({
      changedFiles: files,
      commitCount: 1,
      isAutomationPr: true,
    });
    assert.notEqual(r.riskClass, "sensitive");
  });

  it("EXACT_UPSTREAM + HIGH impact keeps no human", () => {
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
    assert.equal(r.humanReviewRequired, false);
  });
});

describe("candidate-lease-run-name", () => {
  it("parses AUTO2 Expert run-name", () => {
    const id = parseExpertRunIdentity(
      `AUTO2 Expert PR#144 mode=sensitive-review candidate=${CANDIDATE}`,
    );
    assert.deepEqual(id, {
      pr: "144",
      mode: "sensitive-review",
      candidate: CANDIDATE,
    });
  });

  it("fixture 31210745085: workflow_dispatch head_sha=main must not be used; run-name matches candidate", () => {
    // Real shape: event=workflow_dispatch, head_branch=main, head_sha=main tip.
    const run = {
      id: 31210745085,
      event: "workflow_dispatch",
      head_branch: "main",
      head_sha: MAIN_SHA,
      display_title: `AUTO2 Expert PR#144 mode=sensitive-review candidate=${CANDIDATE}`,
      status: "in_progress",
    };
    assert.notEqual(run.head_sha, CANDIDATE);
    assert.equal(
      matchExpertRunByIdentity(run, {
        prNumber: 144,
        mode: "sensitive-review",
        validatedHead: CANDIDATE,
      }),
      true,
    );
    assert.equal(
      matchExpertRunByIdentity(run, {
        prNumber: 144,
        mode: "repair",
        validatedHead: CANDIDATE,
      }),
      false,
    );
    assert.equal(
      matchExpertRunByIdentity(run, {
        prNumber: 144,
        mode: "sensitive-review",
        validatedHead: HEAD,
      }),
      false,
    );
  });

  it("hasActiveExpertSameModeRun uses run-name not head_sha", () => {
    const runGh = (args) => {
      const joined = args.join(" ");
      if (joined.includes("status=in_progress")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: 31210745085,
              event: "workflow_dispatch",
              head_branch: "main",
              head_sha: MAIN_SHA,
              display_title: `AUTO2 Expert PR#144 mode=sensitive-review candidate=${CANDIDATE}`,
              status: "in_progress",
            },
          ]),
          stderr: "",
        };
      }
      return { status: 0, stdout: "[]", stderr: "" };
    };
    const r = hasActiveExpertSameModeRun(runGh, {
      repo: "Appsolino/Fusion",
      prNumber: 144,
      mode: "sensitive-review",
      validatedHead: CANDIDATE,
    });
    assert.equal(r.active, true);
    const lease = canAcquireCandidateLease({
      labels: [{ name: LEASE_LABEL_SENSITIVE }],
      headRefOid: CANDIDATE,
      requestedMode: "sensitive-review",
      validatedHead: CANDIDATE,
      activeSameModeRun: r.active,
    });
    assert.equal(lease.action, "ALREADY_RUNNING");
    assert.equal(lease.dispatch, false);
  });

  it("queued same candidate → active", () => {
    const runGh = (args) => {
      if (args.join(" ").includes("status=queued")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              display_title: `AUTO2 Expert PR#9 mode=repair candidate=${CANDIDATE}`,
              head_sha: MAIN_SHA,
              status: "queued",
            },
          ]),
          stderr: "",
        };
      }
      return { status: 0, stdout: "[]", stderr: "" };
    };
    assert.equal(
      hasActiveExpertSameModeRun(runGh, {
        repo: "Appsolino/Fusion",
        prNumber: 9,
        mode: "repair",
        validatedHead: CANDIDATE,
      }).active,
      true,
    );
  });

  it("completed-only (no active list) → RETRY_AFTER_TERMINAL", () => {
    const runGh = () => ({ status: 0, stdout: "[]", stderr: "" });
    const active = hasActiveExpertSameModeRun(runGh, {
      repo: "Appsolino/Fusion",
      prNumber: 144,
      mode: "sensitive-review",
      validatedHead: CANDIDATE,
    });
    assert.equal(active.active, false);
    const lease = canAcquireCandidateLease({
      labels: [{ name: LEASE_LABEL_SENSITIVE }],
      headRefOid: CANDIDATE,
      requestedMode: "sensitive-review",
      validatedHead: CANDIDATE,
      activeSameModeRun: false,
    });
    assert.equal(lease.action, "RETRY_AFTER_TERMINAL");
  });

  it("same PR different mode does not match", () => {
    const run = {
      display_title: `AUTO2 Expert PR#144 mode=sensitive-review candidate=${CANDIDATE}`,
      head_sha: MAIN_SHA,
    };
    assert.equal(
      matchExpertRunByIdentity(run, { prNumber: 144, mode: "repair", validatedHead: CANDIDATE }),
      false,
    );
  });

  it("allows sensitive → repair handoff", () => {
    const r = canAcquireCandidateLease({
      labels: [{ name: LEASE_LABEL_SENSITIVE }],
      headRefOid: HEAD,
      requestedMode: "repair",
      validatedHead: HEAD,
    });
    assert.equal(r.action, "HANDOFF");
  });

  it("refuses concurrent sensitive while repair held", () => {
    const r = canAcquireCandidateLease({
      labels: [{ name: LEASE_LABEL_REPAIR }],
      headRefOid: HEAD,
      requestedMode: "sensitive-review",
      validatedHead: HEAD,
    });
    assert.equal(r.action, "LEASE_HELD");
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
    const disk = JSON.parse(readFileSync(join(dir, ".appsolino/release-freshness.json"), "utf8"));
    assert.equal(disk.status, "RELEASE_STALE");
  });
});
