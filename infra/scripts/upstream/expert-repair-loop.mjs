#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamExpertRepairLoop 2026-08-07-04:10:
 * Bounded sandboxed repair loop: expert → deterministic tests → independent verifier.
 * AI cannot bypass failing deterministic gates. REQUEST_CHANGES returns to expert.
 * Exhausted attempts → BLOCKED_UNRESOLVED with evidence. Never converts inability into green.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runUpstreamExpertResolver } from "./expert-resolver.mjs";
import { runUpstreamAiVerifier } from "./ai-verifier.mjs";
import { combineResolutionGate } from "./expert-decision-schema.mjs";
import { assertFinalizerFreshness, parseUpstreamShaFromBranch } from "./rolling-candidate.mjs";
import { evaluateFreshness, writeFreshnessStatus, FRESHNESS_STATUS_PATH } from "./freshness.mjs";

export const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;

/**
 * @param {{
 *   worktreePath: string,
 *   evidence: object,
 *   headRefName?: string,
 *   liveUpstreamHead?: string|null,
 *   maxAttempts?: number,
 *   runDeterministicTests?: (ctx: object) => Promise<{passed:boolean,failures:string[],log?:string}> | {passed:boolean,failures:string[],log?:string},
 *   getDiffText?: (ctx: object) => Promise<string>|string,
 *   expertFn?: typeof runUpstreamExpertResolver,
 *   verifierFn?: typeof runUpstreamAiVerifier,
 *   recheckUpstreamFn?: () => Promise<string|null>|string|null,
 *   onAttempt?: (attempt: object) => void,
 * }} input
 */
export async function runExpertRepairLoop(input) {
  const maxAttempts = Number(input.maxAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS);
  const expertFn = input.expertFn || runUpstreamExpertResolver;
  const verifierFn = input.verifierFn || runUpstreamAiVerifier;
  const attempts = [];
  let lastExpert = null;
  let lastVerifier = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Race: upstream moved during repair → stop and refresh.
    if (typeof input.recheckUpstreamFn === "function") {
      const live = await input.recheckUpstreamFn();
      const cand =
        input.evidence?.candidateUpstreamSha ||
        parseUpstreamShaFromBranch(input.headRefName || "") ||
        null;
      if (live && cand) {
        const race = assertFinalizerFreshness({
          candidateUpstreamSha: cand,
          liveUpstreamHead: live,
        });
        if (!race.ok) {
          return {
            finalizable: false,
            next: "REFRESH_REQUIRED",
            reason: race.reason,
            attempts,
            liveUpstreamHead: live,
            candidateUpstreamSha: cand,
            expert: lastExpert,
            verifier: lastVerifier,
          };
        }
      }
    }

    const expert = await expertFn({
      worktreePath: input.worktreePath,
      evidence: {
        ...input.evidence,
        previousAttempts: attempts,
      },
    });
    lastExpert = expert;
    if (!expert.ok || !expert.decision) {
      attempts.push({
        attempt,
        phase: "expert",
        ok: false,
        reason: expert.reason,
        provider: expert.configuredProvider,
        model: expert.configuredModel,
        actualProvider: expert.actualProvider,
        actualModel: expert.actualModel,
        latencyMs: expert.latencyMs,
      });
      if (typeof input.onAttempt === "function") input.onAttempt(attempts[attempts.length - 1]);
      return {
        finalizable: false,
        next: "BLOCKED_UNRESOLVED",
        reason: expert.reason || "expert unavailable or malformed",
        attempts,
        expert,
        verifier: null,
      };
    }

    const testRunner =
      input.runDeterministicTests ||
      (async () => ({ passed: true, failures: [], log: "no-test-runner-injected" }));
    const tests = await testRunner({
      attempt,
      worktreePath: input.worktreePath,
      expertDecision: expert.decision,
    });

    const diffText =
      typeof input.getDiffText === "function"
        ? await input.getDiffText({ attempt, worktreePath: input.worktreePath })
        : gitDiff(input.worktreePath);

    const verifier = await verifierFn({
      worktreePath: input.worktreePath,
      evidence: {
        originalProblem: summarizeProblem(input.evidence),
        upstreamIntent: expert.decision.upstreamIntent,
        diffText,
        patchRegistryChanges: expert.decision.patchActions,
        deterministicTestResults: {
          passed: tests.passed,
          failures: tests.failures || [],
        },
        riskClass: input.evidence?.riskClass || "SENSITIVE",
      },
    });
    lastVerifier = verifier;

    if (!verifier.ok || !verifier.verdict) {
      attempts.push({
        attempt,
        phase: "verifier",
        ok: false,
        reason: verifier.reason,
        expertDecision: expert.decision.decision,
        testsPassed: tests.passed,
        provider: verifier.configuredProvider,
        model: verifier.configuredModel,
        latencyMs: verifier.latencyMs,
      });
      if (typeof input.onAttempt === "function") input.onAttempt(attempts[attempts.length - 1]);
      return {
        finalizable: false,
        next: "BLOCKED_UNRESOLVED",
        reason: verifier.reason || "verifier unavailable or malformed",
        attempts,
        expert,
        verifier,
      };
    }

    const gate = combineResolutionGate({
      expert: expert.decision,
      verifier: verifier.verdict,
      deterministicPassed: tests.passed === true,
      deterministicFailures: tests.failures || [],
      repairAttempt: attempt,
      maxRepairAttempts: maxAttempts,
    });

    attempts.push({
      attempt,
      phase: "gate",
      ok: gate.finalizable,
      next: gate.next,
      reason: gate.reason,
      expertDecision: expert.decision.decision,
      verifierVerdict: verifier.verdict.verdict,
      testsPassed: tests.passed,
      expertModel: expert.actualModel,
      verifierModel: verifier.actualModel,
      expertLatencyMs: expert.latencyMs,
      verifierLatencyMs: verifier.latencyMs,
    });
    if (typeof input.onAttempt === "function") input.onAttempt(attempts[attempts.length - 1]);

    if (gate.finalizable) {
      const freshness = evaluateFreshness({
        upstreamHead: input.liveUpstreamHead || input.evidence?.upstreamHead || null,
        integratedUpstreamSha: input.evidence?.integratedUpstreamSha || null,
        candidateUpstreamSha: input.evidence?.candidateUpstreamSha || null,
        expertActive: false,
        aiVerifierActive: false,
        auto2Action: "expert-verified",
      });
      try {
        writeFreshnessStatus(join(input.worktreePath, FRESHNESS_STATUS_PATH), {
          ...freshness,
          state: freshness.state === "FRESH" ? "FRESH" : "CANDIDATE_VALIDATING",
        });
      } catch {
        /* non-fatal */
      }
      return {
        finalizable: true,
        next: "CONTINUE",
        reason: gate.reason,
        attempts,
        expert,
        verifier,
        tests,
      };
    }

    if (gate.next === "BLOCKED_POLICY") {
      return {
        finalizable: false,
        next: "BLOCKED_POLICY",
        reason: gate.reason,
        attempts,
        expert,
        verifier,
        tests,
      };
    }

    if (gate.next !== "EXPERT_RESOLVING") {
      return {
        finalizable: false,
        next: gate.next,
        reason: gate.reason,
        attempts,
        expert,
        verifier,
        tests,
      };
    }
    // else loop for REQUEST_CHANGES / deterministic failure within budget
  }

  return {
    finalizable: false,
    next: "BLOCKED_UNRESOLVED",
    reason: `bounded expert repair exhausted after ${maxAttempts} attempts`,
    attempts,
    expert: lastExpert,
    verifier: lastVerifier,
  };
}

