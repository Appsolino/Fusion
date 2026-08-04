#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * CLI orchestrator for Steward S1A Expert Advisory Mode.
 *
 *   node run-s1a.mjs --issue=<n> --repo=Appsolino/Fusion --mode=fixture|live
 *
 * Steps: eligibility → lock → evidence → engineer → reviewer →
 *        (one revise if REJECT) → render → upsert comment → labels.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEligibility } from "./eligibility.mjs";
import { acquireLock, releaseLock } from "./lock.mjs";
import { buildEvidencePack } from "./evidence-pack.mjs";
import { runEngineer } from "./engineer.mjs";
import { runReviewer } from "./reviewer.mjs";
import { renderAssessmentMarkdown } from "./render-assessment.mjs";
import { upsertAssessmentComment } from "./upsert-comment.mjs";
import { applyLabelTransition, planLabelTransition, createMemoryLabelClient } from "./labels.mjs";
import { createMemoryCommentClient } from "./upsert-comment.mjs";
import { guardAuthorityOrThrow } from "./guard-authority.mjs";
import {
  ALLOWED_REPO,
  PINNED_MODEL,
  PINNED_PROVIDER,
  REVIEW_VERDICT,
  resolveWorktreePath,
  S1A_BOUNDS,
  S1A_LABELS,
} from "./policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{ issue?: number, repo: string, mode: string, fixture?: string }} */
  const out = { repo: ALLOWED_REPO, mode: "fixture" };
  for (const a of argv) {
    if (a.startsWith("--issue=")) out.issue = Number(a.slice("--issue=".length));
    else if (a.startsWith("--repo=")) out.repo = a.slice("--repo=".length);
    else if (a.startsWith("--mode=")) out.mode = a.slice("--mode=".length);
    else if (a.startsWith("--fixture=")) out.fixture = a.slice("--fixture=".length);
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
 * @param {{
 *   repo: string,
 *   issueNumber: number,
 *   mode: string,
 *   fixtureName?: string,
 *   startedAt?: number,
 *   clients: {
 *     getIssue?: (n: number) => Promise<object>,
 *     labels: import("./labels.mjs").LabelClient,
 *     comments: import("./upsert-comment.mjs").CommentClient,
 *     relatedPr?: (pack: object) => Promise<object|null>,
 *     engineer?: Function,
 *     reviewFn?: Function,
 *   },
 *   skipAuthorityGuard?: boolean,
 *   issueOverride?: object|null,
 *   relatedPrOverride?: object|null,
 * }} input
 */
export async function runS1a(input) {
  const startedAt = input.startedAt ?? Date.now();
  const configuredProvider = process.env.S1A_PROVIDER || PINNED_PROVIDER;
  const configuredModel = process.env.S1A_MODEL || PINNED_MODEL;

  if (!input.skipAuthorityGuard) {
    guardAuthorityOrThrow();
  }
  if (!input.clients?.labels || !input.clients?.comments) {
    throw new Error("runS1a requires clients.labels and clients.comments");
  }

  /** @type {any} */
  let issue;
  /** @type {any} */
  let relatedPr = input.relatedPrOverride ?? null;

  if (input.issueOverride) {
    issue = input.issueOverride;
  } else if (input.mode === "fixture" || input.mode === "fixture-replay") {
    const pack = loadFixturePack(input.fixtureName || "issue-74-shaped");
    issue = { ...pack.issue, number: input.issueNumber || pack.issue.number };
    if (!relatedPr) relatedPr = pack.relatedPr;
  } else {
    if (!input.clients.getIssue) throw new Error("live mode requires clients.getIssue");
    issue = await input.clients.getIssue(input.issueNumber);
  }

  // Prefer live label state when available (lock / re-entry).
  try {
    const liveLabels = await input.clients.labels.getIssueLabels(issue.number);
    if (liveLabels?.length) issue = { ...issue, labels: liveLabels };
  } catch {
    /* fixture may seed only via issue.labels */
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
    };
  }

  const evidencePackEarly = buildEvidencePack({
    issue,
    relatedPr,
    allowUnknownNullDefaults: true,
  });
  const occurrence =
    evidencePackEarly.latestOccurrenceId ||
    evidencePackEarly.occurrenceIds[0] ||
    `issue:${issue.number}`;

  const lock = await acquireLock(input.clients.labels, {
    issueNumber: issue.number,
    fingerprint: /** @type {string} */ (eligibility.fingerprint),
    occurrence,
  });
  if (!lock.acquired) {
    return {
      ok: true,
      action: "noop-lock",
      reason: lock.reason,
      configuredProvider,
      configuredModel,
      actualProvider: null,
      actualModel: null,
    };
  }

  try {
    if (Date.now() - startedAt > S1A_BOUNDS.maxRuntimeMs) {
      throw new Error("maxRuntimeMs exceeded before engineer");
    }

    if (input.mode === "live" && input.clients.relatedPr && !relatedPr) {
      relatedPr = await input.clients.relatedPr(evidencePackEarly);
    }

    const evidencePack = buildEvidencePack({
      issue,
      relatedPr,
      allowUnknownNullDefaults: true,
    });

    const engineerOpts = { attempt: 1 };
    let assessment = await runEngineer(evidencePack, {
      ...engineerOpts,
      engine: input.clients.engineer,
    });

    assertProviderMatch(assessment, configuredProvider, configuredModel);

    let review = await runReviewer({
      evidencePack,
      assessment,
      reviewFn: input.clients.reviewFn,
    });
    let revised = false;

    if (review.verdict === REVIEW_VERDICT.REJECT) {
      assessment = await runEngineer(evidencePack, {
        attempt: 2,
        priorRejection: { reason: review.reason },
        engine: input.clients.engineer,
      });
      assertProviderMatch(assessment, configuredProvider, configuredModel);
      review = await runReviewer({
        evidencePack,
        assessment,
        reviewFn: input.clients.reviewFn,
      });
      revised = true;
    }

    if (Date.now() - startedAt > S1A_BOUNDS.maxRuntimeMs) {
      throw new Error("maxRuntimeMs exceeded before render");
    }

    const worktreePath = resolveWorktreePath(issue.number);
    const body = renderAssessmentMarkdown({
      evidencePack,
      assessment,
      review,
      occurrence,
      worktreePath,
    });

    const commentResult = await upsertAssessmentComment(input.clients.comments, {
      issueNumber: issue.number,
      fingerprint: evidencePack.fingerprint,
      occurrence,
      body,
      forceRevision: revised,
    });

    const failed = review.verdict === REVIEW_VERDICT.REJECT && revised;
    const labelPlan = planLabelTransition({
      reviewVerdict: review.verdict,
      assessment,
      failed,
    });
    const labels = await applyLabelTransition(
      input.clients.labels,
      issue.number,
      labelPlan,
    );

    return {
      ok: true,
      action: "assessed",
      reason: review.reason,
      reviewVerdict: review.verdict,
      revised,
      comment: commentResult,
      labels,
      assessment,
      evidencePack,
      configuredProvider,
      configuredModel,
      actualProvider: assessment.actualProvider,
      actualModel: assessment.actualModel,
      bounds: S1A_BOUNDS,
      worktreePath,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    try {
      const failPlan = planLabelTransition({
        reviewVerdict: REVIEW_VERDICT.REJECT,
        assessment: { criticalFreeze: false, repairRecommended: false },
        failed: true,
      });
      await applyLabelTransition(input.clients.labels, issue.number, failPlan);
    } catch {
      /* best effort */
    }
    throw err;
  } finally {
    try {
      await releaseLock(input.clients.labels, {
        issueNumber: issue.number,
        fingerprint: /** @type {string} */ (eligibility.fingerprint),
        occurrence,
      });
    } catch {
      /* best effort */
    }
  }
}

/**
 * @param {import("./engineer.mjs").Assessment} assessment
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
  // Merge fixture labels that are not S1A transitions
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
    },
  });
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "live") {
    if (!args.issue) {
      console.error("live mode requires --issue=<n>");
      process.exit(2);
    }
    const { createLiveClients } = await import("./live-clients.mjs");
    const clients = createLiveClients({ repo: args.repo });
    const result = await runS1a({
      repo: args.repo,
      issueNumber: args.issue,
      mode: "live",
      clients,
      skipAuthorityGuard: false,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  const result = await runS1aFixture({
    issueNumber: args.issue || 74,
    fixtureName: args.fixture || "issue-74-shaped",
    skipAuthorityGuard: false,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
