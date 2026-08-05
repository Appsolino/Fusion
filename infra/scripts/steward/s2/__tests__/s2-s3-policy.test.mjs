#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertS2Pins,
  evaluateS2Eligibility,
  S2_PLAYBOOKS,
  S2_PROVIDER,
  S2_MODEL,
} from "../policy.mjs";
import {
  assertPlaybookAllowlisted,
  describePlaybook,
  suggestPlaybooksForPaths,
} from "../playbooks.mjs";
import { evaluateS2LowRiskClassification } from "../classify-low.mjs";
import {
  assertS3Pins,
  assertHostPForbidden,
  evaluateS3Eligibility,
  mapAuthorityToNeedsOwner,
  S3_PROVIDER,
  S3_MODEL,
} from "../../s3/policy.mjs";
import { describeS3RollbackPath, assertRollbackPlanSafe } from "../../s3/rollback.mjs";
import { REVIEW_PROVIDER, REVIEW_MODEL } from "../../review/policy.mjs";

describe("S2 policy", () => {
  it("disables without gate and non-LOW risk", () => {
    const r = evaluateS2Eligibility({
      risk: "SENSITIVE",
      testsGreen: true,
      playbookId: "generated-baselines",
      s2GateEnabled: true,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.reasons.includes("risk-not-low"));
  });

  it("requires gate", () => {
    const r = evaluateS2Eligibility({
      risk: "LOW",
      testsGreen: true,
      playbookId: "generated-baselines",
      s2GateEnabled: false,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.reasons.includes("s2-gate-disabled"));
  });

  it("eligible LOW + green + gate + allowlisted playbook", () => {
    const r = evaluateS2Eligibility({
      risk: "LOW",
      testsGreen: true,
      playbookId: "generated-baselines",
      s2GateEnabled: true,
    });
    assert.equal(r.eligible, true);
    assert.equal(S2_PLAYBOOKS.length, 6);
  });

  it("hostP forbidden", () => {
    const r = evaluateS2Eligibility({
      risk: "LOW",
      testsGreen: true,
      playbookId: "generated-baselines",
      s2GateEnabled: true,
      hostP: true,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.reasons.includes("hostP-forbidden"));
  });

  it("playbook allowlist — unknown rejected", () => {
    assert.throws(() => assertPlaybookAllowlisted("semantic-rewrite"), /not allowlisted/);
    const r = evaluateS2Eligibility({
      risk: "LOW",
      testsGreen: true,
      playbookId: "semantic-rewrite",
      s2GateEnabled: true,
    });
    assert.ok(r.reasons.includes("unknown-playbook"));
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

  it("does not suggest LOW playbooks for semantic/migration/permission/deployment", () => {
    assert.deepEqual(
      suggestPlaybooksForPaths([
        "packages/engine/src/executor.ts",
        "packages/db/migrations/001.sql",
        "infra/deploy/host-d.sh",
        ".github/workflows/permission-expand.yml",
      ]),
      [],
    );
  });

  it("no silent provider switch — pins match Cursor review", () => {
    assert.equal(S2_PROVIDER, REVIEW_PROVIDER);
    assert.equal(S2_MODEL, REVIEW_MODEL);
    assert.deepEqual(assertS2Pins({}), {
      provider: REVIEW_PROVIDER,
      model: REVIEW_MODEL,
    });
    assert.throws(
      () => assertS2Pins({ provider: "xai", model: REVIEW_MODEL }),
      /provider drift/,
    );
    assert.throws(
      () => assertS2Pins({ provider: REVIEW_PROVIDER, model: "grok-4" }),
      /model drift/,
    );
  });
});

describe("S2 low-risk classification", () => {
  it("accepts generated baseline playbook", () => {
    const r = evaluateS2LowRiskClassification({
      playbookId: "generated-baselines",
      paths: ["scripts/lib/lifecycle-column-census-baseline.json"],
    });
    assert.equal(r.ok, true);
  });

  it("rejects semantic-source as LOW", () => {
    const r = evaluateS2LowRiskClassification({
      playbookId: "generated-baselines",
      paths: ["packages/engine/src/executor.ts"],
    });
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("semantic-source")));
  });

  it("rejects workflow without metadata attestation", () => {
    const r = evaluateS2LowRiskClassification({
      playbookId: "known-safe-workflow-metadata",
      paths: [".github/workflows/ci.yml"],
    });
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("workflow")));
  });

  it("allows workflow metadata-only with attestation", () => {
    const r = evaluateS2LowRiskClassification({
      playbookId: "known-safe-workflow-metadata",
      paths: [".github/workflows/ci.yml"],
      workflowMetadataOnly: true,
    });
    assert.equal(r.ok, true);
  });

  it("rejects lockfile when dependency intent changed", () => {
    const r = evaluateS2LowRiskClassification({
      playbookId: "lockfile-regen-unchanged-intent",
      paths: ["pnpm-lock.yaml"],
      dependencyIntentUnchanged: false,
    });
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("dependency-intent")));
  });

  it("allows lockfile regen when intent unchanged", () => {
    const r = evaluateS2LowRiskClassification({
      playbookId: "lockfile-regen-unchanged-intent",
      paths: ["pnpm-lock.yaml"],
      dependencyIntentUnchanged: true,
    });
    assert.equal(r.ok, true);
  });

  it("rejects migration and permission/deployment paths", () => {
    const mig = evaluateS2LowRiskClassification({
      playbookId: "formatting-lint-only",
      paths: ["packages/db/migrations/002.sql"],
      formatOnly: true,
    });
    assert.equal(mig.ok, false);
    assert.ok(mig.reasons.some((x) => x.includes("migration")));

    const dep = evaluateS2LowRiskClassification({
      playbookId: "stale-status-document-fields",
      paths: ["infra/deploy/host-p-install.sh"],
    });
    assert.equal(dep.ok, false);
    assert.ok(dep.reasons.some((x) => /deployment|permission/.test(x)));
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

  it("gate required", () => {
    const r = evaluateS3Eligibility({
      risk: "SENSITIVE",
      validationLevel: "C",
      rollbackPlan: "revert merge on Appsolino main; Host P prohibited",
      s3GateEnabled: false,
    });
    assert.ok(r.reasons.includes("s3-gate-disabled"));
  });

  it("hostP forbidden", () => {
    const r = evaluateS3Eligibility({
      risk: "SENSITIVE",
      validationLevel: "B",
      rollbackPlan: "revert",
      s3GateEnabled: true,
      hostP: true,
    });
    assert.ok(r.reasons.includes("hostP-forbidden"));
    assert.throws(() => assertHostPForbidden({ hostP: true }), /Host P/);
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

  it("documents rollback path (Appsolino + Host D only)", () => {
    const rb = describeS3RollbackPath({
      previousMainSha: "a".repeat(40),
      mergedHeadSha: "b".repeat(40),
      prNumber: 99,
      hostDReleaseId: "rel-prev",
      deployedHostD: true,
    });
    assert.match(rb.rollbackPlan, /Host P: PROHIBITED/);
    assert.match(rb.rollbackPlan, /Host D/);
    assert.equal(rb.hostP, false);
    assert.equal(assertRollbackPlanSafe(rb.rollbackPlan), rb.rollbackPlan);
  });

  it("no silent provider switch", () => {
    assert.equal(S3_PROVIDER, REVIEW_PROVIDER);
    assert.equal(S3_MODEL, REVIEW_MODEL);
    assert.throws(
      () => assertS3Pins({ provider: "xai-grok", model: REVIEW_MODEL }),
      /provider drift/,
    );
  });
});
