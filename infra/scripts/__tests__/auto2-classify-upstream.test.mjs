#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto2 2026-07-31-18:00:
 * Unit/integration harness for AUTO-2 classification and finalizer policy.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyUpstream,
  isAuto2ManagedHead,
  LARGE_FILE_COUNT,
  LABEL_APPROVAL,
  LABEL_BLOCKED,
} from "../auto2-classify-upstream.mjs";
import { runAuto2Finalize } from "../auto2-finalize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("AUTO-2 classify", () => {
  it("docs-only → low + auto-merge eligible", () => {
    const r = classifyUpstream({
      changedFiles: ["docs/appsolino/upstream/UPSTREAM-MONITORING.md"],
      commitCount: 1,
      validatedHeadSha: "abc",
      isAutomationPr: true,
    });
    assert.equal(r.riskClass, "low");
    assert.equal(r.autoMergeEligible, true);
  });

  it("workflow change → sensitive", () => {
    const r = classifyUpstream({
      changedFiles: [".github/workflows/ci.yml"],
      commitCount: 1,
      isAutomationPr: true,
    });
    assert.equal(r.riskClass, "sensitive");
    assert.equal(r.touchesWorkflows, true);
    assert.equal(r.autoMergeEligible, false);
  });

  it("migration change → sensitive", () => {
    const r = classifyUpstream({
      changedFiles: ["packages/core/migrations/0123_add_thing.sql"],
      commitCount: 2,
      isAutomationPr: true,
    });
    assert.equal(r.riskClass, "sensitive");
    assert.equal(r.touchesMigrations, true);
  });

  it("dependency/lockfile → sensitive", () => {
    const r = classifyUpstream({
      changedFiles: ["pnpm-lock.yaml", "package.json"],
      commitCount: 1,
      isAutomationPr: true,
    });
    assert.equal(r.riskClass, "sensitive");
    assert.equal(r.touchesLockfiles, true);
    assert.equal(r.touchesDependencies, true);
  });

  it("provider/runtime → sensitive", () => {
    const r = classifyUpstream({
      changedFiles: ["packages/engine/src/providers/cursor-cli.ts"],
      commitCount: 1,
      isAutomationPr: true,
    });
    assert.equal(r.riskClass, "sensitive");
    assert.equal(r.touchesProviderRuntime, true);
  });

  it("large change set → sensitive", () => {
    const files = Array.from({ length: LARGE_FILE_COUNT }, (_, i) => `docs/note-${i}.md`);
    const r = classifyUpstream({ changedFiles: files, commitCount: 1, isAutomationPr: true });
    assert.equal(r.riskClass, "sensitive");
  });

  it("failed checks → blocked", () => {
    const r = classifyUpstream({
      changedFiles: ["docs/a.md"],
      commitCount: 1,
      requiredChecksFailed: true,
      isAutomationPr: true,
    });
    assert.equal(r.riskClass, "blocked");
  });

  it("stale validated SHA → blocked", () => {
    const r = classifyUpstream({
      changedFiles: ["docs/a.md"],
      commitCount: 1,
      staleValidatedSha: true,
      isAutomationPr: true,
    });
    assert.equal(r.riskClass, "blocked");
  });

  it("unknown path → sensitive", () => {
    const r = classifyUpstream({
      changedFiles: ["random/obscure/tool.bin"],
      commitCount: 1,
      isAutomationPr: true,
    });
    assert.equal(r.riskClass, "sensitive");
  });

  it("non-automation PR ignored/blocked", () => {
    const r = classifyUpstream({
      changedFiles: ["docs/a.md"],
      commitCount: 1,
      isAutomationPr: false,
    });
    assert.equal(r.ignored, true);
    assert.equal(r.autoMergeEligible, false);
  });

  it("PR #34-shaped payload classifies sensitive", () => {
    const files = [
      ".github/workflows/pr-checks.yml",
      "packages/core/migrations/0999_big.sql",
      ...Array.from({ length: 100 }, (_, i) => `packages/engine/src/f${i}.ts`),
    ];
    const r = classifyUpstream({
      changedFiles: files,
      commitCount: 509,
      validatedHeadSha: "deadbeef",
      isAutomationPr: true,
    });
    assert.equal(r.riskClass, "sensitive");
    assert.equal(r.autoMergeEligible, false);
    assert.equal(r.touchesWorkflows, true);
    assert.equal(r.touchesMigrations, true);
  });
});

