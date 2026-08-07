#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:FusionReliabilitySuite 2026-08-07-04:30:
 * Unit coverage for brownfield L1–L3 runner and false-SUCCESS prevention.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  materializeBrownfieldFixture,
  independentReviewChallenge,
  runBrownfieldLevels,
} from "../brownfield-reliability-runner.mjs";
import { recordChallengeRun, summarizeReliabilitySuite } from "../reliability-suite.mjs";

const TMP = process.env.RUNNER_TEMP || process.env.TMPDIR || "/srv/appsolino-fusion/tmp";

describe("brownfield reliability runner", () => {
  it("materialize fixture has intentional failing add", () => {
    const parent = mkdtempSync(join(TMP, "rel-fix-"));
    const { root, startingSha } = materializeBrownfieldFixture(parent);
    assert.match(startingSha, /^[0-9a-f]{40}$/);
    const math = spawnSync("node", ["-e", "import{add}from('./src/math.js');process.exit(add(2,3)===5?0:1)"], {
      cwd: root,
      encoding: "utf8",
    });
    // Intentional off-by-one: add(2,3) !== 5
    assert.equal(math.status, 1);
  });

  it("independent review APPROVE requires green tests", () => {
    const parent = mkdtempSync(join(TMP, "rel-rev-"));
    const { root } = materializeBrownfieldFixture(parent);
    const blocked = independentReviewChallenge({
      level: 1,
      filesChanged: ["src/math.js"],
      testsAfter: { passed: false },
      worktree: root,
    });
    assert.equal(blocked.decision.verdict, "BLOCK_POLICY");
  });

  it("recordChallengeRun rewrites false SUCCESS", () => {
    const root = mkdtempSync(join(TMP, "rel-truth-"));
    mkdirSync(join(root, ".appsolino/reliability/runs"), { recursive: true });
    recordChallengeRun(root, {
      taskId: "T-FALSE",
      finalStatus: "SUCCESS",
      mandatoryFinalFailed: true,
    });
    const summary = summarizeReliabilitySuite(root);
    assert.equal(summary.falseSuccessIncidents, 1);
    assert.equal(summary.passed, 0);
  });

  it("runBrownfieldLevels L1–L3 succeed with independent APPROVE", async () => {
    const appsolinoRoot = mkdtempSync(join(TMP, "rel-apps-"));
    const fixtureParent = mkdtempSync(join(TMP, "rel-fix-"));
    mkdirSync(join(appsolinoRoot, ".appsolino/reliability/runs"), { recursive: true });
    const out = await runBrownfieldLevels({
      appsolinoRoot,
      fixtureParent,
      levels: [1, 2, 3],
    });
    assert.equal(out.results.length, 3);
    assert.ok(out.results.every((r) => r.finalStatus === "SUCCESS"));
    assert.ok(out.results.every((r) => r.independentReview?.verdict === "APPROVE"));
    assert.ok(out.results.every((r) => r.gitResult?.ok === true));
  });
});
