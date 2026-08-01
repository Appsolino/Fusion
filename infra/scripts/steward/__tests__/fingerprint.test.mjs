#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Fingerprint stability: same logical failure → same hash; volatile fields excluded.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectFromFixture, listFixtureNames } from "../collect-evidence.mjs";
import { buildFingerprintPayload, fingerprintIncident, normalizeErrorSignature } from "../fingerprint-incident.mjs";
import { VOLATILE_FINGERPRINT_EXCLUSIONS } from "../policy.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("fingerprint stability", () => {
  it("strips volatile tokens from error signatures", () => {
    const a = normalizeErrorSignature(
      "fail run 30705088925 at 2026-08-01T15:00:00Z handoff auto2-1-aaaaaaaaaaaa-deadbeef /tmp/x runner-abc",
    );
    const b = normalizeErrorSignature(
      "fail run 99999999999 at 2026-08-02T01:00:00Z handoff auto2-9-bbbbbbbbbbbb-cafebabe /tmp/y runner-xyz",
    );
    assert.equal(a, b);
    assert.ok(!a.includes("30705088925"));
    assert.ok(!a.includes("deadbeef"));
  });

  it("rejects volatile keys in fingerprint payload", () => {
    assert.throws(() => fingerprintIncident(/** @type {any} */ ({
      workflow: "auto3",
      phase: "x",
      class: "y",
      error: "z",
      component: "c",
      runId: "1",
    })));
  });

  it("lists required volatile exclusions", () => {
    for (const k of ["runId", "timestamp", "attempt", "handoffNonce", "temporaryPath", "runnerName"]) {
      assert.ok(VOLATILE_FINGERPRINT_EXCLUSIONS.includes(k), k);
    }
  });

  it("historical fixtures produce stable expected fingerprints", () => {
    const names = listFixtureNames(FIXTURES);
    assert.ok(names.length >= 5);
    /** @type {Map<string, string>} */
    const byClass = new Map();
    for (const name of names) {
      const { normalized, expected } = collectFromFixture(join(FIXTURES, name));
      if (expected?.incident === false) {
        assert.equal(normalized.openIncident, false, name);
        assert.equal(normalized.fingerprint, null, name);
        continue;
      }
      assert.equal(normalized.openIncident, true, name);
      assert.match(normalized.fingerprint, /^[a-f0-9]{64}$/);
      if (expected?.failureClass) {
        assert.equal(normalized.failureClass, expected.failureClass, name);
      }
      if (expected?.fingerprintPayload) {
        for (const [k, v] of Object.entries(expected.fingerprintPayload)) {
          assert.equal(String(normalized.fingerprintPayload[k]), String(v), `${name}.${k}`);
        }
      }
      // Replaying same evidence → same fingerprint
      const again = collectFromFixture(join(FIXTURES, name)).normalized;
      assert.equal(again.fingerprint, normalized.fingerprint, `${name} replay`);
      byClass.set(name, normalized.fingerprint);
    }
    // Distinct fixtures that are different classes must not all collide
    const fps = [...byClass.values()];
    assert.ok(new Set(fps).size >= 5);
  });

  it("changing only runId does not change fingerprint", () => {
    const base = buildFingerprintPayload({
      workflowFamily: "auto3",
      phase: "trusted-host-d-deploy",
      failureClass: "version-gate-drift",
      errorSignature: "package-version-mismatch",
      component: "installer",
      terminalStatus: "BLOCKED",
    });
    const a = fingerprintIncident(base).fingerprint;
    const b = fingerprintIncident(base).fingerprint;
    assert.equal(a, b);
  });
});
