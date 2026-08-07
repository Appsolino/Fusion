#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamPatchReconcile 2026-08-07-17:35:
 * Regression path resolution must never shell-exec bare test file paths (exit 126/127
 * was falsely treated as FAIL and retained every ACTIVE patch on #144).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRegressionInvocation } from "../run-patch-reconcile-live.mjs";

describe("resolveRegressionInvocation", () => {
  it("maps package test file paths to vitest via package filter", () => {
    const root = mkdtempSync(join(tmpdir(), "reconcile-reg-"));
    try {
      const rel = "packages/dashboard/app/__tests__/settings-primitives.test.tsx";
      mkdirSync(join(root, "packages/dashboard/app/__tests__"), { recursive: true });
      writeFileSync(join(root, rel), "export {}\n");
      const r = resolveRegressionInvocation(root, rel);
      assert.equal(r.missing, undefined);
      assert.match(r.command, /pnpm --filter @fusion\/dashboard exec vitest run/);
      assert.match(r.command, /settings-primitives\.test\.tsx/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("maps infra node:test files to node --test", () => {
    const root = mkdtempSync(join(tmpdir(), "reconcile-reg-"));
    try {
      const rel = "infra/scripts/__tests__/auto1-upstream-sync.test.mjs";
      mkdirSync(join(root, "infra/scripts/__tests__"), { recursive: true });
      writeFileSync(join(root, rel), "export {}\n");
      const r = resolveRegressionInvocation(root, rel);
      assert.equal(r.missing, undefined);
      assert.match(r.command, /^node --test /);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns missing:true for absent regression files (not a shell FAIL)", () => {
    const root = mkdtempSync(join(tmpdir(), "reconcile-reg-"));
    try {
      const r = resolveRegressionInvocation(
        root,
        "packages/dashboard/app/__tests__/settings-autofill-invariant.test.ts",
      );
      assert.equal(r.missing, true);
      assert.equal(r.command, undefined);
      assert.match(r.reason, /missing/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves explicit pnpm commands", () => {
    const r = resolveRegressionInvocation("/tmp", "pnpm check:lane-wiring");
    assert.equal(r.command, "pnpm check:lane-wiring");
    assert.equal(r.missing, undefined);
  });
});
