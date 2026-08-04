#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Write-only upsert job — download validated assessment artifact → comment + labels.
 * Must NOT import or call engineer / reviewer / cursor-engine / fixture-engine.
 *
 *   node run-s1a-upsert.mjs --artifact=assessment-artifact.json --repo=Appsolino/Fusion
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateAssessmentArtifact } from "./assessment-artifact.mjs";
import { upsertAssessmentComment, findAssessmentComment } from "./upsert-comment.mjs";
import { applyLabelTransition, planLabelTransition } from "./labels.mjs";
import { guardAuthorityOrThrow } from "./guard-authority.mjs";
import { buildEvidencePack } from "./evidence-pack.mjs";
import { extractFingerprintFromIssueBody } from "../policy.mjs";
import {
  ALLOWED_REPO,
  REVIEW_VERDICT,
  STEWARD_ISSUE_LABEL,
  assertRepoAllowed,
} from "./policy.mjs";

/**
 * @param {string[]} argv
 */
export function parseUpsertArgs(argv) {
  /** @type {{ artifact?: string, repo: string, expectMode?: string }} */
  const out = { repo: ALLOWED_REPO, expectMode: "live" };
  for (const a of argv) {
    if (a.startsWith("--artifact=")) out.artifact = a.slice("--artifact=".length);
    else if (a.startsWith("--repo=")) out.repo = a.slice("--repo=".length);
    else if (a.startsWith("--expect-mode=")) out.expectMode = a.slice("--expect-mode=".length);
  }
  return out;
}

/**
 * Re-fetch current issue state and refuse stale/mismatched artifacts.
 * @param {{
 *   artifact: object,
 *   repo: string,
 *   getIssue: (n: number) => Promise<object>,
 *   listComments: (n: number) => Promise<object[]>,
 * }} input
 */
export async function revalidateIssueForUpsert(input) {
  const art = input.artifact;
  const issue = await input.getIssue(art.issueNumber);
  if (!issue) {
    throw new Error("writer revalidate: issue missing");
  }
  if (String(issue.state || "").toLowerCase() !== "open") {
    throw new Error("writer revalidate: issue is not open");
  }
  const labels = (issue.labels || []).map((l) =>
    typeof l === "string" ? l : l?.name,
  );
  if (!labels.includes(STEWARD_ISSUE_LABEL)) {
    throw new Error("writer revalidate: missing appsolino-steward label");
  }
  const liveFp = extractFingerprintFromIssueBody(issue.body || "");
  if (!liveFp || liveFp.toLowerCase() !== String(art.fingerprint).toLowerCase()) {
    throw new Error(
      `writer revalidate: fingerprint mismatch (live=${liveFp || "null"} artifact=${art.fingerprint})`,
    );
  }
  const pack = buildEvidencePack({ issue });
  const latest =
    pack.latestOccurrenceId || pack.occurrenceIds[0] || `issue:${issue.number}`;
  if (String(latest).trim() !== String(art.occurrence).trim()) {
    throw new Error(
      `writer revalidate: occurrence mismatch (live=${latest} artifact=${art.occurrence})`,
    );
  }
  const comments = await input.listComments(art.issueNumber);
  const existing = findAssessmentComment(comments, art.fingerprint, art.occurrence);
  if (existing && !art.revised) {
    throw new Error(
      "writer revalidate: assessment already posted for fingerprint+occurrence",
    );
  }
  if (String(input.repo) !== String(art.repo)) {
    throw new Error(
      `writer revalidate: repository mismatch (${input.repo} vs ${art.repo})`,
    );
  }
  return {
    ok: true,
    fingerprint: liveFp,
    occurrence: latest,
    labels,
  };
}

/**
 * @param {{
 *   artifact: object,
 *   repo?: string,
 *   expectMode?: string,
 *   clients: {
 *     labels: import("./labels.mjs").LabelClient,
 *     comments: import("./upsert-comment.mjs").CommentClient,
 *     getIssue?: (n: number) => Promise<object>,
 *   },
 *   skipAuthorityGuard?: boolean,
 *   skipIssueRevalidate?: boolean,
 * }} input
 */
export async function runS1aUpsert(input) {
  if (!input.skipAuthorityGuard) {
    guardAuthorityOrThrow();
  }
  const repo = assertRepoAllowed(input.repo || input.artifact?.repo || ALLOWED_REPO);
  const art = validateAssessmentArtifact(input.artifact, {
    expectMode: input.expectMode || input.artifact?.mode || "live",
  });
  if (art.repo !== repo) {
    throw new Error(`artifact repo ${art.repo} !== ${repo}`);
  }
  if (!input.clients?.labels || !input.clients?.comments) {
    throw new Error("runS1aUpsert requires clients.labels and clients.comments");
  }

  if (!input.skipIssueRevalidate) {
    const getIssue =
      input.clients.getIssue ||
      (async (n) => {
        // Prefer labels client living issue fetch if provided separately later.
        throw new Error("writer revalidate requires clients.getIssue");
      });
    await revalidateIssueForUpsert({
      artifact: art,
      repo,
      getIssue,
      listComments: (n) => input.clients.comments.listComments(n),
    });
  }

  // Brief expert-running then settle to terminal labels.
  try {
    await input.clients.labels.addLabels(art.issueNumber, ["steward/expert-running"]);
  } catch {
    /* best effort */
  }

  try {
    const commentResult = await upsertAssessmentComment(input.clients.comments, {
      issueNumber: art.issueNumber,
      fingerprint: art.fingerprint,
      occurrence: art.occurrence,
      body: art.markdown,
      forceRevision: art.revised,
    });

    const failed =
      art.reviewer?.verdict === REVIEW_VERDICT.REJECT && art.revised;
    const labelPlan = planLabelTransition({
      reviewVerdict: art.reviewer?.verdict,
      assessment: art.assessment,
      failed,
    });
    const labels = await applyLabelTransition(
      input.clients.labels,
      art.issueNumber,
      labelPlan,
    );

    return {
      ok: true,
      action: "upserted",
      comment: commentResult,
      labels,
      issueNumber: art.issueNumber,
      fingerprint: art.fingerprint,
      occurrence: art.occurrence,
      configuredProvider: art.configuredProvider,
      configuredModel: art.configuredModel,
      actualProvider: art.actualProvider,
      actualModel: art.actualModel,
      engine: art.engine,
    };
  } catch (err) {
    try {
      const failPlan = planLabelTransition({
        reviewVerdict: REVIEW_VERDICT.REJECT,
        assessment: { criticalFreeze: false, repairRecommended: false },
        failed: true,
      });
      await applyLabelTransition(input.clients.labels, art.issueNumber, failPlan);
    } catch {
      /* best effort */
    }
    throw err;
  }
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = parseUpsertArgs(process.argv.slice(2));
  if (!args.artifact) {
    console.error("requires --artifact=path");
    process.exit(2);
  }
  const artifact = JSON.parse(readFileSync(args.artifact, "utf8"));
  const { createLiveWriteClients, createLiveReadClients } = await import("./live-clients.mjs");
  const write = createLiveWriteClients({ repo: args.repo });
  const read = createLiveReadClients({ repo: args.repo });
  const result = await runS1aUpsert({
    artifact,
    repo: args.repo,
    expectMode: args.expectMode || "live",
    clients: {
      labels: write.labels,
      comments: write.comments,
      getIssue: (n) => read.getIssue(n),
    },
    skipAuthorityGuard: false,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