describe("AUTO-2 finalize policy", () => {
  it("repeated event updates one report comment (edit not create)", () => {
    /** @type {string[][]} */
    const calls = [];
    let commentExists = false;
    const gh = (args) => {
      calls.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        return {
          status: 0,
          stdout: JSON.stringify({
            number: 99,
            state: "OPEN",
            title: "AUTO-1: absorb",
            headRefName: "automation/upstream-abc",
            baseRefName: "main",
            headRefOid: "sha1",
            mergeable: "MERGEABLE",
            commits: [{ oid: "1" }],
            labels: [],
            url: "https://example/pr/99",
          }),
          stderr: "",
        };
      }
      if (args[0] === "api" && String(args[1] || "").includes("/files")) {
        return { status: 0, stdout: "docs/a.md\n", stderr: "" };
      }
      if (args[0] === "api" && String(args[1] || "").includes("/comments") && args.includes("--jq")) {
        return { status: 0, stdout: commentExists ? "555" : "", stderr: "" };
      }
      if (args[0] === "api" && args.includes("-X") && args.includes("POST")) {
        commentExists = true;
        return { status: 0, stdout: '{"id":555}', stderr: "" };
      }
      if (args[0] === "api" && args.includes("-X") && args.includes("PATCH")) {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "label" || (args[0] === "pr" && args[1] === "edit")) {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
    };

    const first = runAuto2Finalize({
      repo: "Appsolino/Fusion",
      prNumber: 99,
      validatedHeadSha: "sha1",
      validationConclusion: "success",
      allowMissingApp: true,
      dispatchAuto3: false,
      gh,
    });
    assert.equal(first.action, "auto-merged");
    const second = runAuto2Finalize({
      repo: "Appsolino/Fusion",
      prNumber: 99,
      validatedHeadSha: "sha1",
      validationConclusion: "success",
      allowMissingApp: true,
      dispatchAuto3: false,
      gh,
    });
    assert.equal(second.action, "auto-merged");
    const posts = calls.filter((c) => c.includes("POST") && c.some((x) => String(x).includes("/comments")));
    const patches = calls.filter((c) => c.includes("PATCH") && c.some((x) => String(x).includes("comments/")));
    assert.equal(posts.length, 1);
    assert.ok(patches.length >= 1);
  });

  it("stale SHA blocks merge", () => {
    const gh = (args) => {
      if (args[0] === "pr" && args[1] === "view") {
        return {
          status: 0,
          stdout: JSON.stringify({
            number: 7,
            state: "OPEN",
            headRefName: "automation/upstream-abc",
            baseRefName: "main",
            headRefOid: "newsha",
            mergeable: "MERGEABLE",
            commits: [{ oid: "1" }],
            labels: [],
            url: "u",
            title: "t",
          }),
          stderr: "",
        };
      }
      if (args[0] === "api" && String(args[1] || "").includes("/files")) {
        return { status: 0, stdout: "docs/a.md\n", stderr: "" };
      }
      if (args[0] === "api" || args[0] === "label" || args[0] === "pr") {
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "no" };
    };
    const r = runAuto2Finalize({
      repo: "Appsolino/Fusion",
      prNumber: 7,
      validatedHeadSha: "oldsha",
      validationConclusion: "success",
      allowMissingApp: true,
      gh,
    });
    assert.equal(r.action, "blocked");
    assert.equal(r.classification?.riskClass, "blocked");
  });

  it("workflow PR is approval-required, never auto-merged", () => {
    const merges = [];
    const gh = (args) => {
      if (args[0] === "pr" && args[1] === "merge") {
        merges.push(args);
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "view") {
        return {
          status: 0,
          stdout: JSON.stringify({
            number: 34,
            state: "OPEN",
            headRefName: "automation/upstream-73bff5f88cf2",
            baseRefName: "main",
            headRefOid: "head34",
            mergeable: "MERGEABLE",
            commits: Array.from({ length: 50 }, (_, i) => ({ oid: String(i) })),
            labels: [],
            url: "u",
            title: "AUTO-1",
          }),
          stderr: "",
        };
      }
      if (args[0] === "api" && String(args[1] || "").includes("/files")) {
        return {
          status: 0,
          stdout: [".github/workflows/x.yml", "packages/core/migrations/1.sql", ...Array.from({ length: 100 }, (_, i) => `f${i}.ts`)].join("\n"),
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const r = runAuto2Finalize({
      repo: "Appsolino/Fusion",
      prNumber: 34,
      validatedHeadSha: "head34",
      validationConclusion: "success",
      allowMissingApp: true,
      gh,
    });
    assert.equal(r.action, "approval-required");
    assert.equal(r.classification?.riskClass, "sensitive");
    assert.equal(merges.length, 0);
    assert.equal(r.deployedHostD, false);
    assert.equal(r.mutatedMain, false);
  });

  it("finalizer refuses executeCandidateCode", () => {
    assert.throws(
      () =>
        runAuto2Finalize({
          repo: "Appsolino/Fusion",
          prNumber: 1,
          validatedHeadSha: "x",
          allowMissingApp: true,
          executeCandidateCode: true,
          gh: () => ({ status: 0, stdout: "{}", stderr: "" }),
        }),
      /never execute candidate code/i,
    );
  });

  it("fails closed without App token", () => {
    const prev = {
      AUTO2_GITHUB_APP_TOKEN: process.env.AUTO2_GITHUB_APP_TOKEN,
      GH_TOKEN: process.env.GH_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    };
    delete process.env.AUTO2_GITHUB_APP_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      assert.throws(
        () =>
          runAuto2Finalize({
            repo: "Appsolino/Fusion",
            prNumber: 1,
            validatedHeadSha: "x",
            allowMissingApp: false,
          }),
        /fail-closed|App token unavailable/i,
      );
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("isAuto2ManagedHead accepts automation and proof refs only", () => {
    assert.equal(isAuto2ManagedHead("automation/upstream-abc"), true);
    assert.equal(isAuto2ManagedHead("auto2-proof/low"), true);
    assert.equal(isAuto2ManagedHead("fix/iss-ui-001"), false);
  });
});

describe("AUTO-2 workflow trust zones (static)", () => {
  it("candidate validate workflow has no App secrets and read-only permissions", () => {
    const yaml = readFileSync(join(ROOT, ".github/workflows/upstream-auto2-validate.yml"), "utf8");
    assert.match(yaml, /name:\s*Upstream AUTO-2 Validate/);
    assert.match(yaml, /persist-credentials:\s*false/);
    assert.doesNotMatch(yaml, /APPSOLINO_AUTOMATION_APP_PRIVATE_KEY/);
    assert.doesNotMatch(yaml, /uses:\s*actions\/create-github-app-token/);
    assert.doesNotMatch(yaml, /APPSOLINO_AUTOMATION_APP_ID/);
    assert.match(yaml, /permissions:[\s\S]*contents:\s*read/);
    assert.doesNotMatch(yaml, /permission-contents:\s*write/);
    assert.match(yaml, /does not build, install, or activate Host D/);
    assert.doesNotMatch(yaml, /fusion-staging|systemctl|\/opt\/appsolino-fusion\/staging/);
  });

  it("finalizer workflow uses App token, checks out main workflow code, delegates Host D to AUTO-3", () => {
    const yaml = readFileSync(join(ROOT, ".github/workflows/upstream-auto2-finalize.yml"), "utf8");
    assert.match(yaml, /name:\s*Upstream AUTO-2 Finalize/);
    assert.match(yaml, /create-github-app-token@v3/);
    assert.match(yaml, /ref:\s*\$\{\{\s*github\.event_name == 'workflow_dispatch' && github\.ref_name \|\| 'main'\s*\}\}/);
    assert.match(yaml, /auto2-finalize\.mjs/);
    assert.doesNotMatch(yaml, /pnpm (test|install)|npm (test|install)/);
    assert.match(yaml, /must not SSH\/install Host D directly/);
    assert.match(yaml, /upstream-auto3-deploy\.yml/);
    assert.match(yaml, /APPSOLINO_AUTOMATION_APP_ID/);
    assert.doesNotMatch(yaml, /HOST_D_DEPLOY_SSH_KEY/);
  });
});
