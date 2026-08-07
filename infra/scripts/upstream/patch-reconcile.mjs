#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamPatchReconcile 2026-08-07-04:25:
 * Canonical update algorithm step: for EACH registered product patch against clean latest
 * upstream — remove patch conceptually, run regression, Finding Comparison, classify,
 * then RETIRE / RETAIN / ADAPT. Question is "does defect still exist on clean upstream?"
 * not "does old patch still cherry-pick?"
 */
import {
  loadPatchRegistry,
  decidePatchReconciliation,
  applyReconciliationToPatch,
  upsertPatch,
} from "./patch-registry.mjs";
import { compareFinding } from "./finding-comparison.mjs";

/**
 * @param {{
 *   repoRoot: string,
 *   cleanUpstreamSha: string,
 *   runCleanRegression: (patch: object) => Promise<{passed:boolean,log?:string}|{passed:boolean,log?:string}> | {passed:boolean,log?:string},
 *   gatherUpstreamSignals?: (patch: object) => Promise<object[]>|object[],
 *   persist?: boolean,
 * }} input
 */
export async function reconcileAllPatches(input) {
  const registry = loadPatchRegistry(input.repoRoot);
  const results = [];
  const retained = [];
  const retired = [];
  const adapted = [];
  const blocked = [];
  const onlyIds = Array.isArray(input.onlyPatchIds)
    ? new Set(input.onlyPatchIds.map((id) => String(id).toUpperCase()))
    : null;

  for (const patch of registry.patches.filter((p) => p.status === "ACTIVE" || p.status === "ADAPTING" || p.status === "DRAFT")) {
    if (onlyIds && !onlyIds.has(String(patch.id).toUpperCase())) continue;
    const regression = await input.runCleanRegression(patch);
    const signals =
      typeof input.gatherUpstreamSignals === "function"
        ? await input.gatherUpstreamSignals(patch)
        : [];
    const comparison = compareFinding({
      localDefect: {
        description: patch.defect.description,
        reproduction: patch.defect.reproduction,
        affectedSubsystem: patch.defect.affectedSubsystem,
        codePaths: patch.localAction.applyPaths,
      },
      upstreamSignals: signals,
      cleanUpstreamRegressionPass: regression.passed,
      titleSimilarityOnly: false,
    });

    if (!comparison.ok) {
      blocked.push({ patchId: patch.id, reason: comparison.reason, evidence: comparison.evidence });
      results.push({
        patchId: patch.id,
        action: "BLOCKED",
        reason: comparison.reason,
        comparison,
        regression,
      });
      continue;
    }

    const decision = decidePatchReconciliation({
      patch,
      cleanUpstreamSha: input.cleanUpstreamSha,
      regressionPassesOnCleanUpstream: regression.passed,
      classification: comparison.classification,
      comparisonEvidence: comparison.evidence.join("; "),
    });

    let next = applyReconciliationToPatch(patch, decision, {
      againstUpstreamSha: input.cleanUpstreamSha,
      summary: decision.reason,
      files: patch.localAction.applyPaths,
    });
    next.upstreamComparison = {
      ...next.upstreamComparison,
      classification: comparison.classification,
      comparedAgainstSha: input.cleanUpstreamSha,
      relatedIssue: comparison.relatedIssue,
      relatedPr: comparison.relatedPr,
      relatedCommit: comparison.relatedCommit,
      evidence: comparison.evidence.join(" | "),
      comparedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    };

    if (input.persist !== false) {
      next = upsertPatch(input.repoRoot, next);
    }

    if (decision.action === "RETIRE") retired.push(next.id);
    else if (decision.action === "RETAIN_OR_ADAPT") {
      if ((patch.revisions?.length || 0) < (next.revisions?.length || 0)) adapted.push(next.id);
      retained.push(next.id);
    } else {
      blocked.push({ patchId: patch.id, reason: decision.reason });
    }

    results.push({
      patchId: patch.id,
      action: decision.action,
      status: next.status,
      classification: comparison.classification,
      reason: decision.reason,
      regressionPassed: regression.passed,
      comparison,
    });
  }

  return {
    cleanUpstreamSha: input.cleanUpstreamSha,
    results,
    retained,
    retired,
    adapted,
    blocked,
    recordedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}