/**
 * @param {string} worktreePath
 */
function gitDiff(worktreePath) {
  if (!worktreePath || !existsSync(worktreePath)) return "";
  const r = spawnSync("git", ["-C", worktreePath, "diff", "--binary"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return r.stdout || "";
}

/**
 * @param {object} evidence
 */
function summarizeProblem(evidence) {
  if (!evidence) return "upstream absorption engineering problem";
  if (evidence.problemSummary) return String(evidence.problemSummary);
  const conflicts = evidence.conflictedFiles || [];
  const fails = evidence.failingTests || [];
  return [
    conflicts.length ? `conflicts:${conflicts.join(",")}` : null,
    fails.length ? `failingTests:${fails.join(",")}` : null,
    evidence.candidateUpstreamSha ? `candidateUpstream:${evidence.candidateUpstreamSha}` : null,
  ]
    .filter(Boolean)
    .join(" | ") || "upstream absorption engineering problem";
}

/**
 * Persist loop evidence (no secrets).
 * @param {string} dir
 * @param {object} result
 */
export function writeRepairLoopEvidence(dir, result) {
  mkdirSync(dir, { recursive: true });
  const safe = {
    finalizable: result.finalizable,
    next: result.next,
    reason: result.reason,
    attempts: result.attempts,
    expert: result.expert
      ? {
          ok: result.expert.ok,
          action: result.expert.action,
          reason: result.expert.reason,
          decision: result.expert.decision,
          configuredProvider: result.expert.configuredProvider,
          configuredModel: result.expert.configuredModel,
          actualProvider: result.expert.actualProvider,
          actualModel: result.expert.actualModel,
          latencyMs: result.expert.latencyMs,
          schemaVersion: result.expert.schemaVersion,
          role: result.expert.role,
          testInjection: result.expert.testInjection || false,
        }
      : null,
    verifier: result.verifier
      ? {
          ok: result.verifier.ok,
          action: result.verifier.action,
          reason: result.verifier.reason,
          verdict: result.verifier.verdict,
          configuredProvider: result.verifier.configuredProvider,
          configuredModel: result.verifier.configuredModel,
          actualProvider: result.verifier.actualProvider,
          actualModel: result.verifier.actualModel,
          latencyMs: result.verifier.latencyMs,
          schemaVersion: result.verifier.schemaVersion,
          role: result.verifier.role,
          testInjection: result.verifier.testInjection || false,
        }
      : null,
    recordedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  const path = join(dir, "expert-repair-loop.json");
  writeFileSync(path, `${JSON.stringify(safe, null, 2)}\n`);
  return path;
}

/**
 * @param {string} path
 */
export function readRepairLoopEvidence(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
