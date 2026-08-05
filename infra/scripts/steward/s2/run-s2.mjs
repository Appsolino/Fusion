#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS2 2026-08-05:
 * LOW-risk auto-completion:
 * repair PR → required CI → dual Cursor APPROVE → writer live recompute →
 * exact-head merge → originating incident reconciliation.
 *
 * Default dry-run. Live merge requires s2Enabled gate. Never Host P.
 */
import { assertS2Pins, evaluateS2Eligibility, S2_MODEL, S2_PROVIDER } from "./policy.mjs";
import { assertPlaybookAllowlisted, describePlaybook } from "./playbooks.mjs";
import { evaluateS2LowRiskClassification } from "./classify-low.mjs";
import { reconcileOriginatingIncident } from "./reconcile-incident.mjs";
import { assertNoXaiRequirement } from "../review/policy.mjs";

/**
 * @param {{
 *   prNumber: number,
 *   issueNumber?: number,
 *   risk?: string,
 *   playbookId: string,
 *   paths?: string[],
 *   classifiedFiles?: object[],
 *   testsGreen?: boolean,
 *   hostP?: boolean,
 *   production?: boolean,
 *   fingerprint?: string,
 *   occurrence?: string,
 *   dependencyIntentUnchanged?: boolean,
 *   formatOnly?: boolean,
 *   workflowMetadataOnly?: boolean,
 *   dryRun?: boolean,
 *   merge?: boolean,
 *   s2GateEnabled?: boolean,
 *   activationOpts?: object,
 *   repository?: string,
 *   appToken?: string,
 *   artifact?: object,
 *   dualReviewFn?: (input: object) => Promise<object>|object,
 *   writerFn?: (input: object) => Promise<object>|object,
 *   reconcileFn?: (input: object) => object,
 *   expectHead?: string,
 *   nowMs?: number,
 * }} input
 */
