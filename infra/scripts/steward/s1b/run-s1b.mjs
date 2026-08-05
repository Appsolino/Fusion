#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-05:
 * S1B repair-PR orchestration (plan → worktree → cursor repair → tests → PR → dual review).
 * Default: dry-plan only. Live mutate requires s1bEnabled gate + App identity.
 * Never merges, never Host P, never self-approves, never deploys.
 */
import { spawnSync } from "node:child_process";
import { planS1bRepair } from "./plan-s1b.mjs";
import {
  ALLOWED_REPO,
  assertS1bAppToken,
  assertS1bPins,
  S1B_MODEL,
  S1B_PROVIDER,
} from "./policy.mjs";
import {
  assertPrimaryCheckoutUnchanged,
  commitRepairChanges,
  createS1bRepairWorktree,
  removeRepairWorktree,
} from "./worktree.mjs";
import { runCursorRepairEngine } from "./cursor-repair-engine.mjs";
import { createOrReuseRepairPr, pushRepairBranch } from "./push-pr.mjs";
import { clearRepairRegistry, lookupRepair, registerRepair } from "./lock.mjs";
import { guardS1bAuthorityOrThrow } from "./guard-authority.mjs";

export { clearRepairRegistry };

/**
 * @param {{
 *   issueNumber: number,
 *   occurrence: string,
 *   fingerprint: string,
 *   assessment: object,
 *   existingRepairPr?: number|null,
 *   dryRun?: boolean,
 *   repoRoot?: string,
 *   worktreePath?: string,
 *   baseRef?: string,
 *   repo?: string,
 *   activationOpts?: object,
 *   s1bGateEnabled?: boolean,
 *   skipAuthorityGuard?: boolean,
 *   cleanup?: boolean,
 *   spawnFn?: Function,
 *   cursorEngine?: Function,
 *   testFn?: (input: object) => Promise<object>|object,
 *   gitPushFn?: Function,
 *   gh?: Function,
 *   dualReviewFn?: (input: object) => Promise<object>|object,
 *   skipDualReview?: boolean,
 *   token?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} input
 */
