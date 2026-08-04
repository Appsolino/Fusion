#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Separate expert invocation — analyzes evidence only (advice, no mutation).
 * Default engine: appsolino-s1a-deterministic (pinned, not a silent fallback).
 */
import {
  CONFIDENCE,
  FILE_KIND,
  PINNED_MODEL,
  PINNED_PROVIDER,
  RISK_LEVEL,
  S1A_BOUNDS,
} from "./policy.mjs";

/**
 * @typedef {{
 *   path: string,
 *   kind: string,
 *   playbook: string,
 *   notes: string,
 * }} FileAnalysis
 */

/**
 * @typedef {{
 *   provider: string,
 *   model: string,
 *   configuredProvider: string,
 *   configuredModel: string,
 *   actualProvider: string,
 *   actualModel: string,
 *   attempt: number,
 *   failureClass: string|null,
 *   confidence: string,
 *   risk: string,
 *   summary: string,
 *   rootCause: string,
 *   recommendedSolution: string,
 *   validation: string[],
 *   files: FileAnalysis[],
 *   ownerDecision: string,
 *   repairRecommended: boolean,
 *   needsMoreEvidence: boolean,
 *   criticalFreeze: boolean,
 *   evidenceGaps: string[],
 * }} Assessment
 */

/**
 * Classify a conflicted / changed file path for advisory playbooks.
 * Derives from path patterns — not hardcoded to a single issue number.
 * @param {string} filePath
 * @returns {FileAnalysis}
 */
export function classifyConflictFile(filePath) {
  const path = String(filePath || "").replace(/\\/g, "/");
  const base = path.split("/").pop() || path;

  if (
    /lifecycle-column-census-baseline\.json$/i.test(path) ||
    /-baseline\.json$/i.test(base) ||
    /(^|\/)generated\//i.test(path)
  ) {
    return {
      path,
      kind: FILE_KIND.GENERATED_BASELINE,
      playbook: "regeneration",
      notes:
        "Generated baseline: re-run the producer script (e.g. lifecycle-column-census --strict --update-baseline) on the intended merge base; do not hand-merge JSON.",
    };
  }

  if (/(^|\/)\.github\/workflows\//.test(path) || /\.ya?ml$/i.test(path) && /workflow/i.test(path)) {
    return {
      path,
      kind: FILE_KIND.WORKFLOW,
      playbook: "owner-sensitive-review",
      notes: "Workflow YAML change — SENSITIVE; owner review required before any repair.",
    };
  }

  if (/migration/i.test(path) || /\/migrations?\//i.test(path)) {
    return {
      path,
      kind: FILE_KIND.MIGRATION,
      playbook: "owner-sensitive-review",
      notes: "Migration/schema touch — SENSITIVE; freeze automation until owner guidance.",
    };
  }

  if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb)$/i.test(path)) {
    return {
      path,
      kind: FILE_KIND.LOCKFILE,
      playbook: "owner-sensitive-review",
      notes: "Lockfile conflict — SENSITIVE; regenerate lock via package manager after semantic resolve.",
    };
  }

  if (
    /(^|\/)packages\//.test(path) ||
    /executor\.ts$/i.test(path) ||
    /\.(ts|tsx|js|mjs|cjs)$/i.test(path)
  ) {
    return {
      path,
      kind: FILE_KIND.SEMANTIC_SOURCE,
      playbook: "history-and-tests",
      notes:
        "Semantic source conflict: inspect git history on both sides, resolve with intent, run targeted unit/integration tests. S1A does not apply the patch.",
    };
  }

  return {
    path,
    kind: FILE_KIND.OTHER,
    playbook: "manual-triage",
    notes: "Unclassified path — request owner/file-owner context before repair.",
  };
}

/**
 * @param {import("./evidence-pack.mjs").EvidencePack} pack
 * @returns {string}
 */
