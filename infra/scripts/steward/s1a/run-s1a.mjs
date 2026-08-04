#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Fixture / test orchestrator: analyze (fixture engine) + optional in-memory upsert.
 * Live production path uses run-s1a-analyze.mjs + run-s1a-upsert.mjs separately.
 *
 *   node run-s1a.mjs --issue=74 --mode=fixture
 */
import { fileURLToPath } from "node:url";
import { runS1aAnalyze, loadFixturePack, parseAnalyzeArgs } from "./run-s1a-analyze.mjs";
import { runS1aUpsert } from "./run-s1a-upsert.mjs";
import { createMemoryLabelClient } from "./labels.mjs";
import { createMemoryCommentClient } from "./upsert-comment.mjs";
import { ALLOWED_REPO, S1A_LABELS, resolveEngineId } from "./policy.mjs";

export { loadFixturePack, parseAnalyzeArgs as parseArgs };
export { runS1aAnalyze } from "./run-s1a-analyze.mjs";
export { runS1aUpsert } from "./run-s1a-upsert.mjs";

/**
 * Combined fixture/test path with memory clients.
 * @param {{
 *   repo: string,
 *   issueNumber: number,
 *   mode: string,
 *   fixtureName?: string,
 *   startedAt?: number,
 *   clients: {
 *     getIssue?: Function,
 *     labels: import("./labels.mjs").LabelClient,
 *     comments: import("./upsert-comment.mjs").CommentClient,
 *     relatedPr?: Function,
 *     engineer?: Function,
 *     reviewFn?: Function,
 *     listComments?: Function,
 *     skipWorktree?: boolean,
 *     spawnReviewer?: boolean,
 *     spawnFn?: Function,
 *   },
 *   skipAuthorityGuard?: boolean,
 *   issueOverride?: object|null,
 *   relatedPrOverride?: object|null,
 *   skipUpsert?: boolean,
 * }} input
 */
export async function runS1a(input) {
  const mode = String(input.mode || "fixture").toLowerCase();
  if (mode === "live") {
    throw new Error(
      "runS1a combined path forbids mode=live; use run-s1a-analyze.mjs then run-s1a-upsert.mjs",
    );
  }

  const prevEngine = process.env.S1A_ENGINE;
  const prevMode = process.env.S1A_MODE;
  const prevProvider = process.env.S1A_PROVIDER;
  const prevModel = process.env.S1A_MODEL;
  process.env.S1A_MODE = mode;
  if (!process.env.S1A_ENGINE || process.env.S1A_ENGINE === "deterministic") {
    process.env.S1A_ENGINE = "fixture";
  }
  // Fixture pins (never report as live AI)
  process.env.S1A_PROVIDER = process.env.S1A_PROVIDER || "appsolino-s1a-fixture";
  process.env.S1A_MODEL = process.env.S1A_MODEL || "appsolino-s1a-fixture-v1";
  resolveEngineId(mode, process.env.S1A_ENGINE);

  try {
    /** @type {any} */
    let issue = input.issueOverride;
    if (!issue && (mode === "fixture" || mode === "fixture-replay")) {
      const pack = loadFixturePack(input.fixtureName || "issue-74-shaped");
      issue = { ...pack.issue, number: input.issueNumber || pack.issue.number };
    }

    const analyzed = await runS1aAnalyze({
      repo: input.repo,
      issueNumber: input.issueNumber,
      mode,
      fixtureName: input.fixtureName,
      startedAt: input.startedAt,
      skipAuthorityGuard: input.skipAuthorityGuard,
      issueOverride: issue || input.issueOverride,
      relatedPrOverride: input.relatedPrOverride,
      clients: {
        getIssue: input.clients?.getIssue,
        listComments:
          input.clients?.listComments ||
          (input.clients?.comments
            ? (n) => input.clients.comments.listComments(n)
            : undefined),
        labels: input.clients?.labels
          ? { getIssueLabels: (n) => input.clients.labels.getIssueLabels(n) }
          : undefined,
        engineer: input.clients?.engineer,
        reviewFn: input.clients?.reviewFn,
        spawnReviewer: input.clients?.spawnReviewer ?? false,
        spawnFn: input.clients?.spawnFn,
        skipWorktree: input.clients?.skipWorktree ?? true,
      },
    });

    if (analyzed.action !== "analyzed") {
      return analyzed;
    }

    if (input.skipUpsert) {
      return analyzed;
    }

    if (!input.clients?.labels || !input.clients?.comments) {
      throw new Error("runS1a upsert requires labels+comments clients");
    }

    const upserted = await runS1aUpsert({
      artifact: analyzed.artifact,
      repo: input.repo,
      expectMode: "fixture",
      skipAuthorityGuard: true,
      clients: {
        labels: input.clients.labels,
        comments: input.clients.comments,
        getIssue:
          input.clients.getIssue ||
          (async (n) => ({
            ...(issue || {}),
            number: n,
            state: (issue && issue.state) || "open",
            body: (issue && issue.body) || "",
            labels: await input.clients.labels.getIssueLabels(n),
          })),
      },
    });

    return {
      ok: true,
      action: "assessed",
      reason: analyzed.reason,
      reviewVerdict: analyzed.reviewVerdict,
      revised: analyzed.revised,
      comment: upserted.comment,
      labels: upserted.labels,
      assessment: analyzed.assessment,
      evidencePack: analyzed.evidencePack,
      configuredProvider: analyzed.configuredProvider,
      configuredModel: analyzed.configuredModel,
      actualProvider: analyzed.actualProvider,
      actualModel: analyzed.actualModel,
      bounds: analyzed.bounds,
      worktreePath: analyzed.worktreePath,
      engine: analyzed.engine,
      elapsedMs: analyzed.elapsedMs,
      artifact: analyzed.artifact,
    };
  } finally {
    if (prevEngine === undefined) delete process.env.S1A_ENGINE;
    else process.env.S1A_ENGINE = prevEngine;
    if (prevMode === undefined) delete process.env.S1A_MODE;
    else process.env.S1A_MODE = prevMode;
    if (prevProvider === undefined) delete process.env.S1A_PROVIDER;
    else process.env.S1A_PROVIDER = prevProvider;
    if (prevModel === undefined) delete process.env.S1A_MODEL;
    else process.env.S1A_MODEL = prevModel;
  }
}