export async function runS1b(input) {
  assertS1bPins({
    provider: process.env.S1B_PROVIDER || S1B_PROVIDER,
    model: process.env.S1B_MODEL || S1B_MODEL,
  });

  if (!input.skipAuthorityGuard) {
    guardS1bAuthorityOrThrow();
  }

  const plan = planS1bRepair(input);
  if (!plan.ok) {
    return {
      action: "skipped",
      reasons: plan.eligibility.reasons,
      configuredProvider: S1B_PROVIDER,
      configuredModel: S1B_MODEL,
      merged: false,
      deployed: false,
      hostP: false,
    };
  }

  if (input.dryRun !== false) {
    return {
      action: "planned",
      branchName: plan.eligibility.branchName,
      worktreePath: input.worktreePath || plan.eligibility.worktreePath,
      nextSteps: plan.nextSteps,
      configuredProvider: S1B_PROVIDER,
      configuredModel: S1B_MODEL,
      merged: false,
      deployed: false,
      hostP: false,
      note: "dry-run default; enable gate + non-dry for live repair",
    };
  }

  // Duplicate trigger (same fingerprint+occurrence already repaired this process).
  const prior = lookupRepair(input.fingerprint, input.occurrence);
  if (prior.entry) {
    return {
      action: "noop-duplicate",
      reasons: ["repair-already-exists"],
      branchName: prior.entry.branchName,
      prNumber: prior.entry.prNumber,
      prUrl: prior.entry.prUrl,
      repairHeadSha: prior.entry.repairHeadSha,
      configuredProvider: S1B_PROVIDER,
      configuredModel: S1B_MODEL,
      merged: false,
      deployed: false,
      hostP: false,
      occurrenceKey: prior.key,
    };
  }

  const env = input.env || process.env;
  assertS1bAppToken(env);

  const repoRoot = input.repoRoot;
  if (!repoRoot) {
    throw new Error("runS1b live path requires repoRoot");
  }

  const branchName = plan.eligibility.branchName;
  const worktreePath = input.worktreePath || plan.eligibility.worktreePath;
  /** @type {ReturnType<typeof createS1bRepairWorktree>|null} */
  let wt = null;
  /** @type {string|null} */
  let repairHeadSha = null;

  try {
    wt = createS1bRepairWorktree({
      repoRoot,
      worktreePath,
      branchName,
      baseRef: input.baseRef || "HEAD",
      worktreeRoot: input.worktreePath ? undefined : undefined,
    });

    const repair =
      typeof input.cursorEngine === "function"
        ? await input.cursorEngine({
            assessment: input.assessment,
            issueNumber: input.issueNumber,
            fingerprint: input.fingerprint,
            occurrence: input.occurrence,
            worktreePath: wt.path,
            spawnFn: input.spawnFn,
          })
        : await runCursorRepairEngine({
            assessment: input.assessment,
            issueNumber: input.issueNumber,
            fingerprint: input.fingerprint,
            occurrence: input.occurrence,
            worktreePath: wt.path,
            spawnFn: input.spawnFn,
            engine: undefined,
          });

    if (repair.actualModel && repair.actualModel !== S1B_MODEL) {
      throw new Error(
        `S1B model drift after repair: expected ${S1B_MODEL} got ${repair.actualModel}`,
      );
    }

    const testResult =
      typeof input.testFn === "function"
        ? await input.testFn({
            worktreePath: wt.path,
            assessment: input.assessment,
            repair,
          })
        : { ok: true, skipped: true, reason: "no-testFn" };
    if (testResult && testResult.ok === false) {
      throw new Error(
        `S1B repair tests failed: ${testResult.reason || JSON.stringify(testResult)}`,
      );
    }

    const committed = commitRepairChanges({
      worktreePath: wt.path,
      message: `fix(steward): S1B repair for issue #${input.issueNumber} (${String(input.fingerprint).slice(0, 12)})`,
    });
    repairHeadSha = committed.head;

    assertPrimaryCheckoutUnchanged({
      repoRoot,
      before: wt.primaryBefore,
    });

    pushRepairBranch({
      worktreePath: wt.path,
      branchName,
      token: input.token,
      env,
      gitPushFn: input.gitPushFn,
    });

    const pr = createOrReuseRepairPr({
      branchName,
      issueNumber: input.issueNumber,
      fingerprint: input.fingerprint,
      occurrence: input.occurrence,
      assessment: input.assessment,
      repairHeadSha,
      repairSummary: repair.summary,
      repo: input.repo || ALLOWED_REPO,
      token: input.token,
      env,
      gh: input.gh,
    });

    registerRepair({
      fingerprint: input.fingerprint,
      occurrence: input.occurrence,
      prNumber: pr.prNumber,
      prUrl: pr.prUrl,
      branchName,
      repairHeadSha: pr.headSha || repairHeadSha,
      issueNumber: input.issueNumber,
    });

    /** @type {object|null} */
    let dualReview = null;
    if (!input.skipDualReview) {
      const dualInput = {
        prNumber: pr.prNumber,
        repository: input.repo || ALLOWED_REPO,
        risk: String(input.assessment?.risk || "SENSITIVE"),
        rollbackPlan: "Revert repair PR via exact-head rollback; no Host P.",
        missionExcerpt: String(input.assessment?.summary || "S1B repair"),
        policyExcerpt: "S1B opens repair PR only; merge requires s2/s3 gates.",
        merge: false,
        dryRun: true,
        appToken: input.token || assertS1bAppToken(env),
      };
      if (typeof input.dualReviewFn === "function") {
        dualReview = await input.dualReviewFn(dualInput);
      } else {
        const { runDualCursorApproveMaybeMerge } = await import(
          "../review/run-dual-approve.mjs"
        );
        dualReview = await runDualCursorApproveMaybeMerge(dualInput);
      }
      if (dualReview && dualReview.merged === true) {
        throw new Error("S1B fail-closed: dual review must not merge");
      }
    }

    assertPrimaryCheckoutUnchanged({
      repoRoot,
      before: wt.primaryBefore,
    });

    return {
      action: pr.reused ? "repair-pr-reused" : "repair-pr-opened",
      branchName,
      worktreePath: wt.path,
      prNumber: pr.prNumber,
      prUrl: pr.prUrl,
      repairHeadSha: pr.headSha || repairHeadSha,
      repairSummary: repair.summary,
      testResult,
      dualReview,
      configuredProvider: S1B_PROVIDER,
      configuredModel: S1B_MODEL,
      actualProvider: repair.actualProvider || S1B_PROVIDER,
      actualModel: repair.actualModel || S1B_MODEL,
      childEnvKeys: repair.childEnvKeys || [],
      merged: false,
      mergeAuthorized: false,
      deployed: false,
      hostP: false,
      primaryCheckoutMutated: false,
      occurrenceKey: prior.key,
    };
  } finally {
    if (input.cleanup !== false && wt?.path) {
      removeRepairWorktree({
        path: wt.path,
        repoRoot,
        failClosed: true,
      });
      // Drop local branch leftover after worktree removal.
      spawnSync(
        "git",
        ["-c", "safe.directory=*", "branch", "-D", branchName],
        { cwd: repoRoot, encoding: "utf8" },
      );
    }
  }
}

const isMain =
  process.argv[1] &&
  String(process.argv[1]).endsWith("run-s1b.mjs") &&
  import.meta.url.endsWith(
    String(process.argv[1]).replace(/\\/g, "/").split("/").pop(),
  );

if (isMain && process.argv.includes("--self-check")) {
  const r = await runS1b({
    issueNumber: 0,
    occurrence: "x",
    fingerprint: "a".repeat(64),
    assessment: {
      repairRecommended: true,
      reviewerVerdict: "ACCEPT",
      risk: "LOW",
    },
    skipAuthorityGuard: true,
  });
  process.stdout.write(`${JSON.stringify(r)}\n`);
}
