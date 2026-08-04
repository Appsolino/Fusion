#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * S1A Expert Advisory Mode — required case coverage.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkEligibility } from "../eligibility.mjs";
import { acquireLock, releaseLock, clearProcessLocks } from "../lock.mjs";
import { buildEvidencePack } from "../evidence-pack.mjs";
import { analyzeEvidence, classifyConflictFile, runEngineer } from "../engineer.mjs";
import { reviewAssessment, runReviewer } from "../reviewer.mjs";
import { renderAssessmentMarkdown } from "../render-assessment.mjs";
import {
  upsertAssessmentComment,
  createMemoryCommentClient,
  findAssessmentComment,
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
} from "../run-s1a.mjs";
import {
  ALLOWED_REPO,
  PINNED_MODEL,
  PINNED_PROVIDER,
  REVIEW_VERDICT,
  RISK_LEVEL,
  S1A_BOUNDS,
  S1A_LABELS,
  extractAssessmentMarker,
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

beforeEach(() => {
  clearProcessLocks();
});

describe("S1A eligibility", () => {
  it("eligible launches one assessment", async () => {
    const result = await runS1aFixture({ issueNumber: 74 });
    assert.equal(result.action, "assessed");
    assert.equal(result.reviewVerdict, REVIEW_VERDICT.ACCEPT);
    assert.equal(result.comment.action, "create");
    assert.equal(result.configuredProvider, result.actualProvider);
    assert.equal(result.configuredModel, result.actualModel);
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
});

describe("S1A idempotency + lock", () => {
  it("duplicate trigger no duplicate assessment (same fp+occurrence)", async () => {
    const fixture = loadFixturePack();
    const issueNumber = 74;
    const labels = createMemoryLabelClient({
      [issueNumber]: ["appsolino-steward", S1A_LABELS.NEEDS_EXPERT, "upstream-merge-conflict"],
    });
    const comments = createMemoryCommentClient();
    const issue = { ...fixture.issue, number: issueNumber, labels: await labels.getIssueLabels(issueNumber) };

    const first = await runS1a({
      repo: ALLOWED_REPO,
      issueNumber,
      mode: "fixture",
      skipAuthorityGuard: true,
      issueOverride: issue,
      relatedPrOverride: fixture.relatedPr,
      clients: { labels, comments },
    });
    assert.equal(first.action, "assessed");
    assert.equal(comments.comments.length, 1);

    // Re-arm needs-expert for a second launch attempt (same occurrence).
    await labels.addLabels(issueNumber, [S1A_LABELS.NEEDS_EXPERT]);
    clearProcessLocks();

    const second = await runS1a({
      repo: ALLOWED_REPO,
      issueNumber,
      mode: "fixture",
      skipAuthorityGuard: true,
      issueOverride: {
        ...issue,
        labels: await labels.getIssueLabels(issueNumber),
      },
      relatedPrOverride: fixture.relatedPr,
      clients: { labels, comments },
    });
    assert.equal(second.action, "assessed");
    assert.equal(second.comment.action, "noop-duplicate-assessment");
    assert.equal(comments.comments.length, 1);
  });

  it("concurrent lock second call blocked/noop", async () => {
    const fixture = loadFixturePack();
    const issueNumber = 74;
    const labels = createMemoryLabelClient({
      [issueNumber]: ["appsolino-steward", S1A_LABELS.NEEDS_EXPERT],
    });
    const comments = createMemoryCommentClient();
    const issue = { ...fixture.issue, number: issueNumber };

    const pack = buildEvidencePack({ issue, relatedPr: fixture.relatedPr });
    const occurrence = pack.latestOccurrenceId;

    const a = await acquireLock(labels, {
      issueNumber,
      fingerprint: pack.fingerprint,
      occurrence,
    });
    assert.equal(a.acquired, true);

    const b = await acquireLock(labels, {
      issueNumber,
      fingerprint: pack.fingerprint,
      occurrence,
    });
    assert.equal(b.acquired, false);
    assert.match(b.reason, /lock/);

    await releaseLock(labels, {
      issueNumber,
      fingerprint: pack.fingerprint,
      occurrence,
    });
  });
});

describe("S1A reviewer paths", () => {
  it("reviewer ACCEPT", () => {
    const { issue, relatedPr } = loadFixturePack();
    const pack = buildEvidencePack({ issue, relatedPr });
    const assessment = analyzeEvidence(pack);
    const review = reviewAssessment({ evidencePack: pack, assessment });
    assert.equal(review.verdict, REVIEW_VERDICT.ACCEPT);
  });

  it("reviewer REJECT → one revision then ACCEPT or escalate", async () => {
    const { issue, relatedPr } = loadFixturePack();
    const pack = buildEvidencePack({ issue, relatedPr });
    let calls = 0;
    const reviewFn = ({ assessment }) => {
      calls += 1;
      if (calls === 1) {
        return {
          verdict: REVIEW_VERDICT.REJECT,
          reason: "forced-first-reject",
          details: ["test"],
        };
      }
      // Second pass uses real reviewer
      return reviewAssessment({ evidencePack: pack, assessment });
    };

    const result = await runS1aFixture({
      issueNumber: 74,
      reviewFn,
    });
    assert.equal(result.revised, true);
    assert.equal(calls, 2);
    assert.ok(
      result.reviewVerdict === REVIEW_VERDICT.ACCEPT ||
        result.labels.labels.includes(S1A_LABELS.EXPERT_FAILED) ||
        result.labels.labels.includes(S1A_LABELS.OWNER_REQUIRED),
    );
  });

  it("reviewer NEEDS_MORE_EVIDENCE → label needs-evidence", async () => {
    const { issue } = loadFixturePack();
    // Strip conflicted files + upstream from body to force evidence gap.
    const body = String(issue.body)
      .replace(/packages\/engine\/src\/executor\.ts/g, "")
      .replace(/lifecycle-column-census-baseline\.json/g, "")
      .replace(/71ba437cfe41cc6c05f6f80a31a46c53d5b59cd4/g, "");
    const thin = { ...issue, body, number: 74 };
    const labels = createMemoryLabelClient({
      74: ["appsolino-steward", S1A_LABELS.NEEDS_EXPERT],
    });
    const comments = createMemoryCommentClient();
    const result = await runS1a({
      repo: ALLOWED_REPO,
      issueNumber: 74,
      mode: "fixture",
      skipAuthorityGuard: true,
      issueOverride: thin,
      relatedPrOverride: null,
      clients: { labels, comments },
    });
    assert.equal(result.reviewVerdict, REVIEW_VERDICT.NEEDS_MORE_EVIDENCE);
    assert.ok(result.labels.labels.includes(S1A_LABELS.NEEDS_EVIDENCE));
  });
});

describe("S1A CRITICAL freeze", () => {
  it("CRITICAL → advice/freeze only (owner-required)", async () => {
    const { issue, relatedPr } = loadFixturePack();
    const body = String(issue.body).replace("| Terminal | CONFLICT |", "| Terminal | CRITICAL |");
    const labels = createMemoryLabelClient({
      74: ["appsolino-steward", S1A_LABELS.NEEDS_EXPERT],
    });
    const comments = createMemoryCommentClient();
    const result = await runS1a({
      repo: ALLOWED_REPO,
      issueNumber: 74,
      mode: "fixture",
      skipAuthorityGuard: true,
      issueOverride: { ...issue, body, number: 74 },
      relatedPrOverride: relatedPr,
      clients: { labels, comments },
    });
    assert.equal(result.assessment.risk, RISK_LEVEL.CRITICAL);
    assert.equal(result.assessment.criticalFreeze, true);
    assert.equal(result.assessment.repairRecommended, false);
    assert.ok(result.labels.labels.includes(S1A_LABELS.OWNER_REQUIRED));
    assert.ok(result.labels.labels.includes(S1A_LABELS.ADVICE_READY));
  });
});

describe("S1A provider/model + bounds", () => {
  it("provider/model reporting configured===actual", async () => {
    const result = await runS1aFixture({ issueNumber: 74 });
    assert.equal(result.configuredProvider, PINNED_PROVIDER);
    assert.equal(result.configuredModel, PINNED_MODEL);
    assert.equal(result.actualProvider, PINNED_PROVIDER);
    assert.equal(result.actualModel, PINNED_MODEL);
    assert.equal(result.bounds.maxAttempts, 2);
    assert.equal(result.bounds.maxRuntimeMs, 600_000);
    assert.equal(result.bounds.maxTokens, 0);
    assert.equal(result.bounds.assessmentVersion, 1);
  });

  it("cursor engine fails closed without API key (no silent fallback)", async () => {
    const prev = process.env.S1A_ENGINE;
    const prevKey = process.env.S1A_CURSOR_API_KEY;
    delete process.env.S1A_CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    process.env.S1A_ENGINE = "cursor";
    try {
      const { issue, relatedPr } = loadFixturePack();
      const pack = buildEvidencePack({ issue, relatedPr });
      await assert.rejects(() => runEngineer(pack), /refusing silent fallback|requires/);
    } finally {
      if (prev === undefined) delete process.env.S1A_ENGINE;
      else process.env.S1A_ENGINE = prev;
      if (prevKey !== undefined) process.env.S1A_CURSOR_API_KEY = prevKey;
    }
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
    const evidence = JSON.parse(readFileSync(join(FIX, "evidence.json"), "utf8"));
    const result = await runS1aFixture({ issueNumber: 74 });
    assert.equal(result.action, "assessed");
    assert.equal(result.assessment.risk, golden.riskExpected);
    assert.equal(result.assessment.risk, RISK_LEVEL.SENSITIVE);

    const kinds = result.assessment.files.map((f) => f.kind).sort();
    assert.deepEqual(kinds.sort(), [...golden.fileKinds].sort());

    const baseline = result.assessment.files.find((f) =>
      f.path.includes("lifecycle-column-census-baseline.json"),
    );
    const executor = result.assessment.files.find((f) => f.path.includes("executor.ts"));
    assert.equal(baseline.kind, "generated-baseline");
    assert.equal(baseline.playbook, "regeneration");
    assert.equal(executor.kind, "semantic-source");
    assert.equal(executor.playbook, "history-and-tests");

    const body = result.comment.action === "create"
      ? (await createMemoryCommentClient()).comments // placeholder
      : null;
    // Re-render for golden fragment checks
    const md = renderAssessmentMarkdown({
      evidencePack: result.evidencePack,
      assessment: result.assessment,
      review: { verdict: result.reviewVerdict, reason: result.reason },
      occurrence: evidence.occurrenceId,
    });
    for (const frag of golden.mustInclude) {
      assert.ok(md.includes(frag), `missing fragment: ${frag}`);
    }
    assert.equal(evidence.prUrl, "https://github.com/Appsolino/Fusion/pull/68");
    assert.ok(md.includes("pull/68"));
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
    assert.equal(
      classifyConflictFile("packages/core/src/other.ts").kind,
      "semantic-source",
    );
    assert.equal(
      classifyConflictFile(".github/workflows/upstream-auto1.yml").kind,
      "workflow",
    );
  });
});

describe("S0 optional handoff label", () => {
  it("default OFF; STEWARD_S0_HANDOFF_S1A=1 adds needs-expert", () => {
    const { normalized } = collectFromFixture(
      join(S0_FIXTURES, "auto1-upstream-merge-conflict-30805433281"),
    );
    const prev = process.env.STEWARD_S0_HANDOFF_S1A;
    try {
      delete process.env.STEWARD_S0_HANDOFF_S1A;
      const off = buildNewIssueContent(normalized);
      assert.ok(!off.labels.includes("steward/needs-expert"));

      process.env.STEWARD_S0_HANDOFF_S1A = "1";
      const on = buildNewIssueContent(normalized);
      assert.ok(on.labels.includes("steward/needs-expert"));
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
        number: 1,
        url: "https://example/pr/1",
        changedFiles: ["pnpm-lock.yaml"],
        touchesLockfile: true,
      },
    });
    // Even with only lockfile on PR (and conflict files from issue), risk sensitive
    const assessment = analyzeEvidence(pack);
    assert.equal(assessment.risk, RISK_LEVEL.SENSITIVE);
  });
});