function deriveRisk(pack, files) {
  const terminal = String(pack.terminalStatus || "").toUpperCase();
  if (terminal === "CRITICAL" || terminal === "ROLLED_BACK") {
    return RISK_LEVEL.CRITICAL;
  }
  const sensitive =
    pack.auto1.touchesWorkflows === true ||
    pack.auto1.touchesMigrations === true ||
    pack.auto1.touchesLockfile === true ||
    pack.relatedPr?.touchesWorkflows === true ||
    pack.relatedPr?.touchesMigrations === true ||
    pack.relatedPr?.touchesLockfile === true ||
    files.some((f) =>
      [FILE_KIND.WORKFLOW, FILE_KIND.MIGRATION, FILE_KIND.LOCKFILE].includes(f.kind),
    );
  if (sensitive) return RISK_LEVEL.SENSITIVE;

  const hasSemantic = files.some((f) => f.kind === FILE_KIND.SEMANTIC_SOURCE);
  const hasGenerated = files.some((f) => f.kind === FILE_KIND.GENERATED_BASELINE);
  // Mixed semantic + generated → SENSITIVE overall (issue #74-shaped advisory).
  if (hasSemantic && hasGenerated) return RISK_LEVEL.SENSITIVE;
  if (hasSemantic) return RISK_LEVEL.HIGH;
  if (hasGenerated) return RISK_LEVEL.MEDIUM;
  return RISK_LEVEL.MEDIUM;
}

/**
 * Deterministic engineer analysis from evidence fields.
 * @param {import("./evidence-pack.mjs").EvidencePack} evidencePack
 * @param {{
 *   attempt?: number,
 *   priorRejection?: { reason?: string } | null,
 *   provider?: string,
 *   model?: string,
 * }} [opts]
 * @returns {Assessment}
 */
