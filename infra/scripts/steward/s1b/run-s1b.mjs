#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-04:
 * S1B repair-PR orchestration (plan → worktree → cursor repair → PR).
 * Default: dry-plan only. Live mutate requires s1bEnabled gate + App identity.
 * Never merges, never Host P, never self-approves.
 */
import { planS1bRepair } from "./plan-s1b.mjs";
import { S1B_MODEL, S1B_PROVIDER } from "./policy.mjs";

/**
 * @param {{
 *   issueNumber: number,
 *   occurrence: string,
 *   fingerprint: string,
 *   assessment: object,
 *   existingRepairPr?: number|null,
 *   dryRun?: boolean,
 * }} input
 */
export function runS1b(input) {
  const plan = planS1bRepair(input);
  if (!plan.ok) {
    return {
      action: "skipped",
      reasons: plan.eligibility.reasons,
      configuredProvider: S1B_PROVIDER,
      configuredModel: S1B_MODEL,
    };
  }
  if (input.dryRun !== false) {
    return {
      action: "planned",
      branchName: plan.eligibility.branchName,
      worktreePath: plan.eligibility.worktreePath,
      nextSteps: plan.nextSteps,
      configuredProvider: S1B_PROVIDER,
      configuredModel: S1B_MODEL,
      note: "dry-run default; enable gate + non-dry for live repair",
    };
  }
  return {
    action: "not-implemented-live",
    reasons: ["live-s1b-cursor-spawn deferred until Gate B proven + XAI merge path ready"],
    branchName: plan.eligibility.branchName,
    worktreePath: plan.eligibility.worktreePath,
    configuredProvider: S1B_PROVIDER,
    configuredModel: S1B_MODEL,
  };
}

const isMain =
  process.argv[1] &&
  String(process.argv[1]).endsWith("run-s1b.mjs") &&
  import.meta.url.endsWith(String(process.argv[1]).replace(/\\/g, "/").split("/").pop());

if (isMain && process.argv.includes("--self-check")) {
  const r = runS1b({
    issueNumber: 0,
    occurrence: "x",
    fingerprint: "a".repeat(64),
    assessment: { repairRecommended: true, reviewerVerdict: "ACCEPT", risk: "LOW" },
  });
  process.stdout.write(`${JSON.stringify(r)}\n`);
}
