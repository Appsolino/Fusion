#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Fixture (deterministic) engineer — CI / fixture-replay ONLY.
 * Never used for --mode=live. Export: runFixtureEngine / analyzeEvidence.
 */
import {
  CONFIDENCE,
  FILE_KIND,
  FIXTURE_MODEL,
  FIXTURE_PROVIDER,
  RISK_LEVEL,
  S1A_BOUNDS,
} from "./policy.mjs";
import { classifyConflictFile } from "./path-heuristics.mjs";

export { classifyConflictFile };

/**
 * @typedef {import("./path-heuristics.mjs").FileAnalysis} FileAnalysis
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
 * @param {import("./evidence-pack.mjs").EvidencePack} pack
 * @param {FileAnalysis[]} files
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
  if (hasSemantic && hasGenerated) return RISK_LEVEL.SENSITIVE;
  if (hasSemantic) return RISK_LEVEL.HIGH;
  if (hasGenerated) return RISK_LEVEL.MEDIUM;
  return RISK_LEVEL.MEDIUM;
}

/**
 * Deterministic / fixture engineer analysis from evidence fields.
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
  const configuredProvider = opts.provider || FIXTURE_PROVIDER;
  const configuredModel = opts.model || FIXTURE_MODEL;
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
    rootCause = `Failure class ${failureClass || "unknown"} — fixture S1A plays the conflict playbooks primarily; other classes need broader triage.`;
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
      "Confirm physical fields are evidence-backed (unknown → null; never invent hostPAccessed/enginePaused).",
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
 * Named fixture engine entry (S1A_ENGINE=fixture).
 * @param {import("./evidence-pack.mjs").EvidencePack} evidencePack
 * @param {Parameters<typeof analyzeEvidence>[1]} [opts]
 */
export async function runFixtureEngine(evidencePack, opts = {}) {
  return analyzeEvidence(evidencePack, opts);
}