/**
 * @param {{
 *   issueNumber?: number,
 *   fixtureName?: string,
 *   repo?: string,
 *   skipAuthorityGuard?: boolean,
 *   extraLabels?: string[],
 *   engineer?: Function,
 *   reviewFn?: Function,
 *   issueOverride?: object,
 * }} [opts]
 */
export async function runS1aFixture(opts = {}) {
  const fixture = loadFixturePack(opts.fixtureName || "issue-74-shaped");
  const issueNumber = opts.issueNumber || fixture.issue.number || 74;
  const baseLabels = [
    "appsolino-steward",
    S1A_LABELS.NEEDS_EXPERT,
    ...(opts.extraLabels || []),
  ];
  for (const l of fixture.issue.labels || []) {
    if (!baseLabels.includes(l) && !String(l).startsWith("steward/")) baseLabels.push(l);
  }
  const labels = createMemoryLabelClient({ [issueNumber]: baseLabels });
  const comments = createMemoryCommentClient();
  const issueOverride = opts.issueOverride || {
    ...fixture.issue,
    number: issueNumber,
    labels: baseLabels,
  };

  return runS1a({
    repo: opts.repo || ALLOWED_REPO,
    issueNumber,
    mode: "fixture",
    fixtureName: opts.fixtureName || "issue-74-shaped",
    skipAuthorityGuard: opts.skipAuthorityGuard !== false,
    issueOverride,
    relatedPrOverride: fixture.relatedPr,
    clients: {
      labels,
      comments,
      engineer: opts.engineer,
      reviewFn: opts.reviewFn,
      skipWorktree: true,
      spawnReviewer: false,
    },
  });
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = parseAnalyzeArgs(process.argv.slice(2));
  if (args.mode === "live") {
    console.error(
      "Use run-s1a-analyze.mjs --mode=live then run-s1a-upsert.mjs (trust zones)",
    );
    process.exit(2);
  }
  const result = await runS1aFixture({
    issueNumber: args.issue || 74,
    fixtureName: args.fixture || "issue-74-shaped",
    skipAuthorityGuard: false,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
