#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-19:57:
 * Provenance + integration-impact + candidate lease + release freshness.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyUpstream, LARGE_FILE_COUNT } from "../auto2-classify-upstream.mjs";
import {
  classifyChangeProvenance,
  classifyUpstreamWithProvenance,
} from "../upstream/provenance-risk.mjs";
import { canAcquireCandidateLease, LEASE_LABEL_SENSITIVE, LEASE_LABEL_REPAIR } from "../upstream/candidate-lease.mjs";
import { classifyReleaseFreshness } from "../upstream/release-freshness.mjs";

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("provenance-risk", () => {
  it("marks automation absorb without conflicts as EXACT_UPSTREAM", () => {
    const p = classifyChangeProvenance({ isAutomationUpstreamPr: true });
    assert.equal(p.provenance, "EXACT_UPSTREAM");
  });

  it("marks conflict resolution when conflicted files present", () => {
    const p = classifyChangeProvenance({
      isAutomationUpstreamPr: true,
      conflictedFiles: ["packages/core/x.ts"],
    });
    assert.equal(p.provenance, "CONFLICT_RESOLUTION");
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

  it("keeps migrations as HIGH impact + EXACT_UPSTREAM policy without human", () => {
    const files = [
      "packages/core/migrations/0045_foo.sql",
      ...Array.from({ length: 100 }, (_, i) => `packages/engine/src/f${i}.ts`),
    ];
    const r = classifyUpstreamWithProvenance({
      changedFiles: files,
      commitCount: 13,
      isAutomationPr: true,
    });
    assert.equal(r.provenance, "EXACT_UPSTREAM");
    assert.equal(r.integrationImpact, "HIGH");
    assert.equal(r.riskClass, "sensitive");
    assert.equal(r.humanReviewRequired, false);
    assert.equal(r.preferSensitiveReview, true);
    assert.match(r.policySummary, /no human/);
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
  });

  it("continues when same mode held", () => {
    const r = canAcquireCandidateLease({
      labels: [{ name: LEASE_LABEL_SENSITIVE }],
      headRefOid: HEAD,
      requestedMode: "sensitive-review",
      validatedHead: HEAD,
    });
    assert.equal(r.ok, true);
    assert.equal(r.action, "CONTINUE");
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

  it("refuses concurrent repair while repair held", () => {
    const r = canAcquireCandidateLease({
      labels: [{ name: LEASE_LABEL_REPAIR }],
      headRefOid: HEAD,
      requestedMode: "sensitive-review",
      validatedHead: HEAD,
    });
    assert.equal(r.ok, false);
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
    assert.equal(r.sourceVersion, "0.75.1");
    assert.equal(r.latestPublishedVersion, "0.73.0");
  });

  it("marks matching versions RELEASE_CURRENT", () => {
    const r = classifyReleaseFreshness({
      sourceVersion: "0.75.1",
      latestPublishedVersion: "0.75.1",
    });
    assert.equal(r.status, "RELEASE_CURRENT");
  });

  it("marks version-change as RELEASE_PENDING when flagged", () => {
    const r = classifyReleaseFreshness({
      sourceVersion: "0.75.1",
      latestPublishedVersion: "0.73.0",
      upstreamVersionChanged: true,
    });
    assert.equal(r.status, "RELEASE_PENDING");
  });
});
