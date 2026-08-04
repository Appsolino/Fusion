#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import {
  FORBIDDEN_REVIEW_ENV,
  REVIEW_MODEL,
  REVIEW_PROVIDER,
  reviewChildEnv,
} from "../policy.mjs";
import {
  REQUIRED_CHECK_NAMES,
  assertWriterRecomputedDigests,
  buildEvidenceBundle,
  buildRoleEvidencePayload,
  evaluateRequiredChecks,
  extractChangedFilesFromDiff,
} from "../evidence.mjs";
import { probeCursorModel } from "../model-probe.mjs";
import { invokeCursorReviewRole } from "../spawn.mjs";
import { runCursorReviewer } from "../reviewer.mjs";
import { runCursorApprover, assertApprovalsStillValid } from "../approver.mjs";
import { evaluateDualApprovalMerge, exactHeadMergeArgv } from "../../merge/exact-head.mjs";
import { sha256Text } from "../verdict.mjs";

const SAMPLE_DIFF = `diff --git a/packages/engine/src/executor.ts b/packages/engine/src/executor.ts
--- a/packages/engine/src/executor.ts
+++ b/packages/engine/src/executor.ts
@@ -1,3 +1,4 @@
+import type { CredentialInstanceRotator } from "./credential-instance-rotation.js";
 export function run() {}
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,2 +1,3 @@
 name: ci
+env: {}
`;

function okRollup() {
  return REQUIRED_CHECK_NAMES.map((name) => ({
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
  }));
}

function fakeSpawn(script) {
  return (bin, args, opts) => {
    const ee = new EventEmitter();
    ee.stdout = new EventEmitter();
    ee.stderr = new EventEmitter();
    ee.kill = () => {};
    queueMicrotask(() => {
      const out = script(bin, args, opts);
      ee.stdout.emit("data", Buffer.from(out.stdout || ""));
      if (out.stderr) ee.stderr.emit("data", Buffer.from(out.stderr));
      ee.emit("close", out.code ?? 0);
    });
    return ee;
  };
}