export async function runS2(input) {
  assertNoXaiRequirement();
  assertS2Pins({
    provider: process.env.S2_PROVIDER || S2_PROVIDER,
    model: process.env.S2_MODEL || S2_MODEL,
  });
  assertPlaybookAllowlisted(input.playbookId);

  const classification = evaluateS2LowRiskClassification({
    playbookId: input.playbookId,
    paths: input.paths,
    classifiedFiles: input.classifiedFiles,
    dependencyIntentUnchanged: input.dependencyIntentUnchanged,
    formatOnly: input.formatOnly,
    workflowMetadataOnly: input.workflowMetadataOnly,
  });

  const eligibility = evaluateS2Eligibility({
    risk: input.risk || "LOW",
    testsGreen: input.testsGreen !== false,
    playbookId: input.playbookId,
    hostP: input.hostP === true,
    production: input.production === true,
    repository: input.repository,
    s2GateEnabled: input.s2GateEnabled,
    activationOpts: input.activationOpts,
  });

  if (!classification.ok) {
    return {
      action: "skipped",
      phase: "S2",
      reasons: classification.reasons,
      classification,
      eligibility,
      configuredProvider: S2_PROVIDER,
      configuredModel: S2_MODEL,
      merged: false,
      hostP: false,
    };
  }

  if (!eligibility.eligible) {
    return {
      action: "skipped",
      phase: "S2",
      reasons: eligibility.reasons,
      eligibility,
      classification,
      playbook: describePlaybook(input.playbookId, {
        conflictPaths: input.paths || [],
      }),
      configuredProvider: S2_PROVIDER,
      configuredModel: S2_MODEL,
      merged: false,
      hostP: false,
    };
  }

  const dryRun = input.dryRun !== false;
  const wantMerge = input.merge === true && !dryRun;

  /** @type {object|null} */
  let dual = null;
  if (typeof input.dualReviewFn === "function") {
    dual = await input.dualReviewFn({
      prNumber: input.prNumber,
      repository: input.repository,
      risk: "LOW",
      playbookId: input.playbookId,
      merge: false,
      dryRun: true,
      activationOpts: input.activationOpts,
      appToken: input.appToken,
    });
  } else if (!dryRun) {
    const { runDualCursorApproveMaybeMerge } = await import(
      "../review/run-dual-approve.mjs"
    );
    dual = await runDualCursorApproveMaybeMerge({
      prNumber: input.prNumber,
      repository: input.repository,
      risk: "LOW",
      rollbackPlan: `S2 playbook ${input.playbookId}: revert merge commit; regenerate from prior main tree.`,
      missionExcerpt: `S2 LOW auto-merge via ${input.playbookId}`,
      policyExcerpt: "S2 allowlisted playbooks only; no Host P.",
      merge: false,
      dryRun: true,
      appToken: input.appToken,
      activationOpts: input.activationOpts,
    });
  }

  if (dual) {
    const reviewerOk = dual.reviewer?.verdict === "APPROVE" || dual.action === "approved-ready";
    const approverOk =
      dual.approver?.verdict === "APPROVE" || dual.action === "approved-ready";
    if (dual.action === "reviewer-rejected" || dual.action === "approver-rejected") {
      return {
        action: dual.action,
        phase: "S2",
        dual,
        configuredProvider: S2_PROVIDER,
        configuredModel: S2_MODEL,
        merged: false,
        hostP: false,
      };
    }
    if (dual.action === "merge-blocked" && !reviewerOk) {
      return {
        action: "merge-blocked",
        phase: "S2",
        dual,
        reasons: dual.reasons || [],
        configuredProvider: S2_PROVIDER,
        configuredModel: S2_MODEL,
        merged: false,
        hostP: false,
      };
    }
    // When dual returns approved-ready / writer path, continue.
    if (
      dual.action &&
      !["approved-ready", "writer-ready", "merged"].includes(dual.action) &&
      !(reviewerOk && approverOk)
    ) {
      // If dualReviewFn returns a compact mock with verdicts:
      if (!(dual.reviewerVerdict === "APPROVE" && dual.approverVerdict === "APPROVE")) {
        if (dual.reviewer?.verdict && dual.approver?.verdict) {
          if (!reviewerOk || !approverOk) {
            return {
              action: "dual-not-approved",
              phase: "S2",
              dual,
              configuredProvider: S2_PROVIDER,
              configuredModel: S2_MODEL,
              merged: false,
              hostP: false,
            };
          }
        }
      }
    }
  }

  if (dryRun || !wantMerge) {
    const reconcilePlan =
      input.issueNumber != null
        ? reconcileOriginatingIncident({
            issueNumber: input.issueNumber,
            prNumber: input.prNumber,
            headSha: input.expectHead || "b".repeat(40),
            playbookId: input.playbookId,
            fingerprint: input.fingerprint,
            occurrence: input.occurrence,
            repository: input.repository,
            dryRun: true,
          })
        : null;
    return {
      action: "planned",
      phase: "S2",
      eligibility,
      classification,
      playbook: describePlaybook(input.playbookId, {
        conflictPaths: input.paths || [],
      }),
      dual,
      reconcilePlan,
      nextSteps: [
        "required-ci-green",
        "cursor-reviewer-approve",
        "cursor-approver-approve",
        "writer-live-recompute",
        "exact-head-merge",
        "originating-incident-reconcile",
      ],
      configuredProvider: S2_PROVIDER,
      configuredModel: S2_MODEL,
      merged: false,
      hostP: false,
      note: "dry-run default; enable s2Enabled + merge:true for live exact-head merge",
    };
  }

  if (!input.artifact) {
    throw new Error("runS2 live merge requires artifact from dual Cursor APPROVE");
  }

  const writerInput = {
    prNumber: input.prNumber,
    risk: "LOW",
    repository: input.repository,
    appToken: input.appToken,
    merge: true,
    dryRun: false,
    expectHead: input.expectHead,
    activationOpts: input.activationOpts,
    artifact: input.artifact,
    nowMs: input.nowMs,
  };

  const writer =
    typeof input.writerFn === "function"
      ? await input.writerFn(writerInput)
      : await (async () => {
          const { writerRevalidateAndMaybeMerge } = await import(
            "../review/writer.mjs"
          );
          return writerRevalidateAndMaybeMerge(writerInput);
        })();

  if (writer.action !== "merged") {
    return {
      action: writer.action || "merge-blocked",
      phase: "S2",
      writer,
      dual,
      reasons: writer.reasons || [],
      configuredProvider: S2_PROVIDER,
      configuredModel: S2_MODEL,
      merged: false,
      hostP: false,
      writerRecomputed: writer.writerRecomputed === true,
    };
  }

  /** @type {object|null} */
  let reconcile = null;
  if (input.issueNumber) {
    const reconcileInput = {
      issueNumber: input.issueNumber,
      prNumber: input.prNumber,
      headSha: writer.headSha,
      playbookId: input.playbookId,
      fingerprint: input.fingerprint,
      occurrence: input.occurrence,
      repository: input.repository,
      token: input.appToken,
      dryRun: false,
    };
    reconcile =
      typeof input.reconcileFn === "function"
        ? input.reconcileFn(reconcileInput)
        : reconcileOriginatingIncident(reconcileInput);
  }

  return {
    action: "merged",
    phase: "S2",
    writer,
    dual,
    reconcile,
    playbookId: input.playbookId,
    headSha: writer.headSha,
    configuredProvider: S2_PROVIDER,
    configuredModel: S2_MODEL,
    merged: true,
    hostP: false,
    writerRecomputed: true,
  };
}

const isMain =
  process.argv[1] &&
  String(process.argv[1]).endsWith("run-s2.mjs") &&
  import.meta.url.endsWith(
    String(process.argv[1]).replace(/\\/g, "/").split("/").pop(),
  );

if (isMain && process.argv.includes("--self-check")) {
  const r = await runS2({
    prNumber: 0,
    playbookId: "generated-baselines",
    paths: ["scripts/lib/lifecycle-column-census-baseline.json"],
    testsGreen: true,
    s2GateEnabled: false,
  });
  process.stdout.write(`${JSON.stringify(r)}\n`);
}
