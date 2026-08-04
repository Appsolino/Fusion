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
import { upsertAssessmentComment } from "./upsert-comment.mjs";
import { applyLabelTransition, planLabelTransition } from "./labels.mjs";
import { guardAuthorityOrThrow } from "./guard-authority.mjs";
import {
  ALLOWED_REPO,
  REVIEW_VERDICT,
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
 * @param {{
 *   artifact: object,
 *   repo?: string,
 *   expectMode?: string,
 *   clients: {
 *     labels: import("./labels.mjs").LabelClient,
 *     comments: import("./upsert-comment.mjs").CommentClient,
 *   },
 *   skipAuthorityGuard?: boolean,
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
  const { createLiveWriteClients } = await import("./live-clients.mjs");
  const clients = createLiveWriteClients({ repo: args.repo });
  const result = await runS1aUpsert({
    artifact,
    repo: args.repo,
    expectMode: args.expectMode || "live",
    clients,
    skipAuthorityGuard: false,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
