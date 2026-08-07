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
 *
 * FNXC:UpstreamLatency 2026-08-07-14:15:
 * Total cycle wall-clock budget governs all nested child timeouts. Mid-flight stale
 * watchdog can abort expert/verifier. Same REQUEST_CHANGES + empty delta → NON_CONVERGING_LOOP.
 * Targeted requiredChanges are fed into the next expert prompt.
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
import { createCycleBudget } from "./cycle-budget.mjs";
import { createLatencyTracker } from "./latency-tracker.mjs";
import { startStaleWatchdog, staleAbortInfo } from "./stale-watchdog.mjs";
import {
  normalizeRequiredChangesSignature,
  detectNonConvergence,
  summarizePreviousAttempts,
  buildTargetedRepairInstructions,
  hasMeaningfulCandidateDelta,
} from "./repair-convergence.mjs";

export const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;

/**
 * @param {{
 *   worktreePath: string,
 *   evidence: object,
 *   headRefName?: string,
 *   liveUpstreamHead?: string|null,
 *   maxAttempts?: number,
 *   cycleBudget?: ReturnType<typeof createCycleBudget>|null,
 *   cycleBudgetMs?: number,
 *   latencyTracker?: ReturnType<typeof createLatencyTracker>|null,
 *   enableStaleWatchdog?: boolean,
 *   staleWatchdogIntervalMs?: number,
 *   runDeterministicTests?: (ctx: object) => Promise<{passed:boolean,failures:string[],log?:string}> | {passed:boolean,failures:string[],log?:string},
 *   getDiffText?: (ctx: object) => Promise<string>|string,
 *   expertFn?: typeof runUpstreamExpertResolver,
 *   verifierFn?: typeof runUpstreamAiVerifier,
 *   recheckUpstreamFn?: () => Promise<string|null>|string|null,
 *   recheckAppsolinoMainFn?: () => Promise<string|null>|string|null,
 *   onAttempt?: (attempt: object) => void,
 * }} input
 */
