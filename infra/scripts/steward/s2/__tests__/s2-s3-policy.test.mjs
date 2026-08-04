#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateS2Eligibility, S2_PLAYBOOKS } from "../policy.mjs";
import { describePlaybook, suggestPlaybooksForPaths } from "../playbooks.mjs";
import { evaluateS3Eligibility, mapAuthorityToNeedsOwner } from "../../s3/policy.mjs";

describe("S2 policy", () => {
  it("disables without gate and non-LOW risk", () => {
    const r = evaluateS2Eligibility({
      risk: "SENSITIVE",
      testsGreen: true,
      s2GateEnabled: true,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.reasons.includes("risk-not-low"));
  });

  it("eligible LOW + green + gate", () => {
    const r = evaluateS2Eligibility({
      risk: "LOW",
      testsGreen: true,
      s2GateEnabled: true,
    });
    assert.equal(r.eligible, true);
    assert.equal(S2_PLAYBOOKS.length, 6);
  });

  it("playbooks never ours/theirs — regenerate command present", () => {
    const d = describePlaybook("generated-baselines", {
      conflictPaths: ["scripts/lib/lifecycle-column-census-baseline.json"],
    });
    assert.match(d.never, /ours\/theirs/);
    assert.equal(d.sourceOfTruth, "final-merged-tree");
    assert.deepEqual(
      suggestPlaybooksForPaths([
        "scripts/lib/lifecycle-column-census-baseline.json",
        "pnpm-lock.yaml",
      ]),
      ["generated-baselines", "lockfile-regen-unchanged-intent"],
    );
  });
});

describe("S3 policy", () => {
  it("requires validation B/C + rollback + gate", () => {
    const r = evaluateS3Eligibility({
      risk: "SENSITIVE",
      validationLevel: "B",
      rollbackPlan: "revert release to previous Host D id",
      s3GateEnabled: true,
    });
    assert.equal(r.eligible, true);
  });

  it("maps Host P authority to NEEDS_OWNER", () => {
    const m = mapAuthorityToNeedsOwner({
      hostP: true,
      production: false,
      destructiveData: false,
      secretExpansion: false,
    });
    assert.equal(m.verdict, "NEEDS_OWNER");
    assert.equal(m.durable, true);
  });
});
