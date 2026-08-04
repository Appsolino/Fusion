#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Read-only analyze job — eligibility, evidence, worktree, expert, reviewer, artifact.
 * Uses GITHUB_TOKEN read scopes only. No issues write. No upsert.
 *
 *   node run-s1a-analyze.mjs --issue=74 --repo=Appsolino/Fusion --mode=live|fixture --out=...
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEligibility } from "./eligibility.mjs";
import { buildEvidencePack, parseRunIdFromOccurrence } from "./evidence-pack.mjs";
import { runEngineer } from "./engineer.mjs";
import { runReviewer } from "./reviewer.mjs";
import { runReviewerProcess } from "./run-reviewer-process.mjs";
import { renderAssessmentMarkdown } from "./render-assessment.mjs";
import { buildAssessmentArtifact } from "./assessment-artifact.mjs";
import { guardAuthorityOrThrow } from "./guard-authority.mjs";
import { createRepairWorktree, removeRepairWorktree, collectConflictEvidence } from "./worktree.mjs";
import { findAssessmentComment } from "./upsert-comment.mjs";
import {
  ALLOWED_REPO,
  REVIEW_VERDICT,
  S1A_BOUNDS,
  S1A_LABELS,
  assertRepoAllowed,
  pinsForEngine,
  resolveEngineId,
  resolveWorktreePath,
} from "./policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @param {string[]} argv
 */
export function parseAnalyzeArgs(argv) {
  /** @type {{ issue?: number, repo: string, mode: string, fixture?: string, out?: string }} */
  const out = { repo: ALLOWED_REPO, mode: "fixture" };
  for (const a of argv) {
    if (a.startsWith("--issue=")) out.issue = Number(a.slice("--issue=".length));
    else if (a.startsWith("--repo=")) out.repo = a.slice("--repo=".length);
    else if (a.startsWith("--mode=")) out.mode = a.slice("--mode=".length);
    else if (a.startsWith("--fixture=")) out.fixture = a.slice("--fixture=".length);
    else if (a.startsWith("--out=")) out.out = a.slice("--out=".length);
  }
  return out;
}

/**
 * @param {string} [fixtureName]
 */
export function loadFixturePack(fixtureName = "issue-74-shaped") {
  const dir = join(HERE, "fixtures", fixtureName);
  const issue = JSON.parse(readFileSync(join(dir, "issue.json"), "utf8"));
  let relatedPr = null;
  const prPath = join(dir, "related-pr.json");
  if (existsSync(prPath)) relatedPr = JSON.parse(readFileSync(prPath, "utf8"));
  return { issue, relatedPr };
}

/**
 * @param {import("./fixture-engine.mjs").Assessment} assessment
 * @param {string} configuredProvider
 * @param {string} configuredModel
 */
function assertProviderMatch(assessment, configuredProvider, configuredModel) {
  if (
    assessment.configuredProvider !== assessment.actualProvider ||
    assessment.configuredModel !== assessment.actualModel
  ) {
    throw new Error("silent provider/model fallback forbidden");
  }
  if (
    assessment.actualProvider !== configuredProvider ||
    assessment.actualModel !== configuredModel
  ) {
    throw new Error(
      `provider/model drift: configured=${configuredProvider}/${configuredModel} ` +
        `actual=${assessment.actualProvider}/${assessment.actualModel}`,
    );
  }
}

/**
 * Read-only analyze orchestrator.
 * @param {{
 *   repo: string,
 *   issueNumber: number,
 *   mode: string,
 *   fixtureName?: string,
 *   outDir?: string|null,
 *   startedAt?: number,
 *   repoRoot?: string,
 *   skipAuthorityGuard?: boolean,
 *   issueOverride?: object|null,
 *   relatedPrOverride?: object|null,
 *   clients?: {
 *     getIssue?: Function,
 *     listComments?: Function,
 *     getRelatedPr?: Function,
 *     getWorkflowRunLogs?: Function,
 *     tryFetchAuto3Evidence?: Function,
 *     labels?: { getIssueLabels: Function },
 *     engineer?: Function,
 *     reviewFn?: Function,
 *     spawnReviewer?: boolean,
 *     spawnFn?: Function,
 *     skipWorktree?: boolean,
 *   },
 * }} input
 */
