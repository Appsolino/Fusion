#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * S1A Expert Advisory Mode — required case coverage (fixture + trust-zone).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";

import { checkEligibility } from "../eligibility.mjs";
import { clearProcessLocks } from "../lock.mjs";
import { buildEvidencePack } from "../evidence-pack.mjs";
import { analyzeEvidence, classifyConflictFile, runEngineer } from "../engineer.mjs";
import { reviewAssessment, runReviewer } from "../reviewer.mjs";
import { renderAssessmentMarkdown } from "../render-assessment.mjs";
import {
  upsertAssessmentComment,
  createMemoryCommentClient,
} from "../upsert-comment.mjs";
import {
  planLabelTransition,
  applyLabelTransition,
  createMemoryLabelClient,
} from "../labels.mjs";
import { assertS1aAuthority, scanAuthorityText } from "../guard-authority.mjs";
import {
  loadFixturePack,
  runS1a,
  runS1aFixture,
  runS1aAnalyze,
  runS1aUpsert,
} from "../run-s1a.mjs";
import { validateAssessmentArtifact } from "../assessment-artifact.mjs";
import { createRepairWorktree, removeRepairWorktree } from "../worktree.mjs";
import {
  ALLOWED_REPO,
  FIXTURE_MODEL,
  FIXTURE_PROVIDER,
  LIVE_MODEL,
  LIVE_PROVIDER,
  REVIEW_VERDICT,
  RISK_LEVEL,
  S1A_BOUNDS,
  S1A_LABELS,
  assertRepoAllowed,
  extractAssessmentMarker,
  resolveEngineId,
} from "../policy.mjs";
import { escapeMarkdown } from "../../policy.mjs";
import { buildNewIssueContent } from "../../upsert-incident.mjs";
import { collectFromFixture } from "../../collect-evidence.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "issue-74-shaped");
const WORKFLOW = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "upstream-reliability-steward-s1a.yml",
);
const S0_FIXTURES = join(HERE, "..", "..", "__tests__", "fixtures");
const UPSERT_SRC = readFileSync(join(HERE, "..", "run-s1a-upsert.mjs"), "utf8");
const REVIEWER_SRC = readFileSync(join(HERE, "..", "reviewer.mjs"), "utf8");
const REVIEWER_PROC_SRC = readFileSync(
  join(HERE, "..", "run-reviewer-process.mjs"),
  "utf8",
);

beforeEach(() => {
  clearProcessLocks();
  delete process.env.S1A_ENGINE;
  delete process.env.S1A_MODE;
  delete process.env.S1A_PROVIDER;
  delete process.env.S1A_MODEL;
});