export async function runExpertRepairLoop(input) {
  const maxAttempts = Number(input.maxAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS);
  const expertFn = input.expertFn || runUpstreamExpertResolver;
  const verifierFn = input.verifierFn || runUpstreamAiVerifier;
  const budget = input.cycleBudget || createCycleBudget({ cycleBudgetMs: input.cycleBudgetMs });
  const tracker =
    input.latencyTracker ||
    createLatencyTracker({
      cycleBudget: budget,
      mode: "repair",
      candidateSha: input.evidence?.candidateHeadSha || input.evidence?.candidateSha || null,
      upstreamSha: input.evidence?.candidateUpstreamSha || null,
      appsolinoBaseSha: input.evidence?.candidateBaseAppsolinoSha || null,
    });
  tracker.startHeartbeat();
  const attempts = [];
  let lastExpert = null;
  let lastVerifier = null;
  let priorRequiredSignature = null;
  /*
  FNXC:UpstreamLatency 2026-08-07-17:40:
  Seed targeted repair from the prior SENSITIVE_REVIEW REQUEST_CHANGES package.
  Do not re-investigate accepted areas when requiredChanges are already known.
  */
  let openRequiredChanges = Array.isArray(input.initialRequiredChanges)
    ? input.initialRequiredChanges.map((x) => String(x)).filter(Boolean)
    : Array.isArray(input.evidence?.requiredChanges)
      ? input.evidence.requiredChanges.map((x) => String(x)).filter(Boolean)
      : [];
  let sameSignatureRepeats = 0;

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

  const candUpstream =
    input.evidence?.candidateUpstreamSha ||
    parseUpstreamShaFromBranch(input.headRefName || "") ||
    null;
  const baseCand = input.evidence?.candidateBaseAppsolinoSha || null;

  const watchdog =
    input.enableStaleWatchdog === false ||
    (typeof input.recheckUpstreamFn !== "function" && typeof input.recheckAppsolinoMainFn !== "function")
      ? null
      : startStaleWatchdog({
          intervalMs: input.staleWatchdogIntervalMs,
          candidateUpstreamSha: candUpstream,
          candidateBaseAppsolinoSha: baseCand,
          recheckUpstreamFn: input.recheckUpstreamFn,
          recheckAppsolinoMainFn: input.recheckAppsolinoMainFn,
          onStale: (info) => {
            tracker.classify(info.classification || "STALE_UPSTREAM");
          },
        });

  const abortSignal = watchdog?.signal || null;

  /** @returns {object|null} */
  function refreshIfStaleOrBudget() {
    const exhausted = budget.assertNotExhausted();
    if (!exhausted.ok) {
      tracker.classify("LATENCY_BUDGET_EXHAUSTED");
      return {
        finalizable: false,
        next: "LATENCY_BUDGET_EXHAUSTED",
        failureClass: "LATENCY_BUDGET_EXHAUSTED",
        reason: exhausted.reason,
        attempts,
        expert: lastExpert,
        verifier: lastVerifier,
        budget: budget.snapshot(),
      };
    }
    const stale = staleAbortInfo(abortSignal);
    if (stale) {
      tracker.classify(stale.classification || "STALE_UPSTREAM");
      return {
        finalizable: false,
        next: "REFRESH_REQUIRED",
        failureClass: stale.classification || "STALE_UPSTREAM",
        reason: stale.reason || "candidate invalidated mid-flight",
        mismatch: stale.mismatch || null,
        attempts,
        expert: lastExpert,
        verifier: lastVerifier,
        budget: budget.snapshot(),
      };
    }
    return null;
  }

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const early = refreshIfStaleOrBudget();
      if (early) return early;

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
        if (live && cand) {
          const race = assertFinalizerFreshness({
            candidateUpstreamSha: cand,
            liveUpstreamHead: live,
            candidateBaseAppsolinoSha: baseCand,
            liveAppsolinoMain: liveMain,
          });
          if (!race.ok) {
            tracker.classify(
              /appsolino/i.test(String(race.reason || "")) ? "STALE_APPSOLINO_BASE" : "STALE_UPSTREAM",
            );
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
              budget: budget.snapshot(),
            };
          }
        }
      }

      const expertTimeout = budget.childTimeoutMs(
        openRequiredChanges.length ? "targeted-repair" : "expert",
      );
      tracker.beginPhase({
        name: "expert",
        attempt,
        model: "composer-2.5",
        classification: openRequiredChanges.length ? "VERIFIER_REQUEST_CHANGES" : "AI_EXPERT_REASONING",
      });

      const expert = await expertFn({
        worktreePath: input.worktreePath,
        timeoutMs: expertTimeout,
        abortSignal,
        onActivity: () => tracker.markActivity(),
        evidence: {
          ...input.evidence,
          requiredChanges: openRequiredChanges,
          targetedRepairInstructions: buildTargetedRepairInstructions(openRequiredChanges),
          previousAttempts: summarizePreviousAttempts(attempts),
        },
      });
      lastExpert = expert;
      tracker.endPhase({
        result: expert.ok ? expert.action : expert.failureClass || expert.action,
        classification: expert.failureClass || null,
        wasted: Boolean(expert.failureClass === "AI_PROTOCOL_ERROR"),
      });

      if (!expert.ok || !expert.decision) {
        if (
          expert.action === "REFRESH_REQUIRED" ||
          expert.failureClass === "STALE_UPSTREAM" ||
          expert.failureClass === "STALE_APPSOLINO_BASE"
        ) {
          return {
            finalizable: false,
            next: "REFRESH_REQUIRED",
            failureClass: expert.failureClass || "STALE_UPSTREAM",
            reason: expert.reason || "expert aborted for stale candidate",
            attempts,
            expert,
            verifier: null,
            budget: budget.snapshot(),
          };
        }
        if (expert.action === "LATENCY_BUDGET_EXHAUSTED" || expert.failureClass === "LATENCY_BUDGET_EXHAUSTED") {
          return {
            finalizable: false,
            next: "LATENCY_BUDGET_EXHAUSTED",
            failureClass: "LATENCY_BUDGET_EXHAUSTED",
            reason: expert.reason || "cycle budget exhausted during expert",
            attempts,
            expert,
            verifier: null,
            budget: budget.snapshot(),
          };
        }
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
          budget: budget.snapshot(),
        };
      }

      const earlyAfterExpert = refreshIfStaleOrBudget();
      if (earlyAfterExpert) return earlyAfterExpert;

      const testRunner =
        input.runDeterministicTests ||
        (async () => ({ passed: true, failures: [], log: "no-test-runner-injected" }));
      tracker.beginPhase({ name: "deterministic", attempt, classification: "DETERMINISTIC_TESTS" });
      const tests = await testRunner({
        attempt,
        worktreePath: input.worktreePath,
        expertDecision: expert.decision,
      });
      tracker.endPhase({ result: tests.passed ? "PASS" : "FAIL" });

      const diffText =
        typeof input.getDiffText === "function"
          ? await input.getDiffText({
              attempt,
              worktreePath: input.worktreePath,
              startSha,
              expertDecision: expert.decision,
            })
          : collectExpertDiffEvidence(input.worktreePath, startSha);

      /*
      FNXC:UpstreamLatency 2026-08-07-14:15:
      If REQUEST_CHANGES is open and the expert produced an empty delta, stop —
      another blind attempt will not converge.
      */
      const meaningfulDelta = hasMeaningfulCandidateDelta({
        filesChanged: expert.decision.filesChanged,
        diffText,
      });
      if (openRequiredChanges.length > 0 && !meaningfulDelta) {
        tracker.classify("REPAIR_NON_CONVERGENCE");
        attempts.push({
          attempt,
          phase: "gate",
          ok: false,
          next: "NON_CONVERGING_LOOP",
          reason: "expert produced no meaningful delta while REQUEST_CHANGES unresolved",
          requiredChanges: openRequiredChanges,
          expertDecision: expert.decision.decision,
          testsPassed: tests.passed,
        });
        return {
          finalizable: false,
          next: "NON_CONVERGING_LOOP",
          failureClass: "REPAIR_NON_CONVERGENCE",
          reason: "expert changed nothing while REQUEST_CHANGES remained open",
          attempts,
          expert,
          verifier: lastVerifier,
          budget: budget.snapshot(),
        };
      }

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

      const verifierTimeout = budget.childTimeoutMs("verifier");
      tracker.beginPhase({
        name: "verifier",
        attempt,
        model: "claude-opus-5-thinking-high",
        classification: "AI_VERIFIER_REASONING",
      });
      const verifier = await verifierFn({
        worktreePath: input.worktreePath,
        timeoutMs: verifierTimeout,
        abortSignal,
        onActivity: () => tracker.markActivity(),
        resolveTimeoutMs: (mode) =>
          budget.childTimeoutMs(mode === "schema-repair" ? "schema-repair" : "verifier"),
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
          requiredChangesFocus: openRequiredChanges,
        },
        requireShaBinding: Boolean(candidateSha && upstreamSha && baseAppsolinoSha),
      });
      lastVerifier = verifier;
      tracker.endPhase({
        result: verifier.ok ? verifier.verdict?.verdict : verifier.failureClass || verifier.action,
        classification: verifier.failureClass || null,
        wasted: Boolean(verifier.failureClass === "AI_PROTOCOL_ERROR"),
      });

      if (!verifier.ok || !verifier.verdict) {
        if (verifier.action === "REFRESH_REQUIRED") {
          return {
            finalizable: false,
            next: "REFRESH_REQUIRED",
            failureClass: verifier.failureClass || "STALE_UPSTREAM",
            reason: verifier.reason || "verifier aborted for stale candidate",
            attempts,
            expert,
            verifier,
            budget: budget.snapshot(),
          };
        }
        if (verifier.action === "LATENCY_BUDGET_EXHAUSTED" || verifier.failureClass === "LATENCY_BUDGET_EXHAUSTED") {
          return {
            finalizable: false,
            next: "LATENCY_BUDGET_EXHAUSTED",
            failureClass: "LATENCY_BUDGET_EXHAUSTED",
            reason: verifier.reason || "cycle budget exhausted during verifier",
            attempts,
            expert,
            verifier,
            budget: budget.snapshot(),
          };
        }
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
          budget: budget.snapshot(),
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

      const requiredChanges = Array.isArray(verifier.verdict.requiredChanges)
        ? verifier.verdict.requiredChanges
        : [];
      const nextSig = normalizeRequiredChangesSignature(requiredChanges);

      if (verifier.verdict.verdict === "REQUEST_CHANGES") {
        tracker.classify("VERIFIER_REQUEST_CHANGES");
        const conv = detectNonConvergence({
          priorSignature: priorRequiredSignature,
          nextSignature: nextSig,
          hadMeaningfulDelta: meaningfulDelta,
          repeatCount: sameSignatureRepeats,
        });
        sameSignatureRepeats = conv.repeatCount || 0;
        if (conv.nonConverging) {
          tracker.classify("REPAIR_NON_CONVERGENCE");
          attempts.push({
            attempt,
            phase: "gate",
            ok: false,
            next: "NON_CONVERGING_LOOP",
            reason: conv.reason,
            requiredChanges,
            expertDecision: expert.decision.decision,
            verifierVerdict: verifier.verdict.verdict,
            testsPassed: tests.passed,
          });
          return {
            finalizable: false,
            next: "NON_CONVERGING_LOOP",
            failureClass: "REPAIR_NON_CONVERGENCE",
            reason: conv.reason,
            attempts,
            expert,
            verifier,
            tests,
            budget: budget.snapshot(),
          };
        }
        priorRequiredSignature = nextSig || priorRequiredSignature;
        openRequiredChanges = requiredChanges;
      } else {
        openRequiredChanges = [];
        priorRequiredSignature = null;
        sameSignatureRepeats = 0;
      }

      attempts.push({
        attempt,
        phase: "gate",
        ok: gate.finalizable,
        next: gate.next,
        reason: gate.reason,
        failureClass: gate.failureClass || null,
        expertDecision: expert.decision.decision,
        verifierVerdict: verifier.verdict.verdict,
        requiredChanges,
        testsPassed: tests.passed,
        expertModel: expert.actualModel,
        verifierModel: verifier.actualModel,
        acceptedVerifierModel: verifier.acceptedModel || verifier.actualModel,
        verifierAttempts: verifier.verifierAttempts || null,
        expertLatencyMs: expert.latencyMs,
        verifierLatencyMs: verifier.latencyMs,
        meaningfulDelta,
      });
      if (typeof input.onAttempt === "function") input.onAttempt(attempts[attempts.length - 1]);

      if (gate.finalizable) {
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
                budget: budget.snapshot(),
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
          budget: budget.snapshot(),
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
          budget: budget.snapshot(),
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
          budget: budget.snapshot(),
        };
      }
    }

    return {
      finalizable: false,
      next: "BLOCKED_UNRESOLVED",
      reason: `bounded expert repair exhausted after ${maxAttempts} attempts`,
      attempts,
      expert: lastExpert,
      verifier: lastVerifier,
      budget: budget.snapshot(),
    };
  } finally {
    watchdog?.stop();
    tracker.stopHeartbeat();
  }
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
    budget: result.budget || null,
    failureClass: result.failureClass || null,
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
