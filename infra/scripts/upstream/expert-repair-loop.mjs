#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamExpertRepairLoop 2026-08-07-04:10:
 * Bounded sandboxed repair loop: expert → deterministic tests → independent verifier.
 * AI cannot bypass failing deterministic gates. REQUEST_CHANGES returns to expert.
 * Exhausted attempts → BLOCKED_UNRESOLVED with evidence. Never converts inability into green.
 *
 * FNXC:UpstreamAiProtocol 2026-08-07-08:50:
 * Malformed verifier JSON is AI_PROTOCOL_ERROR (not ENGINEERING_UNRESOLVED / BLOCKED_UNRESOLVED).
 * Verifier retries are owned by ai-verifier.mjs (bounded ≤3). Repair loop maps failureClass → next.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runUpstreamExpertResolver } from "./expert-resolver.mjs";
import { runUpstreamAiVerifier } from "./ai-verifier.mjs";
import { combineResolutionGate } from "./expert-decision-schema.mjs";
import { assertFinalizerFreshness, parseUpstreamShaFromBranch } from "./rolling-candidate.mjs";
import { evaluateFreshness, writeFreshnessStatus, FRESHNESS_STATUS_PATH } from "./freshness.mjs";
import { classifyAiFailure, nextFromAiFailureClass } from "./structured-json.mjs";

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
  /*
  FNXC:UpstreamAiProtocol 2026-08-07-12:15:
  Capture the worktree tip at loop start so verifier evidence includes ALL expert
  edits (committed + staged + unstaged). A bare `git diff` was often empty after
  the expert committed, which caused endless REQUEST_CHANGES on #135.
  */
  const startSha =
    input.evidence?.candidateHeadSha ||
    input.evidence?.candidateSha ||
    readGitHead(input.worktreePath) ||
    null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Race: upstream OR Appsolino main moved during repair → stop and refresh.
    if (typeof input.recheckUpstreamFn === "function" || typeof input.recheckAppsolinoMainFn === "function") {
      const live =
        typeof input.recheckUpstreamFn === "function" ? await input.recheckUpstreamFn() : input.evidence?.liveUpstreamHead;
      const liveMain =
        typeof input.recheckAppsolinoMainFn === "function"
          ? await input.recheckAppsolinoMainFn()
          : input.evidence?.liveAppsolinoMain;
      const cand =
        input.evidence?.candidateUpstreamSha ||
        parseUpstreamShaFromBranch(input.headRefName || "") ||
        null;
      const baseCand = input.evidence?.candidateBaseAppsolinoSha || null;
      if (live && cand) {
        const race = assertFinalizerFreshness({
          candidateUpstreamSha: cand,
          liveUpstreamHead: live,
          candidateBaseAppsolinoSha: baseCand,
          liveAppsolinoMain: liveMain,
        });
        if (!race.ok) {
          return {
            finalizable: false,
            next: "REFRESH_REQUIRED",
            reason: race.reason,
            mismatch: race.mismatch || null,
            attempts,
            liveUpstreamHead: live,
            candidateUpstreamSha: cand,
            liveAppsolinoMain: liveMain || null,
            candidateBaseAppsolinoSha: baseCand,
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
      const failureClass =
        expert.failureClass ||
        classifyAiFailure({ reason: expert.reason, action: expert.action, ok: false });
      attempts.push({
        attempt,
        phase: "expert",
        ok: false,
        reason: expert.reason,
        failureClass,
        provider: expert.configuredProvider,
        model: expert.configuredModel,
        actualProvider: expert.actualProvider,
        actualModel: expert.actualModel,
        latencyMs: expert.latencyMs,
      });
      if (typeof input.onAttempt === "function") input.onAttempt(attempts[attempts.length - 1]);
      return {
        finalizable: false,
        next: nextFromAiFailureClass(failureClass),
        failureClass,
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
        ? await input.getDiffText({
            attempt,
            worktreePath: input.worktreePath,
            startSha,
            expertDecision: expert.decision,
          })
        : collectExpertDiffEvidence(input.worktreePath, startSha);

    const candidateSha =
      input.evidence?.candidateHeadSha ||
      input.evidence?.candidateSha ||
      input.evidence?.headSha ||
      null;
    const upstreamSha =
      input.evidence?.candidateUpstreamSha ||
      input.evidence?.upstreamSha ||
      input.evidence?.upstreamHead ||
      null;
    const baseAppsolinoSha =
      input.evidence?.candidateBaseAppsolinoSha ||
      input.evidence?.baseAppsolinoSha ||
      input.evidence?.appsolinoBaseSha ||
      null;

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
        candidateSha,
        upstreamSha,
        baseAppsolinoSha,
      },
      requireShaBinding: Boolean(candidateSha && upstreamSha && baseAppsolinoSha),
    });
    lastVerifier = verifier;

    if (!verifier.ok || !verifier.verdict) {
      const failureClass =
        verifier.failureClass ||
        classifyAiFailure({ reason: verifier.reason, action: verifier.action, ok: false });
      attempts.push({
        attempt,
        phase: "verifier",
        ok: false,
        reason: verifier.reason,
        failureClass,
        expertDecision: expert.decision.decision,
        testsPassed: tests.passed,
        provider: verifier.configuredProvider,
        model: verifier.configuredModel,
        actualModel: verifier.actualModel,
        acceptedModel: verifier.acceptedModel || null,
        verifierAttempts: verifier.verifierAttempts || null,
        latencyMs: verifier.latencyMs,
      });
      if (typeof input.onAttempt === "function") input.onAttempt(attempts[attempts.length - 1]);
      return {
        finalizable: false,
        next: nextFromAiFailureClass(failureClass),
        failureClass,
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
      failureClass: gate.failureClass || null,
      expertDecision: expert.decision.decision,
      verifierVerdict: verifier.verdict.verdict,
      testsPassed: tests.passed,
      expertModel: expert.actualModel,
      verifierModel: verifier.actualModel,
      acceptedVerifierModel: verifier.acceptedModel || verifier.actualModel,
      verifierAttempts: verifier.verifierAttempts || null,
      expertLatencyMs: expert.latencyMs,
      verifierLatencyMs: verifier.latencyMs,
    });
    if (typeof input.onAttempt === "function") input.onAttempt(attempts[attempts.length - 1]);

    if (gate.finalizable) {
      /*
      FNXC:UpstreamRollingCandidate 2026-08-07-05:55:
      Re-check dual race immediately before declaring expert repair finalizable —
      Appsolino main or upstream may have moved during the expert/verifier round-trip.
      */
      if (typeof input.recheckUpstreamFn === "function" || typeof input.recheckAppsolinoMainFn === "function") {
        const live =
          typeof input.recheckUpstreamFn === "function" ? await input.recheckUpstreamFn() : input.evidence?.liveUpstreamHead;
        const liveMain =
          typeof input.recheckAppsolinoMainFn === "function"
            ? await input.recheckAppsolinoMainFn()
            : input.evidence?.liveAppsolinoMain;
        const cand =
          input.evidence?.candidateUpstreamSha ||
          parseUpstreamShaFromBranch(input.headRefName || "") ||
          null;
        const baseCand = input.evidence?.candidateBaseAppsolinoSha || null;
        if (live && cand) {
          const race = assertFinalizerFreshness({
            candidateUpstreamSha: cand,
            liveUpstreamHead: live,
            candidateBaseAppsolinoSha: baseCand,
            liveAppsolinoMain: liveMain,
          });
          if (!race.ok) {
            return {
              finalizable: false,
              next: "REFRESH_REQUIRED",
              reason: race.reason,
              mismatch: race.mismatch || null,
              attempts,
              liveUpstreamHead: live,
              candidateUpstreamSha: cand,
              liveAppsolinoMain: liveMain || null,
              candidateBaseAppsolinoSha: baseCand,
              expert: lastExpert,
              verifier: lastVerifier,
            };
          }
        }
      }

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
function readGitHead(worktreePath) {
  if (!worktreePath || !existsSync(worktreePath)) return null;
  const r = spawnSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], { encoding: "utf8" });
  return r.status === 0 ? String(r.stdout || "").trim().toLowerCase() : null;
}

/**
 * Collect verifier-visible evidence of expert edits.
 * Prefer range-from-start + dirty tree; never silently present an empty package when
 * the expert claimed filesChanged.
 *
 * @param {string} worktreePath
 * @param {string|null} startSha
 */
export function collectExpertDiffEvidence(worktreePath, startSha = null) {
  if (!worktreePath || !existsSync(worktreePath)) return "";
  const parts = [];
  const status = spawnSync("git", ["-C", worktreePath, "status", "--porcelain", "-uall"], {
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
  });
  if (status.status === 0 && status.stdout.trim()) {
    parts.push("## git status --porcelain\n" + status.stdout.trim());
  }
  const unstaged = spawnSync("git", ["-C", worktreePath, "diff", "--binary"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (unstaged.status === 0 && unstaged.stdout.trim()) {
    parts.push("## git diff (unstaged)\n" + unstaged.stdout.trim());
  }
  const staged = spawnSync("git", ["-C", worktreePath, "diff", "--cached", "--binary"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (staged.status === 0 && staged.stdout.trim()) {
    parts.push("## git diff --cached (staged)\n" + staged.stdout.trim());
  }
  if (startSha && /^[0-9a-f]{7,40}$/i.test(startSha)) {
    const range = spawnSync(
      "git",
      ["-C", worktreePath, "diff", "--binary", `${startSha}...HEAD`],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
    if (range.status === 0 && range.stdout.trim()) {
      parts.push(`## git diff ${startSha.slice(0, 12)}...HEAD\n` + range.stdout.trim());
    }
    const log = spawnSync(
      "git",
      ["-C", worktreePath, "log", "--oneline", `${startSha}..HEAD`],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
    );
    if (log.status === 0 && log.stdout.trim()) {
      parts.push("## git log since start\n" + log.stdout.trim());
    }
  }
  const joined = parts.join("\n\n");
  return joined.slice(0, 120_000);
}

/**
 * @param {string} worktreePath
 * @deprecated use collectExpertDiffEvidence
 */
function gitDiff(worktreePath) {
  return collectExpertDiffEvidence(worktreePath, null);
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
          failureClass: result.verifier.failureClass || null,
          reason: result.verifier.reason,
          verdict: result.verifier.verdict,
          configuredProvider: result.verifier.configuredProvider,
          configuredModel: result.verifier.configuredModel,
          actualProvider: result.verifier.actualProvider,
          actualModel: result.verifier.actualModel,
          acceptedModel: result.verifier.acceptedModel || result.verifier.actualModel || null,
          verifierAttempts: result.verifier.verifierAttempts || null,
          latencyMs: result.verifier.latencyMs,
          schemaVersion: result.verifier.schemaVersion,
          role: result.verifier.role,
          testInjection: result.verifier.testInjection || false,
        }
      : null,
    failureClass: result.failureClass || null,
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