function verdictFields(role, evidence, sessionId) {
  return {
    schemaVersion: 1,
    role,
    verdict: "APPROVE",
    risk: "LOW",
    repository: evidence.repository,
    baseSha: evidence.baseSha,
    headSha: evidence.headSha,
    diffSha256: evidence.diffSha256,
    testsSha256: evidence.testsSha256,
    blockingFindings: [],
    nonBlockingFindings: [],
    requiredChanges: [],
    evidenceChecked: ["diffText", "requiredCheckResults"],
    authorityCheck: {
      hostP: false,
      production: false,
      destructiveData: false,
      secretExpansion: false,
    },
    configuredProvider: REVIEW_PROVIDER,
    configuredModel: REVIEW_MODEL,
    actualProvider: REVIEW_PROVIDER,
    actualModel: REVIEW_MODEL,
    modelFingerprint: `${REVIEW_MODEL} (listed)`,
    requestId: `${role}-${sessionId}`,
    sessionId,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
}

function tempActivation({ s2 = false, s3 = false, kill = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "act-"));
  const policyPath = join(dir, "activation-policy.json");
  const killPath = join(dir, "KILL");
  writeFileSync(
    policyPath,
    JSON.stringify({
      schemaVersion: 1,
      killSwitch: false,
      gates: {
        s1aAutoHandoff: { enabled: false },
        s0HandoffS1a: { enabled: false },
        s1bEnabled: { enabled: false },
        s2Enabled: { enabled: s2 },
        s3Enabled: { enabled: s3 },
      },
      emergency: { killSwitchFile: "KILL" },
    }),
  );
  if (kill) writeFileSync(killPath, "1\n");
  return {
    dir,
    opts: { policyPath, killPath, env: {} },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("evidence + required checks", () => {
  it("extracts changed files and classifications including workflow", () => {
    const files = extractChangedFilesFromDiff(SAMPLE_DIFF);
    assert.deepEqual(files.sort(), [
      ".github/workflows/ci.yml",
      "packages/engine/src/executor.ts",
    ].sort());
    const bundle = buildEvidenceBundle({
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diffText: SAMPLE_DIFF,
      statusCheckRollup: okRollup(),
      risk: "SENSITIVE",
      rollbackPlan: "revert",
      mission: "m",
      policyExcerpts: "p",
    });
    assert.equal(bundle.checksOk, true);
    assert.ok(bundle.classifiedFiles.some((f) => f.kind === "workflow"));
    assert.ok(bundle.classifiedFiles.some((f) => f.kind === "semantic-source"));
  });

  it("empty check set fails closed; missing Lint fails", () => {
    assert.equal(evaluateRequiredChecks([]).ok, false);
    assert.ok(evaluateRequiredChecks([]).reasons.some((r) => r.includes("missing-required-check:Lint")));
    const partial = okRollup().filter((c) => c.name !== "Lint");
    const r = evaluateRequiredChecks(partial);
    assert.equal(r.ok, false);
    assert.ok(r.reasons.includes("missing-required-check:Lint"));
  });

  it("role payload includes actual patch content for reviewer and approver", () => {
    const bundle = buildEvidenceBundle({
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diffText: SAMPLE_DIFF,
      statusCheckRollup: okRollup(),
      risk: "LOW",
      rollbackPlan: "revert",
    });
    const rev = buildRoleEvidencePayload(bundle, "reviewer", { sessionId: "s1" });
    const appr = buildRoleEvidencePayload(bundle, "approver", { sessionId: "s2" });
    assert.match(rev.diffText, /CredentialInstanceRotator/);
    assert.match(appr.diffText, /CredentialInstanceRotator/);
    assert.ok(Array.isArray(rev.requiredCheckResults));
    assert.equal(rev.requiredCheckResults.length, 5);
    assert.ok(appr.changedFiles.includes("packages/engine/src/executor.ts"));
  });

  it("writer self-comparison rejected", () => {
    assert.throws(
      () =>
        assertWriterRecomputedDigests({
          artifactDiffSha256: "a".repeat(64),
          recomputedDiffSha256: "a".repeat(64),
          artifactTestsSha256: "b".repeat(64),
          recomputedTestsSha256: "b".repeat(64),
          usedArtifactAsCurrent: true,
        }),
      /self-comparison/,
    );
  });
});

describe("model probe + sanitized spawn", () => {
  it("probe uses sanitized env and proves listed model", async () => {
    const spawnFn = fakeSpawn((_bin, args) => {
      assert.deepEqual(args, ["models"]);
      return { stdout: "composer-2.5\ncomposer-2\n", code: 0 };
    });
    const probe = await probeCursorModel({
      sessionId: "probe-1",
      role: "reviewer",
      spawnFn,
      apiKey: "k",
    });
    assert.equal(probe.actualModel, "composer-2.5");
    assert.match(probe.modelFingerprint, /composer-2.5/);
    assert.ok(!probe.sanitizedEnvKeys.includes("GITHUB_TOKEN"));
    assert.ok(!probe.sanitizedEnvKeys.includes("XAI_API_KEY"));
  });

  it("unavailable model fail-closed", async () => {
    const spawnFn = fakeSpawn(() => ({ stdout: "composer-2\n", code: 0 }));
    await assert.rejects(
      () =>
        probeCursorModel({
          sessionId: "probe-2",
          role: "approver",
          spawnFn,
        }),
      /unavailable/,
    );
  });

  it("invokeCursorReviewRole does not hardcode actualModel without probe", async () => {
    const spawnFn = fakeSpawn((_bin, args) => {
      if (args[0] === "models") return { stdout: "composer-2.5\n", code: 0 };
      return {
        stdout: "```json\n" + JSON.stringify({
          schemaVersion: 1,
          role: "reviewer",
          verdict: "APPROVE",
          risk: "LOW",
          requestId: "x",
          actualModel: "composer-2.5",
          actualProvider: "cursor-cli",
        }) + "\n```\n",
        code: 0,
      };
    });
    const r = await invokeCursorReviewRole({
      role: "reviewer",
      system: "sys",
      user: JSON.stringify({ diffText: SAMPLE_DIFF }),
      spawnFn,
      sessionId: randomUUID(),
    });
    assert.equal(r.actualModel, "composer-2.5");
    assert.ok(r.modelEvidence?.listedLine);
    assert.notEqual(r.modelFingerprint, undefined);
    // Fingerprint is listed line evidence, not a bare constant assignment path alone.
    assert.match(r.modelFingerprint, /composer-2.5/);
  });
});

describe("dual review with real child process simulation", () => {
  it("reviewer and approver prompts contain patch; separate sessions; gates enforced", async () => {
    const bundle = buildEvidenceBundle({
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diffText: SAMPLE_DIFF,
      statusCheckRollup: okRollup(),
      risk: "LOW",
      rollbackPlan: "revert",
      mission: "mission-x",
      policyExcerpts: "policy-y",
    });

    const seen = [];
    const spawnFn = fakeSpawn((_bin, args, opts) => {
      seen.push({ args: [...args], env: { ...opts.env } });
      if (args[0] === "models") return { stdout: "composer-2.5 (default)\n", code: 0 };
      const prompt = args[args.length - 1] || "";
      assert.match(prompt, /CredentialInstanceRotator/);
      assert.match(prompt, /diffText/);
      assert.match(prompt, /requiredCheckResults/);
      for (const bad of FORBIDDEN_REVIEW_ENV) {
        assert.equal(opts.env[bad], undefined);
      }
      const role = opts.env.STEWARD_REVIEW_ROLE;
      const sessionId = opts.env.STEWARD_REVIEW_SESSION_ID;
      return {
        stdout:
          "```json\n" +
          JSON.stringify(verdictFields(role, bundle, sessionId)) +
          "\n```\n",
        code: 0,
      };
    });

    const reviewer = await runCursorReviewer({ evidence: bundle, spawnFn });
    const approver = await runCursorApprover({
      evidence: {
        ...bundle,
        reviewerRequestId: reviewer.requestId,
        reviewerSessionId: reviewer.sessionId,
        reviewerVerdictRaw: reviewer,
      },
      spawnFn,
    });
    assert.notEqual(reviewer.sessionId, approver.sessionId);
    assert.ok(reviewer.evidencePayloadHasDiffText);
    assert.ok(approver.evidencePayloadHasDiffText);
    assert.equal(reviewer.actualModel, "composer-2.5");
    // models probe + ask for each role
    assert.ok(seen.filter((s) => s.args[0] === "models").length >= 2);
    assert.ok(seen.filter((s) => s.args.includes("--mode") && s.args.includes("ask")).length >= 2);

    const off = tempActivation({ s2: false });
    try {
      const blocked = evaluateDualApprovalMerge({
        repository: "Appsolino/Fusion",
        risk: "LOW",
        reviewer,
        approver,
        currentHeadSha: bundle.headSha,
        currentDiffSha256: bundle.diffSha256,
        currentTestsSha256: bundle.testsSha256,
        checksConclusion: "success",
        activationOpts: off.opts,
      });
      assert.equal(blocked.ok, false);
      assert.ok(blocked.reasons.includes("s2-gate-disabled"));
    } finally {
      off.cleanup();
    }

    const kill = tempActivation({ s2: true, kill: true });
    try {
      const blocked = evaluateDualApprovalMerge({
        repository: "Appsolino/Fusion",
        risk: "LOW",
        reviewer,
        approver,
        currentHeadSha: bundle.headSha,
        currentDiffSha256: bundle.diffSha256,
        currentTestsSha256: bundle.testsSha256,
        checksConclusion: "success",
        activationOpts: kill.opts,
      });
      assert.ok(blocked.reasons.includes("kill-switch-or-KILL-file"));
    } finally {
      kill.cleanup();
    }

    const on = tempActivation({ s2: true });
    try {
      const ok = evaluateDualApprovalMerge({
        repository: "Appsolino/Fusion",
        risk: "LOW",
        reviewer,
        approver,
        currentHeadSha: bundle.headSha,
        currentDiffSha256: bundle.diffSha256,
        currentTestsSha256: bundle.testsSha256,
        checksConclusion: "success",
        activationOpts: on.opts,
      });
      assert.equal(ok.ok, true);
    } finally {
      on.cleanup();
    }

    assertApprovalsStillValid({
      reviewer,
      approver,
      currentHeadSha: bundle.headSha,
      currentDiffSha256: bundle.diffSha256,
      currentTestsSha256: bundle.testsSha256,
    });
    assert.ok(exactHeadMergeArgv({ prNumber: 80, headSha: bundle.headSha }).includes("--match-head-commit"));
  });

  it("stale digests still rejected", () => {
    const bundle = buildEvidenceBundle({
      repository: "Appsolino/Fusion",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diffText: SAMPLE_DIFF,
      statusCheckRollup: okRollup(),
      risk: "LOW",
      rollbackPlan: "r",
    });
    const sid = randomUUID();
    const reviewer = verdictFields("reviewer", bundle, sid);
    const approver = verdictFields("approver", bundle, randomUUID());
    assert.throws(
      () =>
        assertApprovalsStillValid({
          reviewer,
          approver,
          currentHeadSha: bundle.headSha,
          currentDiffSha256: sha256Text("other"),
          currentTestsSha256: bundle.testsSha256,
        }),
      /changed diff/,
    );
  });
});

describe("reviewChildEnv credential boundary", () => {
  it("strips write and host secrets", () => {
    const env = reviewChildEnv({
      role: "approver",
      sessionId: "s",
      apiKey: "ck",
      src: {
        PATH: "/bin",
        GITHUB_TOKEN: "g",
        HOST_D_DEPLOY_SSH_KEY: "h",
        XAI_API_KEY: "x",
      },
    });
    assert.equal(env.CURSOR_API_KEY, "ck");
    for (const k of FORBIDDEN_REVIEW_ENV) assert.equal(env[k], undefined);
  });
});

describe("orchestrator gate overrides forbidden", () => {
  it("run-dual-approve.mjs must not hardcode s2Gate/s3Gate true", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../run-dual-approve.mjs"), "utf8");
    assert.equal(/s2Gate\s*:\s*true/.test(src), false);
    assert.equal(/s3Gate\s*:\s*true/.test(src), false);
  });
});
