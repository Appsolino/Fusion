#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-05:
 * Live S1B path unit tests (mocked children).
 */
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { evaluateS1bEligibility, S1B_MODEL, S1B_PROVIDER } from "../policy.mjs";
import { planS1bRepair } from "../plan-s1b.mjs";
import {
  runS1b,
  clearRepairRegistry,
} from "../run-s1b.mjs";
import { assertS1bAuthority, scanS1bAuthorityText } from "../guard-authority.mjs";
import { assertNoCredentialLeak, cursorChildEnv } from "../../s1a/spawn-env.mjs";
import { runCursorRepairEngine } from "../cursor-repair-engine.mjs";
import { capturePrimaryIntegrity } from "../worktree.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const S1B_DIR = join(HERE, "..");

const FP = "ab".repeat(32);

function initRepo() {
  const root = mkdtempSync(join(tmpdir(), "s1b-repo-"));
  spawnSync("git", ["init"], { cwd: root });
  spawnSync("git", ["config", "user.email", "s1b@test"], { cwd: root });
  spawnSync("git", ["config", "user.name", "s1b"], { cwd: root });
  spawnSync("git", ["checkout", "-b", "main"], { cwd: root });
  writeFileSync(join(root, "README.md"), "base\n");
  spawnSync("git", ["add", "."], { cwd: root });
  spawnSync("git", ["commit", "-m", "init"], { cwd: root });
  return root;
}

function baseAssessment(over = {}) {
  return {
    repairRecommended: true,
    reviewerVerdict: "ACCEPT",
    risk: "SENSITIVE",
    summary: "fix conflict",
    rootCause: "generated baseline drift",
    recommendedSolution: "regenerate baseline",
    files: [{ path: "README.md", kind: "other" }],
    ...over,
  };
}

function mockCursorEngine({ worktreePath }) {
  writeFileSync(join(worktreePath, "README.md"), "repaired\n");
  return {
    summary: "applied baseline repair",
    changedFiles: ["README.md"],
    testsToRun: [],
    notes: "mock",
    actualProvider: S1B_PROVIDER,
    actualModel: S1B_MODEL,
    configuredProvider: S1B_PROVIDER,
    configuredModel: S1B_MODEL,
    childEnvKeys: Object.keys(
      cursorChildEnv({ apiKey: "k", src: { PATH: "/bin", GITHUB_TOKEN: "leak" } }),
    ).sort(),
  };
}

