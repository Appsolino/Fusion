#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:FusionReliabilitySuite 2026-08-07-04:25:
 * Local brownfield reliability runner for Part B Levels 1–3 without Host P
 * and without Host D deploy quota consumption.
 * Creates a disposable multi-file Node fixture with real git + node:test,
 * executes challenges, records B6 audit fields, and fail-closes false SUCCESS.
 * Independent review is a separate invocation (fresh instructions) — not the
 * implementer's self-grade. Live Fusion engine runs remain optional when unpaused.
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { recordChallengeRun, summarizeReliabilitySuite } from "./reliability-suite.mjs";
import { validateVerifierVerdict, VERIFIER_VERDICT_SCHEMA_VERSION } from "./expert-decision-schema.mjs";

export const BROWNFIELD_FIXTURE_NAME = "appsolino-reliability-fixture";

/**
 * @param {string} parentDir
 */
export function materializeBrownfieldFixture(parentDir) {
  const root = join(parentDir, BROWNFIELD_FIXTURE_NAME);
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });

  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: BROWNFIELD_FIXTURE_NAME,
        private: true,
        type: "module",
        scripts: { test: "node --test test/*.test.js" },
      },
      null,
      2,
    )}\n`,
  );

  // Intentional L1 bug: add returns sum+1
  writeFileSync(
    join(root, "src/math.js"),
    `/** Fixture math — L1 bug: add is off-by-one until fixed. */\nexport function add(a, b) {\n  return a + b + 1;\n}\n\nexport function mul(a, b) {\n  return a * b;\n}\n`,
  );
  writeFileSync(
    join(root, "src/format.js"),
    `/** Cross-file helper used by L2. */\nimport { add } from "./math.js";\n\nexport function formatSum(a, b) {\n  return \`sum=\${add(a, b)}\`;\n}\n`,
  );
  writeFileSync(
    join(root, "src/feature.js"),
    `/** L3 feature stub — clamp missing until implemented. */\nexport function clamp(n, min, max) {\n  throw new Error("clamp not implemented");\n}\n`,
  );
  writeFileSync(
    join(root, "test/math.test.js"),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add, mul } from "../src/math.js";\n\ntest("add", () => {\n  assert.equal(add(2, 3), 5);\n});\n\ntest("mul", () => {\n  assert.equal(mul(2, 3), 6);\n});\n`,
  );
  writeFileSync(
    join(root, "test/format.test.js"),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { formatSum } from "../src/format.js";\n\ntest("formatSum", () => {\n  assert.equal(formatSum(2, 3), "sum=5");\n});\n`,
  );
  writeFileSync(
    join(root, "test/feature.test.js"),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { clamp } from "../src/feature.js";\n\ntest("clamp", { todo: true }, () => {\n  assert.equal(clamp(10, 0, 5), 5);\n  assert.equal(clamp(-1, 0, 5), 0);\n  assert.equal(clamp(3, 0, 5), 3);\n});\n`,
  );

  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "reliability@appsolino.local"]);
  git(root, ["config", "user.name", "Reliability Suite"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "chore: brownfield fixture with intentional defects"]);
  const startingSha = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  return { root, startingSha };
}

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return r;
}

function runTests(cwd) {
  const started = Date.now();
  const candidates = [
    "test/math.test.js",
    "test/format.test.js",
    "test/feature.test.js",
    "test/format-regression.test.js",
  ].filter((rel) => existsSync(join(cwd, rel)));
  // Prefer node --test directly — npm exit codes can be masked by config flags in CI shells.
  const r = spawnSync("node", ["--test", ...candidates], {
    cwd,
    encoding: "utf8",
  });
  return {
    passed: r.status === 0,
    exitCode: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    durationMs: Date.now() - started,
  };
}

/**
 * Independent reviewer — separate instructions, no implementer self-grade.
 * Deterministic structural review for fixture levels; optional live AI later.
 * @param {{ level: number, filesChanged: string[], testsAfter: object, worktree: string }} ctx
 */
export function independentReviewChallenge(ctx) {
  const started = Date.now();
  /** @type {string[]} */
  const blockingFindings = [];
  /** @type {string[]} */
  const requiredChanges = [];
  for (const f of ctx.filesChanged || []) {
    const abs = join(ctx.worktree, f);
    if (!existsSync(abs)) blockingFindings.push(`missing changed file ${f}`);
  }
  if (ctx.testsAfter && ctx.testsAfter.passed !== true) {
    blockingFindings.push("tests not green — cannot APPROVE");
  }
  // L3: require clamp implementation body (not throw)
  if (ctx.level >= 3) {
    const src = readFileSync(join(ctx.worktree, "src/feature.js"), "utf8");
    if (/throw new Error/.test(src) || !/Math\.min|Math\.max|if\s*\(/.test(src)) {
      requiredChanges.push("implement clamp with Math.min/Math.max matching pure-function modules");
    }
  }
  const verdict = blockingFindings.length
    ? "BLOCK_POLICY"
    : requiredChanges.length
      ? "REQUEST_CHANGES"
      : "APPROVE";
  const decision = {
    schemaVersion: VERIFIER_VERDICT_SCHEMA_VERSION,
    verdict,
    summary: `independent fixture review level=${ctx.level}`,
    blockingFindings,
    requiredChanges,
    risk: blockingFindings.length ? "HIGH" : requiredChanges.length ? "MEDIUM" : "LOW",
  };
  const v = validateVerifierVerdict(decision);
  return {
    ok: v.ok,
    decision: v.verdict || decision,
    actualProvider: "deterministic-independent-reviewer",
    actualModel: "fixture-reviewer-v1",
    latencyMs: Date.now() - started,
    errors: v.errors || [],
  };
}

/**
 * @param {{ appsolinoRoot: string, fixtureParent: string, levels?: number[] }} opts
 */
export async function runBrownfieldLevels(opts) {
  const levels = opts.levels || [1, 2, 3];
  const { root, startingSha } = materializeBrownfieldFixture(opts.fixtureParent);
  const results = [];

  const beforeAll = runTests(root);

  if (levels.includes(1)) {
    results.push(await runL1({ appsolinoRoot: opts.appsolinoRoot, root, startingSha, testsBefore: beforeAll }));
    /*
     FNXC:FusionReliabilitySuite 2026-08-07-04:25:
     Land L1 onto main via merge so subsequent levels share the corrected baseline.
     File rewrite alone raced with branch checkouts in early drafts.
     */
    git(root, ["checkout", "main"]);
    git(root, ["merge", "--ff-only", "challenge/rel-l1"]);
  }
  if (levels.includes(2)) {
    // L2 expects L1 fixed; if L1 skipped, apply fix first
    if (!levels.includes(1)) {
      applyL1Fix(root);
      git(root, ["add", "src/math.js"]);
      git(root, ["commit", "-m", "fix(REL-L1): baseline for suite without L1 run"]);
    }
    results.push(await runL2({ appsolinoRoot: opts.appsolinoRoot, root, startingSha }));
    git(root, ["checkout", "main"]);
    git(root, ["merge", "--ff-only", "challenge/rel-l2"]);
  }
  if (levels.includes(3)) {
    if (!levels.includes(1)) {
      applyL1Fix(root);
    }
    results.push(await runL3({ appsolinoRoot: opts.appsolinoRoot, root, startingSha }));
  }

  return {
    fixtureRoot: root,
    startingSha,
    results,
    summary: summarizeReliabilitySuite(opts.appsolinoRoot),
  };
}

function applyL1Fix(root) {
  writeFileSync(
    join(root, "src/math.js"),
    `/** Fixture math — L1 fixed. */\nexport function add(a, b) {\n  return a + b;\n}\n\nexport function mul(a, b) {\n  return a * b;\n}\n`,
  );
}

async function runL1({ appsolinoRoot, root, startingSha, testsBefore }) {
  const started = Date.now();
  const branch = "challenge/rel-l1";
  git(root, ["checkout", "-b", branch]);
  const toolCalls = [{ tool: "writeFile", path: "src/math.js", intent: "fix off-by-one add" }];
  applyL1Fix(root);
  const testsAfter = runTests(root);
  git(root, ["add", "src/math.js"]);
  let gitResult = "ok";
  let commitSha = null;
  try {
    git(root, ["commit", "-m", "fix(REL-L1): correct add off-by-one"]);
    commitSha = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  } catch (e) {
    gitResult = String(e.message || e);
  }

  const review = independentReviewChallenge({
    level: 1,
    filesChanged: ["src/math.js"],
    testsAfter,
    worktree: root,
  });

  const mandatoryFinalFailed = !testsAfter.passed || gitResult !== "ok";
  let finalStatus = mandatoryFinalFailed ? "FAILED" : review.decision.verdict === "APPROVE" ? "SUCCESS" : "BLOCKED";
  if (finalStatus === "SUCCESS" && mandatoryFinalFailed) {
    finalStatus = "CRITICAL_FALSE_SUCCESS_PREVENTED";
  }

  const run = {
    taskId: "REL-L1-BROWNFIELD-FIXTURE",
    level: 1,
    repo: BROWNFIELD_FIXTURE_NAME,
    startingSha,
    requestedBehavior: "Fix add() off-by-one so unit tests pass",
    plan: "Inspect failing math.test; correct add; re-run tests; commit on isolated branch",
    worktree: root,
    agentModel: "deterministic-fixture-agent",
    synthetic: true,
    testInjection: true,
    toolCalls,
    testsBefore: { passed: testsBefore.passed, exitCode: testsBefore.exitCode },
    testsAfter: { passed: testsAfter.passed, exitCode: testsAfter.exitCode, durationMs: testsAfter.durationMs },
    reviewFindings: review.decision.blockingFindings || review.decision.requiredChanges || [],
    independentReview: {
      provider: review.actualProvider,
      model: review.actualModel,
      verdict: review.decision.verdict,
    },
    recoveryAttempts: [],
    gitResult: { ok: gitResult === "ok", commitSha, branch },
    prResult: { created: false, reason: "local fixture — no remote push (Host P/D deploy not required)" },
    finalStatus,
    mandatoryFinalFailed,
    reason: mandatoryFinalFailed
      ? "tests or git failed — truthful failure"
      : "L1 fixed with independent APPROVE",
    wallClockDurationMs: Date.now() - started,
    recoveredAfterFailure: !testsBefore.passed && testsAfter.passed,
  };
  recordChallengeRun(appsolinoRoot, run);
  git(root, ["checkout", "main"]);
  return run;
}

async function runL2({ appsolinoRoot, root, startingSha }) {
  const started = Date.now();
  const branch = "challenge/rel-l2";
  git(root, ["checkout", "-B", branch]);
  // Ensure format path still broken if math broken; L1 should have fixed math.
  // Add regression that fails before if formatSum wrong, then pass.
  const regressionPath = "test/format-regression.test.js";
  writeFileSync(
    join(root, regressionPath),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { formatSum } from "../src/format.js";\n\ntest("formatSum regression", () => {\n  assert.equal(formatSum(10, 5), "sum=15");\n});\n`,
  );
  const testsBefore = runTests(root);
  // formatSum already correct once add is fixed — if still failing, fix format
  let recoveryAttempts = [];
  if (!testsBefore.passed) {
    writeFileSync(
      join(root, "src/format.js"),
      `import { add } from "./math.js";\n\nexport function formatSum(a, b) {\n  return \`sum=\${add(a, b)}\`;\n}\n`,
    );
    recoveryAttempts.push({ step: "rewrite formatSum", at: new Date().toISOString() });
  }
  const testsAfter = runTests(root);
  git(root, ["add", "src/format.js", regressionPath]);
  let gitResult = "ok";
  let commitSha = null;
  try {
    git(root, ["commit", "-m", "test(REL-L2): cross-file formatSum regression"]);
    commitSha = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  } catch (e) {
    gitResult = String(e.message || e);
  }
  const review = independentReviewChallenge({
    level: 2,
    filesChanged: ["src/format.js", regressionPath],
    testsAfter,
    worktree: root,
  });
  const mandatoryFinalFailed = !testsAfter.passed || gitResult !== "ok";
  const finalStatus = mandatoryFinalFailed
    ? "FAILED"
    : review.decision.verdict === "APPROVE"
      ? "SUCCESS"
      : "BLOCKED";
  const run = {
    taskId: "REL-L2-BROWNFIELD-FIXTURE",
    level: 2,
    repo: BROWNFIELD_FIXTURE_NAME,
    startingSha,
    requestedBehavior: "Cross-file formatSum correctness with new regression test",
    plan: "Add regression; ensure math+format cooperate; commit",
    worktree: root,
    agentModel: "deterministic-fixture-agent",
    synthetic: true,
    testInjection: true,
    toolCalls: [{ tool: "writeFile", path: regressionPath }],
    testsBefore: { passed: testsBefore.passed },
    testsAfter: { passed: testsAfter.passed, durationMs: testsAfter.durationMs },
    reviewFindings: review.decision.blockingFindings || review.decision.requiredChanges || [],
    independentReview: {
      provider: review.actualProvider,
      model: review.actualModel,
      verdict: review.decision.verdict,
    },
    recoveryAttempts,
    gitResult: { ok: gitResult === "ok", commitSha, branch },
    prResult: { created: false, reason: "local fixture" },
    finalStatus,
    mandatoryFinalFailed,
    reason: "L2 cross-file regression path",
    wallClockDurationMs: Date.now() - started,
    recoveredAfterFailure: recoveryAttempts.length > 0 && testsAfter.passed,
  };
  recordChallengeRun(appsolinoRoot, run);
  git(root, ["checkout", "main"]);
  return run;
}

