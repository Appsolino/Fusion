#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS3 2026-08-05:
 * SENSITIVE assist — dual Cursor APPROVE, writer exact-head merge when s3Enabled,
 * Appsolino + Host D only. Host P structurally prohibited.
 */
import {
  assertHostPForbidden,
  assertS3Pins,
  evaluateS3Eligibility,
  mapAuthorityToNeedsOwner,
  S3_MODEL,
  S3_PROVIDER,
} from "./policy.mjs";
import { assertRollbackPlanSafe, describeS3RollbackPath } from "./rollback.mjs";
import { assertNoXaiRequirement } from "../review/policy.mjs";

/**
 * @param {{
 *   prNumber: number,
 *   risk?: string,
 *   validationLevel: string,
 *   rollbackPlan?: string,
 *   previousMainSha?: string,
 *   hostDReleaseId?: string|null,
 *   deployedHostD?: boolean,
 *   hostP?: boolean,
 *   production?: boolean,
 *   destructiveData?: boolean,
 *   secretExpansion?: boolean,
 *   weakenControls?: boolean,
 *   authorityCheck?: object,
 *   dryRun?: boolean,
 *   merge?: boolean,
 *   s3GateEnabled?: boolean,
 *   activationOpts?: object,
 *   repository?: string,
 *   appToken?: string,
 *   artifact?: object,
 *   dualReviewFn?: (input: object) => Promise<object>|object,
 *   writerFn?: (input: object) => Promise<object>|object,
 *   expectHead?: string,
 *   nowMs?: number,
 *   missionExcerpt?: string,
 * }} input
 */
