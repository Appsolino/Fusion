#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:FusionReliabilitySuite 2026-08-07-04:55:
 * Brownfield reliability challenge definitions for Fusion execution-plane trust.
 * Records truthful outcomes only — SUCCESS requires mandatory finals actually succeeding.
 * Host P prohibited. Prefer isolated Host D / disposable repos for live runs.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const RELIABILITY_SUITE_SCHEMA_VERSION = 1;
export const RELIABILITY_DIR = ".appsolino/reliability";

/** @type {Array<{id:string,level:number,title:string,goal:string,successCriteria:string[],recoverableFailures:string[]}>} */
export const CHALLENGE_CATALOG = [
  {
    id: "REL-L1-SMALL-BUG",
    level: 1,
    title: "Small deterministic bug fix",
    goal: "Fix a single known failing assertion with a minimal code change",
    successCriteria: ["targeted test green", "no false SUCCESS if push/PR fails"],
    recoverableFailures: ["lint", "typecheck"],
  },
  {
    id: "REL-L2-CROSS-FILE",
    level: 2,
    title: "Cross-file bug with regression test",
    goal: "Fix behavior spanning two modules and add regression",
    successCriteria: ["new regression fails before fix", "passes after", "PR created"],
    recoverableFailures: ["test fail from incomplete fix"],
  },
  {
    id: "REL-L3-ARCHITECTURE",
    level: 3,
    title: "Feature requiring architecture understanding",
    goal: "Implement a small feature consistent with existing patterns",
    successCriteria: ["independent review APPROVE or REQUEST_CHANGES loop bounded", "tests green"],
    recoverableFailures: ["review REQUEST_CHANGES"],
  },
  {
    id: "REL-L4-FAILING-PLUS-FEATURE",
    level: 4,
    title: "Existing failing tests plus feature",
    goal: "Stabilize failing suite then add feature",
    successCriteria: ["pre-existing failures addressed", "feature tests green"],
    recoverableFailures: ["bootstrap", "flaky quarantine policy"],
  },
  {
    id: "REL-L5-MERGE-CONFLICT",
    level: 5,
    title: "Merge/rebase conflict during execution",
    goal: "Recover from mid-task branch divergence",
    successCriteria: ["conflict resolved or BLOCKED_UNRESOLVED with evidence", "never false SUCCESS"],
    recoverableFailures: ["merge conflict"],
  },
  {
    id: "REL-L6-EXTERNAL-REVIEW",
    level: 6,
    title: "External review requests changes",
    goal: "Address independent reviewer findings",
    successCriteria: ["repair loop", "final deterministic verification"],
    recoverableFailures: ["REQUEST_CHANGES"],
  },
  {
    id: "REL-L7-BOOTSTRAP",
    level: 7,
    title: "Dependency/bootstrap ambiguity",
    goal: "Detect and resolve project bootstrap without owner babysitting",
    successCriteria: ["environment derived or precise actionable failure"],
    recoverableFailures: ["missing package manager", "python vs python3"],
  },
  {
    id: "REL-L8-REDESIGN",
    level: 8,
    title: "First approach fails; redesign",
    goal: "Abandon failing approach and complete via redesign",
    successCriteria: ["recovery attempts recorded", "truthful terminal"],
    recoverableFailures: ["design dead-end"],
  },
  {
    id: "REL-L9-INTERRUPT-RESUME",
    level: 9,
    title: "Interrupted long-running task resumed",
    goal: "Resume after process interrupt without losing work",
    successCriteria: ["resume preserves progress", "no duplicate destructive actions"],
    recoverableFailures: ["process kill"],
  },
  {
    id: "REL-L10-BROWNFIELD-MULTI",
    level: 10,
    title: "Complex brownfield multi-subsystem task",
    goal: "Complete or truthfully block a multi-subsystem change on a real repo",
    successCriteria: ["audit trail complete", "independent review", "no false SUCCESS"],
    recoverableFailures: ["partial implementation"],
  },
];

/**
 * @param {string} repoRoot
 * @param {object} run
 */
export function recordChallengeRun(repoRoot, run) {
  const dir = join(repoRoot, RELIABILITY_DIR, "runs");
  mkdirSync(dir, { recursive: true });
  const id = String(run.taskId || run.id || `run-${Date.now()}`);
  const path = join(dir, `${id}.json`);
  const payload = {
    schemaVersion: RELIABILITY_SUITE_SCHEMA_VERSION,
    ...run,
    recordedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  if (payload.finalStatus === "SUCCESS" && payload.mandatoryFinalFailed === true) {
    payload.finalStatus = "CRITICAL_FALSE_SUCCESS_PREVENTED";
    payload.truthfulnessViolationCaught = true;
  }
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

/**
 * @param {string} repoRoot
 */
export function summarizeReliabilitySuite(repoRoot) {
  const dir = join(repoRoot, RELIABILITY_DIR, "runs");
  if (!existsSync(dir)) {
    return {
      attempted: 0,
      passed: 0,
      recovered: 0,
      truthfullyBlocked: 0,
      falseSuccessIncidents: 0,
      criticalDefects: [],
      highDefects: [],
      runs: [],
    };
  }
  const runs = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  return {
    attempted: runs.length,
    passed: runs.filter((r) => r.finalStatus === "SUCCESS").length,
    recovered: runs.filter((r) => r.recoveredAfterFailure === true).length,
    truthfullyBlocked: runs.filter((r) =>
      ["BLOCKED", "BLOCKED_UNRESOLVED", "FAILED"].includes(String(r.finalStatus)),
    ).length,
    falseSuccessIncidents: runs.filter((r) => r.truthfulnessViolationCaught === true).length,
    criticalDefects: runs.flatMap((r) => r.criticalDefects || []),
    highDefects: runs.flatMap((r) => r.highDefects || []),
    runs: runs.map((r) => ({
      taskId: r.taskId || r.id,
      level: r.level,
      finalStatus: r.finalStatus,
      reason: r.reason,
    })),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  mkdirSync(join(root, RELIABILITY_DIR), { recursive: true });
  writeFileSync(
    join(root, RELIABILITY_DIR, "catalog.json"),
    `${JSON.stringify({ schemaVersion: RELIABILITY_SUITE_SCHEMA_VERSION, challenges: CHALLENGE_CATALOG }, null, 2)}\n`,
  );
  recordChallengeRun(root, {
    taskId: "REL-TRUTH-GUARD",
    level: 0,
    repo: "synthetic",
    startingSha: null,
    requestedBehavior: "ensure false SUCCESS cannot be recorded when mandatoryFinalFailed",
    finalStatus: "SUCCESS",
    mandatoryFinalFailed: true,
    reason: "synthetic guard",
  });
  // L1 synthetic: demonstrate truthful block when tests fail
  recordChallengeRun(root, {
    taskId: "REL-L1-SYNTHETIC-TRUTHFUL-BLOCK",
    level: 1,
    repo: "synthetic",
    startingSha: null,
    requestedBehavior: "small bug fix",
    finalStatus: "FAILED",
    mandatoryFinalFailed: true,
    reason: "targeted test remained red — truthful failure",
    recoveredAfterFailure: false,
  });
  const summary = summarizeReliabilitySuite(root);
  process.stdout.write(`${JSON.stringify({ catalog: CHALLENGE_CATALOG.length, summary }, null, 2)}\n`);
}
