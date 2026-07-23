/**
 * Regression for the CI Gate failure on PR #4 / run 29993835319:
 * concurrent `CREATE TABLE IF NOT EXISTS public._fusion_golden_templates`
 * raced on `pg_type_typname_nsp_index` because marker DDL ran before any
 * lock shared across distinct golden names.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  PG_AVAILABLE,
  __pgTestTemplateTestHooks,
} from "../../__test-utils__/pg-test-harness.js";

const testDescribe = PG_AVAILABLE ? describe : describe.skip;

testDescribe("golden marker table bootstrap serialization", () => {
  afterEach(async () => {
    // Leave a clean marker table for sibling suites; bootstrap under the lock.
    await __pgTestTemplateTestHooks.ensureGoldenMarkerTable();
  });

  it("initializes the marker table under concurrent callers without catalog races", async () => {
    await __pgTestTemplateTestHooks.dropGoldenMarkerTable();
    expect(await __pgTestTemplateTestHooks.goldenMarkerTableExists()).toBe(false);

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => __pgTestTemplateTestHooks.ensureGoldenMarkerTable()),
    );

    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toEqual([]);
    expect(await __pgTestTemplateTestHooks.goldenMarkerTableExists()).toBe(true);
  });

  it("releases the bootstrap advisory lock when initialization fails", async () => {
    await expect(
      __pgTestTemplateTestHooks.ensureGoldenMarkerTable({ failAfterLock: true }),
    ).rejects.toThrow(/injected golden-marker bootstrap failure/);

    await expect(__pgTestTemplateTestHooks.tryAcquireGoldenMarkerBootstrapLock()).resolves.toBe(true);

    // Recovery path still works after a failed attempt.
    await __pgTestTemplateTestHooks.ensureGoldenMarkerTable();
    expect(await __pgTestTemplateTestHooks.goldenMarkerTableExists()).toBe(true);
  });

  it("exports the constant bootstrap lock key used by the harness", () => {
    expect(__pgTestTemplateTestHooks.goldenMarkerBootstrapLockKey).toBe(
      "fusion_pg_test_golden_marker_bootstrap",
    );
    expect(__pgTestTemplateTestHooks.goldenMarkerQualified).toBe("public._fusion_golden_templates");
  });
});
