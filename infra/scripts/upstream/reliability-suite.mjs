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

/*
FNXC:FusionReliabilitySuite 2026-08-07-04:24:
Schema v2 hardens the truthfulness guard. v1 only rewrote a SUCCESS when `mandatoryFinalFailed === true`, so a false SUCCESS was recordable three ways, all confirmed by probe: omit the flag entirely, set it to a truthy non-boolean (`"yes"`), or record a run with no level/repo/sha/evidence at all. All three were summarized as passes with `falseSuccessIncidents: 0`.
v2 inverts the burden of proof: SUCCESS is only preserved when the record carries POSITIVE evidence that every mandatory final actually succeeded. Absence of evidence is never treated as success, because the mission's whole claim is "no false SUCCESS".
*/
export const RELIABILITY_SUITE_SCHEMA_VERSION = 2;
export const RELIABILITY_DIR = ".appsolino/reliability";

/**
 * Terminal statuses a challenge run may claim.
 * `CRITICAL_FALSE_SUCCESS_PREVENTED` is written by the guard, never by a caller.
 */
export const TERMINAL_STATUSES = Object.freeze([
  "SUCCESS",
  "FAILED",
  "BLOCKED",
  "BLOCKED_UNRESOLVED",
  "CRITICAL_FALSE_SUCCESS_PREVENTED",
]);

/**
 * Model/provider identifiers that denote a scripted, non-AI executor.
 * A run driven by one of these exercises the harness, never the agent, so it can never
 * satisfy a level. Governance: "mock execution presented as real-provider proof" is blocking.
 */
export const FIXTURE_AGENT_MARKERS = Object.freeze([
  "deterministic-fixture-agent",
  "deterministic-independent-reviewer",
  "fixture-reviewer-v1",
  "mock",
  "scripted",
]);

/**
 * True when a run was driven by a scripted/fixture executor rather than a real model.
 * @param {object} run
 */
export function isFixtureDrivenRun(run) {
  const candidates = [
    run.agentModel,
    run.actualModel,
    run.actualProvider,
    run.independentReview?.model,
    run.independentReview?.provider,
  ].filter((v) => typeof v === "string");
  return candidates.some((v) => FIXTURE_AGENT_MARKERS.some((m) => v.toLowerCase().includes(m)));
}

/** Fields every run record must carry before it can count as Part B evidence. */
export const REQUIRED_RUN_FIELDS = Object.freeze([
  "taskId",
  "level",
  "repo",
  "requestedBehavior",
  "finalStatus",
]);

/**
 * Extra fields a SUCCESS claim must carry. A SUCCESS with any of these missing is
 * unprovable and is downgraded rather than trusted.
 */
export const REQUIRED_SUCCESS_FIELDS = Object.freeze([
  "startingSha",
  "finalSha",
  "mandatoryFinals",
  "configuredModel",
  "actualModel",
]);

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
 * Normalize the legacy `mandatoryFinalFailed` flag.
 * v1 compared with `=== true`, so `"yes"`/`1` slipped through as a pass. Any truthy
 * value is now a self-reported failure; only an explicit `false`/absent value is not.
 * @param {unknown} value
 */
export function isMandatoryFinalFailed(value) {
  if (value === false || value === undefined || value === null) return false;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v !== "" && v !== "false" && v !== "no" && v !== "0";
  }
  return Boolean(value);
}

/**
 * Decide whether a SUCCESS claim is actually PROVEN.
 * Fail-closed: every mandatory final must be present and explicitly passed. A run that
 * simply forgot to report its finals is unprovable, not successful.
 * @param {object} run
 * @returns {{ proven: boolean, reasons: string[] }}
 */
export function evaluateSuccessProof(run) {
  const reasons = [];
  if (isMandatoryFinalFailed(run.mandatoryFinalFailed)) {
    reasons.push("run self-reports mandatoryFinalFailed");
  }
  for (const field of REQUIRED_SUCCESS_FIELDS) {
    const value = run[field];
    if (value === undefined || value === null || value === "") {
      reasons.push(`missing SUCCESS evidence field: ${field}`);
    }
  }
  const finals = run.mandatoryFinals;
  if (finals !== undefined && finals !== null) {
    const entries = Array.isArray(finals) ? finals : Object.entries(finals).map(([name, v]) => ({ name, ...(typeof v === "object" && v !== null ? v : { passed: v }) }));
    if (entries.length === 0) {
      reasons.push("mandatoryFinals is empty — nothing was actually verified");
    }
    for (const entry of entries) {
      const name = String(entry?.name ?? "unnamed-final");
      if (entry?.passed !== true) {
        reasons.push(`mandatory final not explicitly passed: ${name}`);
      }
      // A final that claims a pass without an exit code / command never really ran.
      if (entry?.passed === true && entry.exitCode !== undefined && Number(entry.exitCode) !== 0) {
        reasons.push(`mandatory final ${name} claims pass with nonzero exitCode ${entry.exitCode}`);
      }
    }
  }
  /*
  FNXC:FusionReliabilitySuite 2026-08-07-04:24:
  Provider truthfulness (governance): a live run must record configured AND actual model, and a
  mismatch is blocking. A synthetic/mock run may never be summarized as live Part B evidence.
  */
  if (run.configuredModel && run.actualModel && run.configuredModel !== run.actualModel) {
    reasons.push(`provider/model mismatch: configured ${run.configuredModel} vs actual ${run.actualModel}`);
  }
  if (run.synthetic === true || run.testInjection === true || isFixtureDrivenRun(run)) {
    reasons.push("synthetic/fixture/mock execution cannot be recorded as SUCCESS evidence");
  }
  return { proven: reasons.length === 0, reasons };
}

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

  // Structural validation — an incomplete record is marked INVALID so it can never be
  // silently counted as an attempt that proves anything.
  const missing = REQUIRED_RUN_FIELDS.filter((f) => payload[f] === undefined || payload[f] === null || payload[f] === "");
  payload.schemaValid = missing.length === 0;
  if (missing.length > 0) {
    payload.schemaViolations = missing.map((f) => `missing required field: ${f}`);
  }
  if (payload.finalStatus !== undefined && !TERMINAL_STATUSES.includes(String(payload.finalStatus))) {
    payload.schemaValid = false;
    payload.schemaViolations = [...(payload.schemaViolations || []), `unknown finalStatus: ${payload.finalStatus}`];
  }

  if (String(payload.finalStatus) === "SUCCESS") {
    const proof = evaluateSuccessProof(payload);
    if (!proof.proven) {
      payload.finalStatus = "CRITICAL_FALSE_SUCCESS_PREVENTED";
      payload.truthfulnessViolationCaught = true;
      payload.truthfulnessViolationReasons = proof.reasons;
      payload.claimedStatus = "SUCCESS";
    } else {
      payload.successProven = true;
    }
  }

  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