export async function runS1aAnalyze(input) {
  const startedAt = input.startedAt ?? Date.now();
  const mode = String(input.mode || "fixture").toLowerCase();
  assertRepoAllowed(input.repo);

  if (!input.skipAuthorityGuard) {
    guardAuthorityOrThrow();
  }

  const engineId = resolveEngineId(mode, process.env.S1A_ENGINE);
  const pins = pinsForEngine(engineId);
  const configuredProvider = process.env.S1A_PROVIDER || pins.provider;
  const configuredModel = process.env.S1A_MODEL || pins.model;

  // Live must not silently use fixture pins via env override tricks.
  if (mode === "live") {
    if (
      configuredProvider !== pins.provider ||
      configuredModel !== pins.model
    ) {
      throw new Error(
        `live provider/model must be ${pins.provider}/${pins.model} (got ${configuredProvider}/${configuredModel})`,
      );
    }
  }

  /** @type {any} */
  let issue;
  /** @type {any} */
  let relatedPr = input.relatedPrOverride ?? null;

  if (input.issueOverride) {
    issue = input.issueOverride;
  } else if (mode === "fixture" || mode === "fixture-replay") {
    const pack = loadFixturePack(input.fixtureName || "issue-74-shaped");
    issue = { ...pack.issue, number: input.issueNumber || pack.issue.number };
    if (!relatedPr) relatedPr = pack.relatedPr;
  } else {
    if (!input.clients?.getIssue) throw new Error("live mode requires clients.getIssue");
    issue = await input.clients.getIssue(input.issueNumber);
  }

  // Prefer live label state when readable.
  if (input.clients?.labels?.getIssueLabels) {
    try {
      const liveLabels = await input.clients.labels.getIssueLabels(issue.number);
      if (liveLabels?.length) issue = { ...issue, labels: liveLabels };
    } catch {
      /* ignore */
    }
  }

  const eligibility = checkEligibility({ repo: input.repo, issue });
  if (!eligibility.eligible) {
    return {
      ok: true,
      action: "skip",
      reason: eligibility.reason,
      configuredProvider,
      configuredModel,
      actualProvider: null,
      actualModel: null,
      engine: engineId,
    };
  }

  // Concurrent protection without write: expert-running present → no-op.
  const labels = eligibility.labels || [];
  if (labels.includes(S1A_LABELS.EXPERT_RUNNING)) {
    return {
      ok: true,
      action: "noop-lock",
      reason: "label-lock-held",
      configuredProvider,
      configuredModel,
      actualProvider: null,
      actualModel: null,
      engine: engineId,
    };
  }

  const evidencePackEarly = buildEvidencePack({ issue, relatedPr });
  const occurrence =
    evidencePackEarly.latestOccurrenceId ||
    evidencePackEarly.occurrenceIds[0] ||
    `issue:${issue.number}`;

  // Assessment idempotency via read comments (no write).
  if (input.clients?.listComments) {
    try {
      const comments = await input.clients.listComments(issue.number);
      const existing = findAssessmentComment(
        comments,
        /** @type {string} */ (eligibility.fingerprint),
        occurrence,
      );
      if (existing) {
        return {
          ok: true,
          action: "noop-already-assessed",
          reason: "assessment-exists-for-occurrence",
          configuredProvider,
          configuredModel,
          actualProvider: null,
          actualModel: null,
          engine: engineId,
        };
      }
    } catch {
      /* read failure — continue; upsert also idempotent */
    }
  }

  const repoRoot = input.repoRoot || process.cwd();
  let worktreePath = null;
  /** @type {{ path: string } | null} */
  let worktree = null;

  try {
    if (Date.now() - startedAt > S1A_BOUNDS.maxRuntimeMs) {
      throw new Error("maxRuntimeMs exceeded before engineer");
    }

    if (!input.clients?.skipWorktree) {
      try {
        worktree = createRepairWorktree({
          incidentId: issue.number,
          repoRoot,
          mode,
        });
        worktreePath = worktree.path;
      } catch (err) {
        if (mode === "live") throw err;
        // Fixture may run without a real git repo — fall back to path only.
        worktreePath = resolveWorktreePath(issue.number, { mode });
        mkdirSync(worktreePath, { recursive: true });
      }
    } else {
      worktreePath = resolveWorktreePath(issue.number, { mode });
    }

    if (mode === "live" && input.clients?.getRelatedPr && !relatedPr) {
      const url = evidencePackEarly.auto1.prUrl || "";
      const m = String(url).match(/\/pull\/(\d+)/);
      if (m) relatedPr = await input.clients.getRelatedPr(Number(m[1]));
    }

    let comments = null;
    if (input.clients?.listComments) {
      try {
        comments = (await input.clients.listComments(issue.number)).map((c) => ({
          id: c.id,
          user: c.user,
          bodyExcerpt: String(c.body || "").slice(0, 500),
        }));
      } catch {
        comments = null;
      }
    }

    let workflowLogs = null;
    const runId = parseRunIdFromOccurrence(occurrence);
    if (input.clients?.getWorkflowRunLogs && runId) {
      workflowLogs = await input.clients.getWorkflowRunLogs(runId);
    }

    let auto3Evidence = null;
    if (input.clients?.tryFetchAuto3Evidence) {
      auto3Evidence = await input.clients.tryFetchAuto3Evidence(evidencePackEarly);
    }

    let conflictFileSides = null;
    let gitPathLog = null;
    if (worktreePath && existsSync(worktreePath) && !input.clients?.skipWorktree) {
      try {
        const ce = collectConflictEvidence({
          worktreePath,
          files: evidencePackEarly.auto1.conflictedFiles || [],
          upstreamSha: evidencePackEarly.auto1.upstreamSha,
        });
        conflictFileSides = ce.conflictFileSides;
        gitPathLog = ce.pathLog;
      } catch {
        /* best effort */
      }
    }

    const evidencePack = buildEvidencePack({
      issue,
      relatedPr,
      comments,
      workflowLogs,
      conflictFileSides,
      gitPathLog,
      auto3Evidence,
      worktreePath,
    });

    // Persist evidence pack into worktree (no push).
    if (worktreePath) {
      mkdirSync(worktreePath, { recursive: true });
      writeFileSync(
        join(worktreePath, "evidence-pack.json"),
        JSON.stringify(evidencePack, null, 2),
      );
    }

    let assessment = await runEngineer(evidencePack, {
      attempt: 1,
      mode,
      engine: input.clients?.engineer,
      worktreePath,
    });
    assertProviderMatch(assessment, configuredProvider, configuredModel);

    const useProcess =
      input.clients?.spawnReviewer !== false &&
      !input.clients?.reviewFn &&
      mode === "live";

    let review = useProcess
      ? await runReviewerProcess({
          evidencePack,
          assessment,
          spawnFn: input.clients?.spawnFn,
        })
      : await runReviewer({
          evidencePack,
          assessment,
          reviewFn: input.clients?.reviewFn,
        });

    let revised = false;
    if (review.verdict === REVIEW_VERDICT.REJECT) {
      assessment = await runEngineer(evidencePack, {
        attempt: 2,
        priorRejection: { reason: review.reason },
        mode,
        engine: input.clients?.engineer,
        worktreePath,
      });
      assertProviderMatch(assessment, configuredProvider, configuredModel);
      review = useProcess
        ? await runReviewerProcess({
            evidencePack,
            assessment,
            spawnFn: input.clients?.spawnFn,
          })
        : await runReviewer({
            evidencePack,
            assessment,
            reviewFn: input.clients?.reviewFn,
          });
      revised = true;
    }

    if (Date.now() - startedAt > S1A_BOUNDS.maxRuntimeMs) {
      throw new Error("maxRuntimeMs exceeded before artifact");
    }

    const markdown = renderAssessmentMarkdown({
      evidencePack,
      assessment,
      review,
      occurrence,
      worktreePath,
    });

    const artifact = buildAssessmentArtifact({
      repo: input.repo,
      issueNumber: issue.number,
      fingerprint: evidencePack.fingerprint,
      occurrence,
      mode,
      engine: engineId,
      configuredProvider,
      configuredModel,
      actualProvider: assessment.actualProvider,
      actualModel: assessment.actualModel,
      assessment,
      reviewer: review,
      evidencePack,
      worktreePath,
      markdown,
      revised,
    });

    const outDir =
      input.outDir ||
      process.env.S1A_OUT_DIR ||
      (process.env.RUNNER_TEMP
        ? join(process.env.RUNNER_TEMP, "steward-s1a")
        : null);
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "assessment-artifact.json"), JSON.stringify(artifact, null, 2));
      writeFileSync(join(outDir, "assessment.md"), markdown);
    }

    return {
      ok: true,
      action: "analyzed",
      reason: review.reason,
      reviewVerdict: review.verdict,
      revised,
      assessment,
      evidencePack,
      reviewer: review,
      artifact,
      configuredProvider,
      configuredModel,
      actualProvider: assessment.actualProvider,
      actualModel: assessment.actualModel,
      engine: engineId,
      bounds: S1A_BOUNDS,
      worktreePath,
      outDir,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (worktree?.path) {
      try {
        removeRepairWorktree({ path: worktree.path, repoRoot });
      } catch {
        /* best effort */
      }
    }
  }
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = parseAnalyzeArgs(process.argv.slice(2));
  process.env.S1A_MODE = args.mode;
  if (args.mode === "live") {
    if (!args.issue) {
      console.error("live mode requires --issue=<n>");
      process.exit(2);
    }
    process.env.S1A_ENGINE = process.env.S1A_ENGINE || "cursor-cli";
    process.env.S1A_PROVIDER = process.env.S1A_PROVIDER || "cursor-cli";
    process.env.S1A_MODEL = process.env.S1A_MODEL || "composer-2.5";
    const { createLiveReadClients } = await import("./live-clients.mjs");
    const clients = createLiveReadClients({ repo: args.repo });
    const result = await runS1aAnalyze({
      repo: args.repo,
      issueNumber: args.issue,
      mode: "live",
      outDir: args.out || undefined,
      clients,
      skipAuthorityGuard: false,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  process.env.S1A_ENGINE = process.env.S1A_ENGINE || "fixture";
  const result = await runS1aAnalyze({
    repo: args.repo,
    issueNumber: args.issue || 74,
    mode: "fixture",
    fixtureName: args.fixture || "issue-74-shaped",
    outDir: args.out || undefined,
    skipAuthorityGuard: false,
    clients: { skipWorktree: true, spawnReviewer: false },
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