describe("S1A eligibility", () => {
  it("eligible launches one assessment", async () => {
    const result = await runS1aFixture({ issueNumber: 74 });
    assert.equal(result.action, "assessed");
    assert.equal(result.reviewVerdict, REVIEW_VERDICT.ACCEPT);
    assert.equal(result.comment.action, "create");
    assert.equal(result.configuredProvider, result.actualProvider);
    assert.equal(result.configuredModel, result.actualModel);
    assert.equal(result.engine, "fixture");
    assert.ok(result.labels.labels.includes(S1A_LABELS.ADVICE_READY));
  });

  it("invalid/missing fingerprint rejected", () => {
    const r = checkEligibility({
      repo: ALLOWED_REPO,
      issue: {
        number: 1,
        state: "open",
        body: "no marker here",
        labels: ["appsolino-steward", S1A_LABELS.NEEDS_EXPERT],
      },
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "invalid-or-missing-fingerprint");
  });

  it("non-steward issue ignored", () => {
    const { issue } = loadFixturePack();
    const r = checkEligibility({
      repo: ALLOWED_REPO,
      issue: {
        ...issue,
        labels: [S1A_LABELS.NEEDS_EXPERT],
      },
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "missing-steward-label");
  });

  it("duplicate trigger no duplicate assessment (same fp+occurrence)", async () => {
    const first = await runS1aFixture({ issueNumber: 74 });
    assert.equal(first.action, "assessed");
    const fixture = loadFixturePack();
    const labels = createMemoryLabelClient({
      74: ["appsolino-steward", S1A_LABELS.NEEDS_EXPERT, S1A_LABELS.ADVICE_READY],
    });
    const comments = createMemoryCommentClient([
      { id: 1, body: first.artifact.markdown },
    ]);
    const second = await runS1a({
      repo: ALLOWED_REPO,
      issueNumber: 74,
      mode: "fixture",
      skipAuthorityGuard: true,
      issueOverride: {
        ...fixture.issue,
        number: 74,
        labels: ["appsolino-steward", S1A_LABELS.NEEDS_EXPERT],
      },
      relatedPrOverride: fixture.relatedPr,
      clients: {
        labels,
        comments,
        skipWorktree: true,
        spawnReviewer: false,
      },
    });
    assert.equal(second.action, "noop-already-assessed");
  });

  it("concurrent lock second call blocked/noop", async () => {
    const fixture = loadFixturePack();
    const labels = createMemoryLabelClient({
      74: [
        "appsolino-steward",
        S1A_LABELS.NEEDS_EXPERT,
        S1A_LABELS.EXPERT_RUNNING,
      ],
    });
    const comments = createMemoryCommentClient();
    const result = await runS1aAnalyze({
      repo: ALLOWED_REPO,
      issueNumber: 74,
      mode: "fixture",
      skipAuthorityGuard: true,
      issueOverride: {
        ...fixture.issue,
        number: 74,
        labels: [
          "appsolino-steward",
          S1A_LABELS.NEEDS_EXPERT,
          S1A_LABELS.EXPERT_RUNNING,
        ],
      },
      clients: {
        labels: { getIssueLabels: (n) => labels.getIssueLabels(n) },
        listComments: () => comments.listComments(74),
        skipWorktree: true,
        spawnReviewer: false,
      },
    });
    assert.ok(
      result.action === "noop-lock" || result.action === "skip",
      result.action,
    );
    assert.match(String(result.reason || ""), /label-lock-held|active-expert-lock/);
  });
});

describe("S1A reviewer", () => {
  it("reviewer ACCEPT", () => {
    const { issue, relatedPr } = loadFixturePack();
    const pack = buildEvidencePack({ issue, relatedPr });
    const assessment = analyzeEvidence(pack);
    const review = reviewAssessment({ evidencePack: pack, assessment });
    assert.equal(review.verdict, REVIEW_VERDICT.ACCEPT);
  });

  it("reviewer REJECT → one revision then ACCEPT or escalate", async () => {
    let calls = 0;
    const result = await runS1aFixture({
      issueNumber: 74,
      reviewFn: ({ assessment }) => {
        calls += 1;
        if (calls === 1) {
          return {
            verdict: REVIEW_VERDICT.REJECT,
            reason: "incomplete-root-cause",
            details: ["force revision"],
          };
        }
        return {
          verdict: REVIEW_VERDICT.ACCEPT,
          reason: "ok-after-revision",
          details: [],
        };
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.revised, true);
    assert.equal(result.reviewVerdict, REVIEW_VERDICT.ACCEPT);
  });

  it("reviewer NEEDS_MORE_EVIDENCE → label needs-evidence", async () => {
    const result = await runS1aFixture({
      issueNumber: 74,
      reviewFn: () => ({
        verdict: REVIEW_VERDICT.NEEDS_MORE_EVIDENCE,
        reason: "need-more-log",
        details: [],
      }),
    });
    assert.equal(result.reviewVerdict, REVIEW_VERDICT.NEEDS_MORE_EVIDENCE);
    assert.ok(result.labels.labels.includes(S1A_LABELS.NEEDS_EVIDENCE));
  });

  it("CRITICAL → advice/freeze only (owner-required)", async () => {
    const fixture = loadFixturePack();
    const body = String(fixture.issue.body).replace(
      /\| Terminal \| [^|]+ \|/,
      "| Terminal | CRITICAL |",
    );
    const result = await runS1aFixture({
      issueNumber: 74,
      issueOverride: {
        ...fixture.issue,
        body,
        labels: ["appsolino-steward", S1A_LABELS.NEEDS_EXPERT],
      },
    });
    assert.equal(result.assessment.criticalFreeze, true);
    assert.ok(result.labels.labels.includes(S1A_LABELS.OWNER_REQUIRED));
  });

  it("reviewer does not import fixture-engine or engineer facade", () => {
    assert.ok(!REVIEWER_SRC.includes('from "./fixture-engine'));
    assert.ok(!REVIEWER_SRC.includes('from "./engineer'));
    assert.ok(!REVIEWER_PROC_SRC.includes('from "./fixture-engine'));
    assert.ok(!REVIEWER_PROC_SRC.includes('from "./engineer'));
    assert.ok(REVIEWER_SRC.includes('from "./path-heuristics'));
  });
});

describe("S1A provider/model + engine gating", () => {
  it("fixture provider/model reporting configured===actual", async () => {
    const result = await runS1aFixture({ issueNumber: 74 });
    assert.equal(result.configuredProvider, FIXTURE_PROVIDER);
    assert.equal(result.configuredModel, FIXTURE_MODEL);
    assert.equal(result.actualProvider, FIXTURE_PROVIDER);
    assert.equal(result.actualModel, FIXTURE_MODEL);
    assert.equal(result.bounds.maxAttempts, 2);
    assert.equal(result.bounds.maxRuntimeMs, 600_000);
    assert.equal(result.bounds.assessmentVersion, 1);
  });

  it("live mode rejects fixture/deterministic engine", () => {
    assert.throws(
      () => resolveEngineId("live", "fixture"),
      /rejects fixture\/deterministic/,
    );
    assert.throws(
      () => resolveEngineId("live", "deterministic"),
      /rejects fixture\/deterministic/,
    );
    assert.equal(resolveEngineId("live", "cursor-cli"), "cursor-cli");
  });

  it("combined runS1a forbids live mode", async () => {
    await assert.rejects(
      () =>
        runS1a({
          repo: ALLOWED_REPO,
          issueNumber: 74,
          mode: "live",
          clients: {
            labels: createMemoryLabelClient(),
            comments: createMemoryCommentClient(),
          },
          skipAuthorityGuard: true,
        }),
      /forbids mode=live/,
    );
  });

  it("missing real cursor binary fails closed (no silent fixture fallback)", async () => {
    const prevBin = process.env.S1A_CURSOR_AGENT_BIN;
    process.env.S1A_ENGINE = "cursor-cli";
    process.env.S1A_MODE = "live";
    process.env.S1A_PROVIDER = LIVE_PROVIDER;
    process.env.S1A_MODEL = LIVE_MODEL;
    process.env.S1A_CURSOR_AGENT_BIN = "/nonexistent/cursor-agent-s1a-test";
    try {
      const { issue, relatedPr } = loadFixturePack();
      const pack = buildEvidencePack({ issue, relatedPr });
      await assert.rejects(
        () => runEngineer(pack, { mode: "live" }),
        /fail closed|spawn|ENOENT|cursor-engine/i,
      );
    } finally {
      if (prevBin === undefined) delete process.env.S1A_CURSOR_AGENT_BIN;
      else process.env.S1A_CURSOR_AGENT_BIN = prevBin;
    }
  });

  it("cursor-engine mock reports configured/actual cursor-cli/composer-2.5", async () => {
    const { issue, relatedPr } = loadFixturePack();
    const pack = buildEvidencePack({ issue, relatedPr });
    process.env.S1A_PROVIDER = LIVE_PROVIDER;
    process.env.S1A_MODEL = LIVE_MODEL;
    const { runCursorEngine } = await import("../cursor-engine.mjs");

    function mockSpawn() {
      const ee = new EventEmitter();
      ee.stdout = new EventEmitter();
      ee.stderr = new EventEmitter();
      ee.kill = () => {};
      queueMicrotask(() => {
        ee.stdout.emit(
          "data",
          Buffer.from(
            "```json\n" +
              JSON.stringify({
                summary: "mock",
                rootCause: "mock",
                recommendedSolution: "mock",
                confidence: "HIGH",
                risk: "SENSITIVE",
                files: pack.auto1.conflictedFiles.map((p) => ({
                  path: p,
                  kind: "other",
                  playbook: "x",
                  notes: "",
                })),
                validation: ["t"],
                ownerDecision: "none",
                repairRecommended: true,
                needsMoreEvidence: false,
                criticalFreeze: false,
                evidenceGaps: [],
              }) +
              "\n```\n",
          ),
        );
        ee.emit("close", 0);
      });
      return ee;
    }

    const assessment = await runCursorEngine(pack, {
      spawnFn: mockSpawn,
      cursorBin: "/mock/cursor-agent",
      worktreePath: mkdtempSync(join(tmpdir(), "s1a-mock-")),
      skipModelProbe: true,
    });
    assert.equal(assessment.configuredProvider, LIVE_PROVIDER);
    assert.equal(assessment.configuredModel, LIVE_MODEL);
    assert.equal(assessment.actualProvider, LIVE_PROVIDER);
    assert.equal(assessment.actualModel, LIVE_MODEL);
    assert.equal(assessment.actualModelSource, "spawn-arg+stdout-parse");
  });
});

describe("S1A trust zones + allowlist", () => {
  it("writer module cannot execute engineer/reviewer/cursor", () => {
    assert.ok(!UPSERT_SRC.includes("runEngineer("));
    assert.ok(!UPSERT_SRC.includes("runCursorEngine("));
    assert.ok(!UPSERT_SRC.includes("runFixtureEngine("));
    assert.ok(!UPSERT_SRC.includes("runReviewer("));
    assert.ok(!/from\s+[\"']\.\/fixture-engine/.test(UPSERT_SRC));
    assert.ok(!/from\s+[\"']\.\/cursor-engine/.test(UPSERT_SRC));
    assert.ok(!/from\s+[\"']\.\/engineer/.test(UPSERT_SRC));
    assert.ok(!/from\s+[\"']\.\/reviewer/.test(UPSERT_SRC));
  });

  it("live upsert refuses fixture/deterministic artifact", () => {
    assert.throws(
      () =>
        validateAssessmentArtifact(
          {
            schemaVersion: 1,
            repo: ALLOWED_REPO,
            issueNumber: 74,
            fingerprint: "a".repeat(64),
            occurrence: "workflow-run:1:attempt:1",
            mode: "live",
            engine: "fixture",
            configuredProvider: FIXTURE_PROVIDER,
            configuredModel: FIXTURE_MODEL,
            actualProvider: FIXTURE_PROVIDER,
            actualModel: FIXTURE_MODEL,
            assessment: { criticalFreeze: false },
            reviewer: { verdict: "ACCEPT" },
            markdown: "x",
          },
          { expectMode: "live" },
        ),
      /fixture\/deterministic/,
    );
  });

  it("repo allowlist blocks Runfusion/Fusion", () => {
    assert.throws(() => assertRepoAllowed("Runfusion/Fusion"), /repo-not-allowed/);
    assert.equal(assertRepoAllowed(ALLOWED_REPO), ALLOWED_REPO);
    const { issue } = loadFixturePack();
    const r = checkEligibility({
      repo: "Runfusion/Fusion",
      issue: {
        ...issue,
        labels: ["appsolino-steward", S1A_LABELS.NEEDS_EXPERT],
      },
    });
    assert.equal(r.eligible, false);
    assert.match(r.reason, /repo-not-allowed|Runfusion/);
  });

  it("analyze then upsert trust-split with memory clients", async () => {
    const fixture = loadFixturePack();
    const labels = createMemoryLabelClient({
      74: ["appsolino-steward", S1A_LABELS.NEEDS_EXPERT],
    });
    const comments = createMemoryCommentClient();
    const analyzed = await runS1aAnalyze({
      repo: ALLOWED_REPO,
      issueNumber: 74,
      mode: "fixture",
      skipAuthorityGuard: true,
      issueOverride: {
        ...fixture.issue,
        number: 74,
        labels: ["appsolino-steward", S1A_LABELS.NEEDS_EXPERT],
      },
      relatedPrOverride: fixture.relatedPr,
      clients: {
        labels: { getIssueLabels: (n) => labels.getIssueLabels(n) },
        listComments: (n) => comments.listComments(n),
        skipWorktree: true,
        spawnReviewer: false,
      },
    });
    assert.equal(analyzed.action, "analyzed");
    assert.ok(analyzed.artifact);
    const upserted = await runS1aUpsert({
      artifact: analyzed.artifact,
      repo: ALLOWED_REPO,
      expectMode: "fixture",
      skipAuthorityGuard: true,
      clients: { labels, comments },
    });
    assert.equal(upserted.action, "upserted");
    assert.equal(upserted.comment.action, "create");
  });

  it("unknown physical values remain null", () => {
    const { issue, relatedPr } = loadFixturePack();
    const pack = buildEvidencePack({ issue, relatedPr });
    assert.equal(pack.physical.hostPAccessed, null);
    assert.equal(pack.physical.enginePaused, null);
    assert.equal(pack.physical.mutatedMain, false);
    assert.equal(pack.physical.deployedHostD, false);
  });

});

describe("S1A worktree lifecycle", () => {
  it("creates detached worktree then removes it", () => {
    const root = mkdtempSync(join(tmpdir(), "s1a-git-"));
    spawnSync("git", ["init"], { cwd: root });
    spawnSync("git", ["config", "user.email", "s1a@test"], { cwd: root });
    spawnSync("git", ["config", "user.name", "s1a"], { cwd: root });
    writeFileSync(join(root, "README"), "x\n");
    spawnSync("git", ["add", "."], { cwd: root });
    spawnSync("git", ["commit", "-m", "init"], { cwd: root });

    const wtRoot = join(root, "wts");
    const wt = createRepairWorktree({
      incidentId: 74,
      repoRoot: root,
      mode: "fixture",
      worktreeRoot: wtRoot,
    });
    assert.ok(existsSync(wt.path));
    assert.ok(existsSync(join(wt.path, ".s1a-advice-only")));
    removeRepairWorktree({ path: wt.path, repoRoot: root });
    assert.ok(!existsSync(wt.path));
    rmSync(root, { recursive: true, force: true });
  });
});

describe("S1A guard authority", () => {
  it("guard: no deployment secret refs / no AUTO dispatch / no Host P", () => {
    const wf = readFileSync(WORKFLOW, "utf8");
    const hits = scanAuthorityText(wf, "workflow");
    assert.deepEqual(hits, []);
    assert.ok(!/secrets\.HOST_D_/i.test(wf));
    assert.ok(!/secrets\.HOST_P_/i.test(wf));
    assert.ok(!/gh\s+workflow\s+run/.test(wf));
    assert.ok(!/gh\s+run\s+rerun/.test(wf));
    assert.ok(!/^[\t ]*issues:[\t ]*write[\t ]*$/m.test(wf));
    assert.ok(/self-hosted/.test(wf));
    assert.ok(/appsolino-fusion/.test(wf));
    assert.ok(/cursor-cli/.test(wf));
    assert.ok(/composer-2\.5/.test(wf));
    assert.ok(/run-s1a-analyze\.mjs/.test(wf));
    assert.ok(/run-s1a-upsert\.mjs/.test(wf));

    const auth = assertS1aAuthority({ workflowPath: WORKFLOW });
    assert.equal(auth.ok, true, JSON.stringify(auth.violations, null, 2));
  });
});

describe("S1A markdown escaping", () => {
  it("escapes untrusted fields in assessment", () => {
    const { issue, relatedPr } = loadFixturePack();
    const pack = buildEvidencePack({ issue, relatedPr });
    const assessment = analyzeEvidence(pack);
    assessment.rootCause = "bad *markdown* with <script> and [link](x)";
    const md = renderAssessmentMarkdown({
      evidencePack: pack,
      assessment,
      review: { verdict: "ACCEPT", reason: "ok" },
      occurrence: pack.latestOccurrenceId,
    });
    assert.ok(md.includes(escapeMarkdown("bad *markdown* with <script> and [link](x)")));
    assert.ok(!md.includes("<script>"));
    const marker = extractAssessmentMarker(md);
    assert.ok(marker);
    assert.equal(marker.fingerprint, pack.fingerprint);
  });
});

describe("S1A #74-shaped golden assessment", () => {
  it("distinguishes generated baseline vs executor semantic vs SENSITIVE overall", async () => {
    const golden = JSON.parse(
      readFileSync(join(FIX, "golden-assessment.fragments.json"), "utf8"),
    );
    const result = await runS1aFixture({ issueNumber: 74 });
    assert.equal(result.action, "assessed");
    assert.equal(result.assessment.risk, RISK_LEVEL.SENSITIVE);
    const kinds = result.assessment.files.map((f) => f.kind).sort();
    assert.ok(kinds.includes("generated-baseline"));
    assert.ok(kinds.includes("semantic-source"));
    for (const frag of golden.mustInclude || []) {
      assert.ok(
        result.artifact.markdown.includes(frag) ||
          JSON.stringify(result.assessment).includes(frag),
        `missing fragment ${frag}`,
      );
    }
  });

  it("classifyConflictFile derives from paths not hardcoded issue #74 only", () => {
    assert.equal(
      classifyConflictFile("scripts/lib/lifecycle-column-census-baseline.json").kind,
      "generated-baseline",
    );
    assert.equal(
      classifyConflictFile("packages/engine/src/executor.ts").kind,
      "semantic-source",
    );
  });
});

describe("S0 handoff still default OFF", () => {
  it("default OFF; STEWARD_S0_HANDOFF_S1A=1 adds needs-expert", () => {
    const prev = process.env.STEWARD_S0_HANDOFF_S1A;
    try {
      delete process.env.STEWARD_S0_HANDOFF_S1A;
      const { normalized } = collectFromFixture(
        join(S0_FIXTURES, "auto1-upstream-merge-conflict-30805433281"),
      );
      const content = buildNewIssueContent(normalized);
      assert.ok(!(content.labels || []).includes(S1A_LABELS.NEEDS_EXPERT));
      process.env.STEWARD_S0_HANDOFF_S1A = "1";
      const contentOn = buildNewIssueContent(normalized);
      assert.ok((contentOn.labels || []).includes(S1A_LABELS.NEEDS_EXPERT));
    } finally {
      if (prev === undefined) delete process.env.STEWARD_S0_HANDOFF_S1A;
      else process.env.STEWARD_S0_HANDOFF_S1A = prev;
    }
  });
});

describe("S1A PR flags → SENSITIVE", () => {
  it("workflow/migration/lockfile touches set SENSITIVE", () => {
    const { issue } = loadFixturePack();
    const pack = buildEvidencePack({
      issue,
      relatedPr: {
        number: 68,
        url: "https://github.com/Appsolino/Fusion/pull/68",
        title: "x",
        changedFiles: [".github/workflows/x.yml", "db/migrations/1.sql", "pnpm-lock.yaml"],
        touchesWorkflows: true,
        touchesMigrations: true,
        touchesLockfile: true,
      },
    });
    const assessment = analyzeEvidence(pack);
    assert.equal(assessment.risk, RISK_LEVEL.SENSITIVE);
  });
});