/**
 * @param {string} repoRoot
 */
export function summarizeReliabilitySuite(repoRoot) {
  const dir = join(repoRoot, RELIABILITY_DIR, "runs");
  const empty = {
    attempted: 0,
    passed: 0,
    recovered: 0,
    truthfullyBlocked: 0,
    falseSuccessIncidents: 0,
    schemaInvalid: 0,
    syntheticExcluded: 0,
    unprovenSuccessClaims: 0,
    unprovenSuccessTaskIds: [],
    fixtureDrivenClaims: 0,
    fixtureDrivenTaskIds: [],
    humanInterventions: 0,
    levelsProvenByRealRun: [],
    levelsUnproven: CHALLENGE_CATALOG.map((c) => c.level),
    partBClaimable: false,
    criticalDefects: [],
    highDefects: [],
    runs: [],
  };
  if (!existsSync(dir)) return empty;

  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

  /*
  FNXC:FusionReliabilitySuite 2026-08-07-04:24:
  Synthetic/injected runs are retained on disk as guard fixtures but MUST be excluded from the
  evidence counters. v1 counted them as `attempted`, which inflated the suite with runs that
  exercised no real git/test command — the "mock execution presented as real proof" failure.
  */
  const synthetic = all.filter((r) => r.synthetic === true || r.testInjection === true || String(r.repo) === "synthetic");
  const runs = all.filter((r) => !synthetic.includes(r));

  const realPassed = runs.filter((r) => r.finalStatus === "SUCCESS" && r.successProven === true);
  /*
  FNXC:FusionReliabilitySuite 2026-08-07-04:24:
  A legacy (schemaVersion 1) record on disk can still read `finalStatus: "SUCCESS"` without ever
  having been proof-checked, and fixture-driven runs claim SUCCESS with a scripted executor. Both are
  silently uncounted by `passed`, which is not enough — an unproven claim must be LOUD, or a reader
  mistakes the per-run listing for evidence. These two counters are the alarm.
  */
  const unprovenSuccessClaims = runs.filter((r) => String(r.finalStatus) === "SUCCESS" && r.successProven !== true);
  const fixtureDrivenClaims = runs.filter((r) => isFixtureDrivenRun(r));
  const levelsProven = [...new Set(realPassed.map((r) => Number(r.level)).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  const catalogLevels = CHALLENGE_CATALOG.map((c) => c.level);

  return {
    attempted: runs.length,
    passed: realPassed.length,
    recovered: runs.filter((r) => r.recoveredAfterFailure === true).length,
    truthfullyBlocked: runs.filter((r) =>
      ["BLOCKED", "BLOCKED_UNRESOLVED", "FAILED"].includes(String(r.finalStatus)),
    ).length,
    falseSuccessIncidents: all.filter((r) => r.truthfulnessViolationCaught === true).length,
    schemaInvalid: runs.filter((r) => r.schemaValid === false).length,
    syntheticExcluded: synthetic.length,
    unprovenSuccessClaims: unprovenSuccessClaims.length,
    unprovenSuccessTaskIds: unprovenSuccessClaims.map((r) => r.taskId || r.id),
    fixtureDrivenClaims: fixtureDrivenClaims.length,
    fixtureDrivenTaskIds: fixtureDrivenClaims.map((r) => r.taskId || r.id),
    // The mission claim is "completes work without routine operator intervention", so the
    // intervention count is a headline metric, not a footnote.
    humanInterventions: runs.reduce((sum, r) => sum + (Number(r.humanInterventions) || 0), 0),
    levelsProvenByRealRun: levelsProven,
    levelsUnproven: catalogLevels.filter((l) => !levelsProven.includes(l)),
    // Part B cannot be claimed while any catalog level lacks a proven real run.
    partBClaimable: catalogLevels.every((l) => levelsProven.includes(l)),
    criticalDefects: runs.flatMap((r) => r.criticalDefects || []),
    highDefects: runs.flatMap((r) => r.highDefects || []),
    runs: runs.map((r) => ({
      taskId: r.taskId || r.id,
      level: r.level,
      finalStatus: r.finalStatus,
      reason: r.reason,
      schemaValid: r.schemaValid,
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
  /*
  FNXC:FusionReliabilitySuite 2026-08-07-04:24:
  These two records are GUARD FIXTURES, not Part B evidence. `synthetic: true` is mandatory so
  summarizeReliabilitySuite excludes them from every evidence counter and from level coverage.
  */
  recordChallengeRun(root, {
    taskId: "REL-TRUTH-GUARD",
    level: 0,
    repo: "synthetic",
    synthetic: true,
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
    synthetic: true,
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
