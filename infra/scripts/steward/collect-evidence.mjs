#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Collect observation evidence from trusted fixtures or already-fetched untrusted
 * API/log payloads. Never check out candidate heads; never execute candidate scripts.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeEvidence } from "./normalize-evidence.mjs";

/**
 * Load a fixture directory containing evidence.json (+ optional expected.json).
 * @param {string} fixtureDir
 */
export function loadFixture(fixtureDir) {
  const evidencePath = join(fixtureDir, "evidence.json");
  if (!existsSync(evidencePath)) {
    throw new Error(`fixture missing evidence.json: ${fixtureDir}`);
  }
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  let expected = null;
  const expectedPath = join(fixtureDir, "expected.json");
  if (existsSync(expectedPath)) {
    expected = JSON.parse(readFileSync(expectedPath, "utf8"));
  }
  return { evidence, expected, fixtureDir };
}

/**
 * @param {string} fixturesRoot
 * @returns {string[]}
 */
export function listFixtureNames(fixturesRoot) {
  if (!existsSync(fixturesRoot)) return [];
  return readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * Build normalized incident candidates from a fixture.
 * @param {string} fixtureDir
 */
export function collectFromFixture(fixtureDir) {
  const { evidence, expected, fixtureDir: dir } = loadFixture(fixtureDir);
  const normalized = normalizeEvidence(evidence);
  return { source: "fixture", fixtureDir: dir, evidence, expected, normalized };
}

/**
 * Build from a workflow_run-shaped event already fetched by Actions (untrusted data).
 * Caller must pass log text as plain string — do not eval.
 *
 * @param {{
 *   workflowName: string,
 *   runId: string|number,
 *   attempt?: string|number,
 *   conclusion?: string|null,
 *   status?: string,
 *   headSha?: string,
 *   logText?: string,
 *   parentTerminal?: string|null,
 *   childTerminal?: string|null,
 *   parentRunId?: string|number|null,
 *   childRunId?: string|number|null,
 *   handoffId?: string|null,
 *   sourceSha?: string|null,
 *   evidenceArtifact?: object|null,
 *   failureClass?: string,
 *   errorMessage?: string,
 *   success?: boolean,
 *   missingChild?: boolean,
 * }} eventEvidence
 */
export function collectFromEvent(eventEvidence) {
  const normalized = normalizeEvidence(eventEvidence);
  return { source: "event", evidence: eventEvidence, expected: null, normalized };
}

/**
 * Compare AUTO-3 evidence artifact (if present) against parent claim / marker.
 * Returns disagreement notes; does not require Host D SSH.
 *
 * @param {{
 *   parentTerminal?: string|null,
 *   childTerminal?: string|null,
 *   lastMarker?: string|null,
 *   evidenceArtifact?: {
 *     terminal?: string,
 *     sourceSha?: string,
 *     releaseId?: string,
 *     applicationVersion?: string,
 *     highestMigration?: string,
 *     health?: string,
 *     enginePaused?: boolean,
 *     hostPAccessed?: boolean,
 *   }|null,
 *   expectedMergedSha?: string|null,
 * }} input
 */
export function comparePhysicalEvidence(input) {
  const notes = [];
  const art = input.evidenceArtifact;
  const parent = String(input.parentTerminal || "").toUpperCase();
  const child = String(input.childTerminal || "").toUpperCase();
  const marker = String(input.lastMarker || "").toUpperCase();

  if (parent && child && parent !== child) {
    notes.push({ kind: "parent-child-terminal", parent, child });
  }
  if (marker && child && marker !== child) {
    notes.push({ kind: "marker-child-terminal", marker, child });
  }
  if (art) {
    const artTerm = String(art.terminal || "").toUpperCase();
    if (artTerm && child && artTerm !== child) {
      notes.push({ kind: "artifact-child-terminal", artifact: artTerm, child });
    }
    if (art.hostPAccessed === true) {
      notes.push({ kind: "host-p-accessed", value: true });
    }
    if (input.expectedMergedSha && art.sourceSha
      && String(art.sourceSha).toLowerCase() !== String(input.expectedMergedSha).toLowerCase()) {
      notes.push({
        kind: "artifact-sha-mismatch",
        artifactSha: art.sourceSha,
        expected: input.expectedMergedSha,
      });
    }
  }
  return { ok: notes.length === 0, notes };
}
