#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Evidence normalization + classification from historical incident shapes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeEvidence, classifyFailure } from "../normalize-evidence.mjs";
import { collectFromFixture, comparePhysicalEvidence } from "../collect-evidence.mjs";
import { escapeMarkdown } from "../policy.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("evidence normalization", () => {
  it("classifies unknown failure as needs-triage", () => {
    const n = normalizeEvidence({
      workflowName: "Upstream AUTO-3 Deploy",
      workflowFamily: "auto3",
      runId: 1,
      terminalStatus: "FAILED",
      errorMessage: "completely novel unexplained failure xyzzy-plugh",
      logText: "xyzzy-plugh",
    });
    assert.equal(n.failureClass, "needs-triage");
    assert.equal(n.openIncident, true);
  });

  it("detects parent/child disagreement from terminals", () => {
    const c = classifyFailure({
      parentTerminal: "DEPLOYED",
      childTerminal: "BLOCKED",
    });
    assert.equal(c.failureClass, "parent-child-disagreement");
  });

  it("escapes hostile markdown in log excerpts", () => {
    const n = normalizeEvidence({
      workflowName: "Upstream AUTO-3 Deploy",
      runId: 2,
      failureClass: "needs-triage",
      terminalStatus: "FAILED",
      logText: "evil <script> **boom** [x](y)",
      forceIncident: true,
    });
    assert.ok(n.instance.logExcerpt.includes("&lt;"));
    assert.ok(n.instance.logExcerpt.includes("\\*\\*"));
    assert.equal(escapeMarkdown("<"), "&lt;");
  });

  it("compares physical evidence without Host D SSH", () => {
    const ok = comparePhysicalEvidence({
      parentTerminal: "DEPLOYED",
      childTerminal: "DEPLOYED",
      lastMarker: "DEPLOYED",
      evidenceArtifact: {
        terminal: "DEPLOYED",
        sourceSha: "16f24ed3b47321cc1b5aa693b2fac7e13a00b379",
        hostPAccessed: false,
        enginePaused: true,
      },
      expectedMergedSha: "16f24ed3b47321cc1b5aa693b2fac7e13a00b379",
    });
    assert.equal(ok.ok, true);

    const bad = comparePhysicalEvidence({
      parentTerminal: "DEPLOYED",
      childTerminal: "BLOCKED",
      lastMarker: "DEPLOYED",
      evidenceArtifact: { terminal: "BLOCKED", hostPAccessed: false },
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.notes.some((n) => n.kind === "parent-child-terminal"));
  });

  it("loads required historical fixtures", () => {
    for (const name of [
      "correlation-race",
      "yaml-parse",
      "summary-syntax",
      "terminal-marker",
      "version-drift",
      "generated-file-conflict",
      "success",
    ]) {
      const { normalized, expected } = collectFromFixture(join(FIXTURES, name));
      assert.ok(expected, name);
      if (expected.incident === false) assert.equal(normalized.openIncident, false);
      else assert.equal(normalized.openIncident, true, name);
    }
  });
});