export function analyzeEvidence(evidencePack, opts = {}) {
  const configuredProvider = opts.provider || process.env.S1A_PROVIDER || PINNED_PROVIDER;
  const configuredModel = opts.model || process.env.S1A_MODEL || PINNED_MODEL;
  const actualProvider = configuredProvider;
  const actualModel = configuredModel;

  if (configuredProvider !== actualProvider || configuredModel !== actualModel) {
    throw new Error("silent provider/model fallback forbidden");
  }

  const attempt = Math.max(1, Number(opts.attempt) || 1);
  if (attempt > S1A_BOUNDS.maxAttempts) {
    throw new Error(`maxAttempts exceeded (${S1A_BOUNDS.maxAttempts})`);
  }

  const files = (evidencePack.auto1.conflictedFiles || []).map(classifyConflictFile);
  const failureClass = evidencePack.failureClass;
  const risk = deriveRisk(evidencePack, files);
  const criticalFreeze = risk === RISK_LEVEL.CRITICAL;

  /** @type {string[]} */
  const evidenceGaps = [];
  if (!evidencePack.auto1.upstreamSha) evidenceGaps.push("missing-upstream-sha");
  if (!evidencePack.auto1.prUrl && !evidencePack.relatedPr?.url) {
    evidenceGaps.push("missing-sync-pr");
  }
  if (!files.length && failureClass === "upstream-merge-conflict") {
    evidenceGaps.push("missing-conflicted-files");
  }
  if (opts.priorRejection?.reason) {
    evidenceGaps.push(`prior-reject:${opts.priorRejection.reason}`);
  }

  const needsMoreEvidence = evidenceGaps.some((g) =>
    ["missing-upstream-sha", "missing-conflicted-files"].includes(g),
  );

  const generated = files.filter((f) => f.kind === FILE_KIND.GENERATED_BASELINE);
  const semantic = files.filter((f) => f.kind === FILE_KIND.SEMANTIC_SOURCE);

  let rootCause;
  let recommendedSolution;
  let confidence = CONFIDENCE.HIGH;

  if (failureClass === "upstream-merge-conflict") {
    const parts = [];
    if (generated.length) {
      parts.push(
        `Generated baseline conflict on ${generated.map((f) => f.path).join(", ")} — typically resolved by regenerating baselines after semantic merge, not by editing JSON by hand.`,
      );
    }
    if (semantic.length) {
      parts.push(
        `Semantic source conflict on ${semantic.map((f) => f.path).join(", ")} — requires history comparison and tests before any repair PR (S1B, when authorised).`,
      );
    }
    if (!parts.length) {
      parts.push("AUTO-1 reported outcome=conflict without classified file kinds.");
      confidence = CONFIDENCE.LOW;
    }
    rootCause = parts.join(" ");
    recommendedSolution = [
      "Do not merge the sync PR automatically.",
      "Keep main unrepaired; S1A posts advice only.",
      generated.length
        ? "For baseline files: regenerate via producer script after choosing the intended code semantic."
        : null,
      semantic.length
        ? "For semantic sources (e.g. packages/*, executor.ts): review both sides, write/extend tests, prepare a future repair branch only after S1B authorisation."
        : null,
      risk === RISK_LEVEL.SENSITIVE || risk === RISK_LEVEL.CRITICAL
        ? "Escalation: owner decision required before any mutation."
        : "After owner accepts advice, a separate S1B mission may open repair/<incident-id> — not in this run.",
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    confidence = CONFIDENCE.MEDIUM;
    rootCause = `Failure class ${failureClass || "unknown"} — deterministic S1A plays the conflict playbooks primarily; other classes need broader triage.`;
    recommendedSolution =
      "Collect more targeted evidence (logs, expected SHA, AUTO evidence artifact) before authorising repair.";
  }

  if (needsMoreEvidence) {
    confidence = CONFIDENCE.LOW;
  }
  if (criticalFreeze) {
    recommendedSolution =
      "CRITICAL/rollback-class signal: advice and freeze only. Notify owner. No repair branch, no AUTO redispatch, no Host D/P.";
  }

  const summary = [
    `S1A assessment for ${failureClass || "unknown"}`,
    `files=${files.length}`,
    `risk=${risk}`,
    `attempt=${attempt}`,
  ].join(" · ");

  return {
    provider: actualProvider,
    model: actualModel,
    configuredProvider,
    configuredModel,
    actualProvider,
    actualModel,
    attempt,
    failureClass,
    confidence,
    risk,
    summary,
    rootCause,
    recommendedSolution,
    validation: [
      "Confirm fingerprint + occurrence match the incident issue.",
      "Confirm conflicted file list matches AUTO-1 JSON / PR files.",
      "Confirm physical invariants: mutatedMain=false, deployedHostD=false, hostPAccessed=false, enginePaused=true (advisory defaults when unknown).",
      "Do not dispatch AUTO workflows from Steward.",
      semantic.length
        ? "Before any future repair: run targeted tests for semantic conflict paths."
        : "Before any future repair: verify baseline regeneration is clean under --strict.",
    ],
    files,
    ownerDecision: criticalFreeze
      ? "Freeze further repair attempts; owner must take the next action."
      : needsMoreEvidence
        ? "Supply missing evidence (upstream SHA / conflicted files / PR) then re-label steward/needs-expert."
        : risk === RISK_LEVEL.SENSITIVE
          ? "Accept advice and decide whether a future S1B repair is warranted (SENSITIVE scope)."
          : "Accept or reject advice; if accepted, authorise a separate S1B mission later — not automatic.",
    repairRecommended:
      !criticalFreeze &&
      !needsMoreEvidence &&
      failureClass === "upstream-merge-conflict" &&
      files.length > 0 &&
      risk !== RISK_LEVEL.CRITICAL,
    needsMoreEvidence,
    criticalFreeze,
    evidenceGaps,
  };
}

/**
 * Invoke engineer (default deterministic). Injectable for tests.
 * @param {import("./evidence-pack.mjs").EvidencePack} evidencePack
 * @param {{
 *   attempt?: number,
 *   priorRejection?: { reason?: string } | null,
 *   engine?: (pack: import("./evidence-pack.mjs").EvidencePack, opts: object) => Assessment | Promise<Assessment>,
 * }} [opts]
 */
export async function runEngineer(evidencePack, opts = {}) {
  if (opts.engine) {
    return opts.engine(evidencePack, opts);
  }
  const engineName = String(process.env.S1A_ENGINE || "deterministic").toLowerCase();
  if (engineName === "cursor") {
    const { runCursorEngine } = await import("./cursor-engine.mjs");
    return runCursorEngine(evidencePack, opts);
  }
  return analyzeEvidence(evidencePack, opts);
}