export async function runS3(input) {
  assertNoXaiRequirement();
  assertS3Pins({
    provider: process.env.S3_PROVIDER || S3_PROVIDER,
    model: process.env.S3_MODEL || S3_MODEL,
  });
  assertHostPForbidden({
    hostP: input.hostP,
    authorityCheck: input.authorityCheck,
  });

  const ownerStop = mapAuthorityToNeedsOwner(input.authorityCheck || {
    hostP: input.hostP,
    production: input.production,
    destructiveData: input.destructiveData,
    secretExpansion: input.secretExpansion,
  });
  if (ownerStop.verdict === "NEEDS_OWNER") {
    return {
      action: "needs-owner",
      phase: "S3",
      ownerStop,
      configuredProvider: S3_PROVIDER,
      configuredModel: S3_MODEL,
      merged: false,
      hostP: false,
      deployed: false,
    };
  }

  const rollback =
    input.rollbackPlan != null
      ? {
          rollbackPlan: assertRollbackPlanSafe(input.rollbackPlan),
          ...describeS3RollbackPath({
            previousMainSha: input.previousMainSha,
            prNumber: input.prNumber,
            hostDReleaseId: input.hostDReleaseId,
            deployedHostD: input.deployedHostD,
          }),
        }
      : describeS3RollbackPath({
          previousMainSha: input.previousMainSha,
          prNumber: input.prNumber,
          hostDReleaseId: input.hostDReleaseId,
          deployedHostD: input.deployedHostD,
        });

  const eligibility = evaluateS3Eligibility({
    risk: input.risk || "SENSITIVE",
    validationLevel: input.validationLevel,
    rollbackPlan: rollback.rollbackPlan,
    hostP: input.hostP === true,
    production: input.production === true,
    destructiveData: input.destructiveData === true,
    secretExpansion: input.secretExpansion === true,
    weakenControls: input.weakenControls === true,
    repository: input.repository,
    s3GateEnabled: input.s3GateEnabled,
    activationOpts: input.activationOpts,
  });

  if (!eligibility.eligible) {
    return {
      action: "skipped",
      phase: "S3",
      reasons: eligibility.reasons,
      eligibility,
      rollback,
      configuredProvider: S3_PROVIDER,
      configuredModel: S3_MODEL,
      merged: false,
      hostP: false,
      deployed: false,
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
      risk: "SENSITIVE",
      rollbackPlan: rollback.rollbackPlan,
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
      risk: "SENSITIVE",
      rollbackPlan: rollback.rollbackPlan,
      missionExcerpt: input.missionExcerpt || "S3 SENSITIVE assist",
      policyExcerpt:
        "S3: Appsolino + Host D only; Host P prohibited; validation B/C; rollback required.",
      merge: false,
      dryRun: true,
      appToken: input.appToken,
      activationOpts: input.activationOpts,
    });
  }

  if (dual) {
    if (dual.action === "reviewer-rejected" || dual.action === "approver-rejected") {
      return {
        action: dual.action,
        phase: "S3",
        dual,
        rollback,
        configuredProvider: S3_PROVIDER,
        configuredModel: S3_MODEL,
        merged: false,
        hostP: false,
        deployed: false,
      };
    }
    const compactOk =
      dual.reviewerVerdict === "APPROVE" && dual.approverVerdict === "APPROVE";
    const nestedOk =
      dual.reviewer?.verdict === "APPROVE" && dual.approver?.verdict === "APPROVE";
    const ready = dual.action === "approved-ready";
    if (!ready && !compactOk && !nestedOk && dual.reviewer) {
      return {
        action: "dual-not-approved",
        phase: "S3",
        dual,
        rollback,
        configuredProvider: S3_PROVIDER,
        configuredModel: S3_MODEL,
        merged: false,
        hostP: false,
        deployed: false,
      };
    }
  }

  if (dryRun || !wantMerge) {
    return {
      action: "planned",
      phase: "S3",
      eligibility,
      rollback,
      dual,
      nextSteps: [
        "level-b-or-c-validation",
        "cursor-reviewer-approve",
        "cursor-approver-approve",
        "writer-live-recompute-when-s3Enabled",
        "exact-head-merge-appsolino-main",
        "optional-auto3-host-d-deploy",
      ],
      writerMergeWired: true,
      configuredProvider: S3_PROVIDER,
      configuredModel: S3_MODEL,
      merged: false,
      hostP: false,
      deployed: false,
      note: "dry-run default; enable s3Enabled + merge:true for live writer exact-head merge",
    };
  }

  if (!input.artifact) {
    throw new Error("runS3 live merge requires artifact from dual Cursor APPROVE");
  }

  const writerInput = {
    prNumber: input.prNumber,
    risk: "SENSITIVE",
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
      phase: "S3",
      writer,
      dual,
      rollback,
      reasons: writer.reasons || [],
      configuredProvider: S3_PROVIDER,
      configuredModel: S3_MODEL,
      merged: false,
      hostP: false,
      deployed: false,
      writerRecomputed: writer.writerRecomputed === true,
    };
  }

  return {
    action: "merged",
    phase: "S3",
    writer,
    dual,
    rollback: {
      ...rollback,
      mergedHeadSha: writer.headSha,
      ...describeS3RollbackPath({
        previousMainSha: input.previousMainSha,
        mergedHeadSha: writer.headSha,
        prNumber: input.prNumber,
        hostDReleaseId: input.hostDReleaseId,
        deployedHostD: input.deployedHostD,
      }),
    },
    headSha: writer.headSha,
    configuredProvider: S3_PROVIDER,
    configuredModel: S3_MODEL,
    merged: true,
    hostP: false,
    deployed: false,
    writerRecomputed: true,
    writerMergeWired: true,
  };
}

const isMain =
  process.argv[1] &&
  String(process.argv[1]).endsWith("run-s3.mjs") &&
  import.meta.url.endsWith(
    String(process.argv[1]).replace(/\\/g, "/").split("/").pop(),
  );

if (isMain && process.argv.includes("--self-check")) {
  const r = await runS3({
    prNumber: 0,
    validationLevel: "B",
    rollbackPlan: "revert merge on Appsolino main; Host P prohibited",
    s3GateEnabled: false,
  });
  process.stdout.write(`${JSON.stringify(r)}\n`);
}