describe("S1B eligibility", () => {
  it("requires gate + ACCEPT + repairRecommended", () => {
    const base = {
      issueNumber: 74,
      occurrence: "workflow-run:1:attempt:1",
      fingerprint: FP,
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

describe("S1B live path (mocked children)", () => {
  /** @type {string} */
  let repoRoot;
  /** @type {NodeJS.ProcessEnv} */
  let prevEnv;

  before(() => {
    prevEnv = {
      STEWARD_S1B_ENABLED: process.env.STEWARD_S1B_ENABLED,
      S1B_MODEL: process.env.S1B_MODEL,
      S1B_PROVIDER: process.env.S1B_PROVIDER,
      S1B_GITHUB_APP_TOKEN: process.env.S1B_GITHUB_APP_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GH_TOKEN: process.env.GH_TOKEN,
    };
  });

  after(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    clearRepairRegistry();
  });

  beforeEach(() => {
    clearRepairRegistry();
    process.env.STEWARD_S1B_ENABLED = "true";
    delete process.env.S1B_MODEL;
    delete process.env.S1B_PROVIDER;
    process.env.S1B_GITHUB_APP_TOKEN = "app-token-test";
    repoRoot = initRepo();
  });

  afterEach(() => {
    if (repoRoot && existsSync(repoRoot)) {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("gate s1bEnabled required", async () => {
    delete process.env.STEWARD_S1B_ENABLED;
    const skipped = await runS1b({
      issueNumber: 74,
      occurrence: "workflow-run:1:attempt:1",
      fingerprint: FP,
      assessment: baseAssessment(),
      dryRun: false,
      repoRoot,
      skipAuthorityGuard: true,
      s1bGateEnabled: false,
    });
    assert.equal(skipped.action, "skipped");
    assert.ok(skipped.reasons.includes("s1b-gate-disabled"));

    const planned = await runS1b({
      issueNumber: 74,
      occurrence: "workflow-run:1:attempt:1",
      fingerprint: FP,
      assessment: baseAssessment(),
      s1bGateEnabled: true,
      skipAuthorityGuard: true,
    });
    assert.equal(planned.action, "planned");
  });

  it("model composer-2.5 fail-closed on drift", async () => {
    process.env.S1B_MODEL = "gpt-wrong";
    await assert.rejects(
      () =>
        runS1b({
          issueNumber: 74,
          occurrence: "occ-drift",
          fingerprint: FP,
          assessment: baseAssessment(),
          dryRun: false,
          repoRoot,
          skipAuthorityGuard: true,
          s1bGateEnabled: true,
        }),
      /drift forbidden|expected model composer-2\.5/,
    );
    delete process.env.S1B_MODEL;

    await assert.rejects(
      () =>
        runCursorRepairEngine({
          assessment: baseAssessment(),
          issueNumber: 74,
          fingerprint: FP,
          occurrence: "x",
          worktreePath: repoRoot,
          model: "not-composer",
          skipModelProbe: true,
          engine: async () => ({}),
        }),
      /drift forbidden|expected model/,
    );
  });

  it("one repair per fingerprint + occurrence; duplicate trigger is a no-op", async () => {
    const wtRoot = mkdtempSync(join(tmpdir(), "s1b-wt-"));
    const occurrence = "workflow-run:9:attempt:1";
    const worktreePath = join(wtRoot, "repair-74-occ");
    /** @type {string[]} */
    const pushes = [];
    /** @type {string[][]} */
    const ghCalls = [];

    const common = {
      issueNumber: 74,
      occurrence,
      fingerprint: FP,
      assessment: baseAssessment(),
      dryRun: false,
      repoRoot,
      worktreePath,
      s1bGateEnabled: true,
      skipAuthorityGuard: true,
      cursorEngine: mockCursorEngine,
      testFn: async () => ({ ok: true }),
      gitPushFn: (args) => {
        pushes.push(args.join(" "));
        return { status: 0, stdout: "ok", stderr: "" };
      },
      gh: (args) => {
        ghCalls.push(args);
        if (args[0] === "pr" && args[1] === "list") {
          return { status: 0, stdout: "[]", stderr: "" };
        }
        if (args[0] === "pr" && args[1] === "create") {
          return {
            status: 0,
            stdout: "https://github.com/Appsolino/Fusion/pull/901",
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "unexpected" };
      },
      dualReviewFn: async () => ({
        action: "approved-ready",
        merged: false,
      }),
    };

    const first = await runS1b(common);
    assert.equal(first.action, "repair-pr-opened");
    assert.equal(first.prNumber, 901);
    assert.equal(first.merged, false);
    assert.equal(first.deployed, false);
    assert.equal(first.hostP, false);
    assert.ok(first.repairHeadSha);
    assert.equal(pushes.length, 1);
    assert.equal(ghCalls.filter((a) => a[1] === "create").length, 1);
    assert.ok(!existsSync(worktreePath), "cleanup removes worktree");

    const primary = capturePrimaryIntegrity(repoRoot);
    assert.equal(primary.branch, "main");
    assert.match(readFileSync(join(repoRoot, "README.md"), "utf8"), /base/);

    const second = await runS1b(common);
    assert.equal(second.action, "noop-duplicate");
    assert.equal(second.prNumber, 901);
    assert.equal(pushes.length, 1, "duplicate must not push again");
    assert.equal(
      ghCalls.filter((a) => a[1] === "create").length,
      1,
      "duplicate must not create another PR",
    );
  });

  it("no primary checkout mutation", async () => {
    const wtRoot = mkdtempSync(join(tmpdir(), "s1b-wt-"));
    const worktreePath = join(wtRoot, "repair-mut");
    const before = capturePrimaryIntegrity(repoRoot);

    const result = await runS1b({
      issueNumber: 74,
      occurrence: "occ-primary",
      fingerprint: FP,
      assessment: baseAssessment(),
      dryRun: false,
      repoRoot,
      worktreePath,
      s1bGateEnabled: true,
      skipAuthorityGuard: true,
      cursorEngine: mockCursorEngine,
      testFn: async () => ({ ok: true }),
      gitPushFn: () => ({ status: 0, stdout: "", stderr: "" }),
      gh: (args) => {
        if (args[1] === "list") return { status: 0, stdout: "[]", stderr: "" };
        return {
          status: 0,
          stdout: "https://github.com/Appsolino/Fusion/pull/902",
          stderr: "",
        };
      },
      dualReviewFn: async () => ({ action: "approved-ready", merged: false }),
    });

    assert.equal(result.primaryCheckoutMutated, false);
    const after = capturePrimaryIntegrity(repoRoot);
    assert.equal(after.head, before.head);
    assert.equal(after.branch, before.branch);
    assert.equal(after.trackedDiff, before.trackedDiff);
    assert.equal(after.stagedDiff, before.stagedDiff);
    assert.match(readFileSync(join(repoRoot, "README.md"), "utf8"), /base/);
  });

  it("no owner OAuth/PAT in automation child env", async () => {
    /** @type {NodeJS.ProcessEnv|null} */
    let seenEnv = null;
    function mockSpawn(_bin, args, opts = {}) {
      seenEnv = opts.env || null;
      const ee = new EventEmitter();
      ee.stdout = new EventEmitter();
      ee.stderr = new EventEmitter();
      ee.kill = () => {};
      globalThis.queueMicrotask(() => {
        if (args[0] === "models") {
          ee.stdout.emit("data", Buffer.from(`${S1B_MODEL}\n`));
          ee.emit("close", 0);
          return;
        }
        ee.stdout.emit(
          "data",
          Buffer.from(
            '```json\n{"summary":"ok","changedFiles":[],"testsToRun":[],"notes":""}\n```\n',
          ),
        );
        ee.emit("close", 0);
      });
      return ee;
    }

    const prev = {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GH_TOKEN: process.env.GH_TOKEN,
      APPSOLINO_AUTOMATION_APP_PRIVATE_KEY:
        process.env.APPSOLINO_AUTOMATION_APP_PRIVATE_KEY,
      APPSOLINO_AUTOMATION_APP_ID: process.env.APPSOLINO_AUTOMATION_APP_ID,
      CURSOR_API_KEY: process.env.CURSOR_API_KEY,
    };
    process.env.GITHUB_TOKEN = "owner-oauth";
    process.env.GH_TOKEN = "owner-pat";
    process.env.APPSOLINO_AUTOMATION_APP_PRIVATE_KEY = "pk-secret";
    process.env.APPSOLINO_AUTOMATION_APP_ID = "12345";
    process.env.CURSOR_API_KEY = "cursor-key";

    try {
      const wt = join(mkdtempSync(join(tmpdir(), "s1b-wt-")), "repair-env");
      await runS1b({
        issueNumber: 74,
        occurrence: "occ-env",
        fingerprint: FP,
        assessment: baseAssessment(),
        dryRun: false,
        repoRoot,
        worktreePath: wt,
        s1bGateEnabled: true,
        skipAuthorityGuard: true,
        spawnFn: mockSpawn,
        testFn: async () => ({ ok: true }),
        gitPushFn: () => ({ status: 0, stdout: "", stderr: "" }),
        gh: (args) => {
          if (args[1] === "list") return { status: 0, stdout: "[]", stderr: "" };
          return {
            status: 0,
            stdout: "https://github.com/Appsolino/Fusion/pull/903",
            stderr: "",
          };
        },
        dualReviewFn: async () => ({ action: "approved-ready", merged: false }),
        // Injectable cursorEngine that uses cursorChildEnv like production
        cursorEngine: async (input) => {
          const env = cursorChildEnv({
            apiKey: process.env.CURSOR_API_KEY,
            src: process.env,
          });
          seenEnv = env;
          assertNoCredentialLeak(env, { allowCursorKey: true });
          writeFileSync(join(input.worktreePath, "README.md"), "repaired-env\n");
          return {
            summary: "ok",
            actualModel: S1B_MODEL,
            actualProvider: S1B_PROVIDER,
            childEnvKeys: Object.keys(env).sort(),
          };
        },
      });

      assert.ok(seenEnv);
      assert.equal(seenEnv.GITHUB_TOKEN, undefined);
      assert.equal(seenEnv.GH_TOKEN, undefined);
      assert.equal(seenEnv.APPSOLINO_AUTOMATION_APP_PRIVATE_KEY, undefined);
      assert.equal(seenEnv.APPSOLINO_AUTOMATION_APP_ID, undefined);
      assertNoCredentialLeak(seenEnv, { allowCursorKey: true });
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("cleanup succeeds", async () => {
    const worktreePath = join(mkdtempSync(join(tmpdir(), "s1b-wt-")), "repair-cleanup");
    const result = await runS1b({
      issueNumber: 74,
      occurrence: "occ-cleanup",
      fingerprint: FP,
      assessment: baseAssessment(),
      dryRun: false,
      repoRoot,
      worktreePath,
      s1bGateEnabled: true,
      skipAuthorityGuard: true,
      cleanup: true,
      cursorEngine: mockCursorEngine,
      testFn: async () => ({ ok: true }),
      gitPushFn: () => ({ status: 0, stdout: "", stderr: "" }),
      gh: (args) => {
        if (args[1] === "list") return { status: 0, stdout: "[]", stderr: "" };
        return {
          status: 0,
          stdout: "https://github.com/Appsolino/Fusion/pull/904",
          stderr: "",
        };
      },
      dualReviewFn: async () => ({ action: "approved-ready", merged: false }),
    });
    assert.equal(result.action, "repair-pr-opened");
    assert.ok(!existsSync(worktreePath));
    const listing = spawnSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.ok(!listing.stdout.includes(worktreePath));
  });

  it("no deployment authority inside S1B", () => {
    const auth = assertS1bAuthority({ packageDir: S1B_DIR });
    assert.equal(auth.ok, true, JSON.stringify(auth.violations, null, 2));

    for (const name of [
      "run-s1b.mjs",
      "push-pr.mjs",
      "cursor-repair-engine.mjs",
      "worktree.mjs",
      "policy.mjs",
    ]) {
      const text = readFileSync(join(S1B_DIR, name), "utf8");
      assert.doesNotMatch(text, /\$\{\{\s*secrets\.HOST_P_/i);
      assert.doesNotMatch(text, /\$\{\{\s*secrets\.HOST_D_/i);
      assert.doesNotMatch(text, /\bgh\s+pr\s+merge\b/);
      assert.doesNotMatch(text, /writerRevalidateAndMaybeMerge\s*\(/);
      assert.doesNotMatch(text, /auto3-hostd-deploy/);
    }

    const hits = scanS1bAuthorityText(
      'gh pr merge 1\n${{ secrets.HOST_P_TOKEN }}\nwriterRevalidateAndMaybeMerge({ merge: true })',
      "source",
    );
    assert.ok(hits.some((h) => h.id === "gh-pr-merge"));
    assert.ok(hits.some((h) => h.id === "host-p-secret"));
    assert.ok(hits.some((h) => h.id === "writer-merge"));
  });

  it("live path never merges even when dual review returns approved-ready", async () => {
    const worktreePath = join(mkdtempSync(join(tmpdir(), "s1b-wt-")), "repair-nomerge");
    const result = await runS1b({
      issueNumber: 74,
      occurrence: "occ-nomerge",
      fingerprint: FP,
      assessment: baseAssessment(),
      dryRun: false,
      repoRoot,
      worktreePath,
      s1bGateEnabled: true,
      skipAuthorityGuard: true,
      cursorEngine: mockCursorEngine,
      testFn: async () => ({ ok: true }),
      gitPushFn: () => ({ status: 0, stdout: "", stderr: "" }),
      gh: (args) => {
        if (args[1] === "list") return { status: 0, stdout: "[]", stderr: "" };
        return {
          status: 0,
          stdout: "https://github.com/Appsolino/Fusion/pull/905",
          stderr: "",
        };
      },
      dualReviewFn: async (inp) => {
        assert.equal(inp.merge, false);
        assert.equal(inp.dryRun, true);
        return { action: "approved-ready", merged: false };
      },
    });
    assert.equal(result.merged, false);
    assert.equal(result.mergeAuthorized, false);
    assert.equal(result.dualReview.action, "approved-ready");
  });

  it("planS1bRepair consults activation gate", () => {
    const off = planS1bRepair({
      issueNumber: 74,
      occurrence: "x",
      fingerprint: FP,
      assessment: baseAssessment(),
      s1bGateEnabled: false,
    });
    assert.equal(off.ok, false);
    assert.ok(off.eligibility.reasons.includes("s1b-gate-disabled"));

    const on = planS1bRepair({
      issueNumber: 74,
      occurrence: "x",
      fingerprint: FP,
      assessment: baseAssessment(),
      s1bGateEnabled: true,
    });
    assert.equal(on.ok, true);
    assert.equal(on.configuredModel, "composer-2.5");
  });
});