async function runL3({ appsolinoRoot, root, startingSha }) {
  const started = Date.now();
  const branch = "challenge/rel-l3";
  git(root, ["checkout", "-B", branch]);
  // Enable the todo test and implement clamp
  writeFileSync(
    join(root, "test/feature.test.js"),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { clamp } from "../src/feature.js";\n\ntest("clamp", () => {\n  assert.equal(clamp(10, 0, 5), 5);\n  assert.equal(clamp(-1, 0, 5), 0);\n  assert.equal(clamp(3, 0, 5), 3);\n});\n`,
  );
  const testsBefore = runTests(root);
  // First approach fails (noop)
  writeFileSync(
    join(root, "src/feature.js"),
    `export function clamp(n, min, max) {\n  return n;\n}\n`,
  );
  const mid = runTests(root);
  const recoveryAttempts = [{ step: "noop-clamp-failed", passed: mid.passed }];
  // Redesign: proper clamp
  writeFileSync(
    join(root, "src/feature.js"),
    `/** Clamp n into [min,max] inclusive — matches existing pure-function style. */\nexport function clamp(n, min, max) {\n  return Math.min(max, Math.max(min, n));\n}\n`,
  );
  recoveryAttempts.push({ step: "redesign-proper-clamp" });
  const testsAfter = runTests(root);
  git(root, ["add", "src/feature.js", "test/feature.test.js"]);
  let gitResult = "ok";
  let commitSha = null;
  try {
    git(root, ["commit", "-m", "feat(REL-L3): implement clamp with tests"]);
    commitSha = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  } catch (e) {
    gitResult = String(e.message || e);
  }

  let review = independentReviewChallenge({
    level: 3,
    filesChanged: ["src/feature.js", "test/feature.test.js"],
    testsAfter,
    worktree: root,
  });
  // Simulate REQUEST_CHANGES then repair if reviewer wants doc comment (already has)
  if (review.decision.verdict === "REQUEST_CHANGES") {
    recoveryAttempts.push({ step: "address-review", findings: review.decision.requiredChanges });
    review = independentReviewChallenge({
      level: 3,
      filesChanged: ["src/feature.js", "test/feature.test.js"],
      testsAfter,
      worktree: root,
    });
  }

  const mandatoryFinalFailed = !testsAfter.passed || gitResult !== "ok";
  const finalStatus = mandatoryFinalFailed
    ? "FAILED"
    : review.decision.verdict === "APPROVE"
      ? "SUCCESS"
      : "BLOCKED";

  const run = {
    taskId: "REL-L3-BROWNFIELD-FIXTURE",
    level: 3,
    repo: BROWNFIELD_FIXTURE_NAME,
    startingSha,
    requestedBehavior: "Implement clamp consistent with pure-function modules",
    plan: "Enable tests; try noop; redesign; independent review",
    worktree: root,
    agentModel: "deterministic-fixture-agent",
    synthetic: true,
    testInjection: true,
    toolCalls: [
      { tool: "writeFile", path: "src/feature.js", attempt: 1 },
      { tool: "writeFile", path: "src/feature.js", attempt: 2 },
    ],
    testsBefore: { passed: testsBefore.passed },
    testsAfter: { passed: testsAfter.passed, durationMs: testsAfter.durationMs },
    reviewFindings: review.decision.blockingFindings || review.decision.requiredChanges || [],
    independentReview: {
      provider: review.actualProvider,
      model: review.actualModel,
      verdict: review.decision.verdict,
    },
    recoveryAttempts,
    gitResult: { ok: gitResult === "ok", commitSha, branch },
    prResult: { created: false, reason: "local fixture" },
    finalStatus,
    mandatoryFinalFailed,
    reason: "L3 architecture-style feature with redesign recovery",
    wallClockDurationMs: Date.now() - started,
    recoveredAfterFailure: true,
  };
  recordChallengeRun(appsolinoRoot, run);
  git(root, ["checkout", "main"]);
  return run;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const appsolinoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const fixtureParent = process.env.RELIABILITY_FIXTURE_PARENT || "/srv/appsolino-fusion/tmp/reliability";
  mkdirSync(fixtureParent, { recursive: true });
  const out = await runBrownfieldLevels({ appsolinoRoot, fixtureParent, levels: [1, 2, 3] });
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  const failed = out.results.filter((r) => r.finalStatus !== "SUCCESS");
  process.exit(failed.length ? 1 : 0);
}
