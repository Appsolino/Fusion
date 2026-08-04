#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateS1bEligibility } from "../policy.mjs";

describe("S1B eligibility", () => {
  it("requires gate + ACCEPT + repairRecommended", () => {
    const base = {
      issueNumber: 74,
      occurrence: "workflow-run:1:attempt:1",
      fingerprint: "a".repeat(64),
      repairRecommended: true,
      reviewVerdict: "ACCEPT",
      risk: "SENSITIVE",
      s1bGateEnabled: true,
    };
    assert.equal(evaluateS1bEligibility(base).eligible, true);
    assert.equal(
      evaluateS1bEligibility({ ...base, s1bGateEnabled: false }).eligible,
      false,
    );
    assert.equal(
      evaluateS1bEligibility({ ...base, reviewVerdict: "REJECT" }).eligible,
      false,
    );
    assert.equal(
      evaluateS1bEligibility({ ...base, existingRepairPr: 99 }).eligible,
      false,
    );
    assert.equal(
      evaluateS1bEligibility({ ...base, risk: "CRITICAL" }).eligible,
      false,
    );
  });
});
