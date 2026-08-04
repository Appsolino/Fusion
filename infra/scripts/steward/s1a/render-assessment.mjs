#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Render Steward Expert Assessment markdown with hidden idempotency marker.
 * Untrusted fields escaped via parent escapeMarkdown.
 */
import { escapeMarkdown } from "../policy.mjs";
import { assessmentMarkerHtml, S1A_BOUNDS } from "./policy.mjs";

/**
 * @param {{
 *   evidencePack: import("./evidence-pack.mjs").EvidencePack,
 *   assessment: import("./engineer.mjs").Assessment,
 *   review: { verdict: string, reason: string, details?: string[] },
 *   occurrence?: string|null,
 *   worktreePath?: string|null,
 * }} input
 * @returns {string}
 */
export function renderAssessmentMarkdown(input) {
  const pack = input.evidencePack;
  const a = input.assessment;
  const review = input.review;
  const occurrence =
    input.occurrence || pack.latestOccurrenceId || pack.occurrenceIds?.[0] || "unknown";
  const marker = assessmentMarkerHtml(
    pack.fingerprint,
    occurrence,
    S1A_BOUNDS.assessmentVersion,
  );

  const fileLines = (a.files || []).map(
    (f) =>
      `| \`${escapeMarkdown(f.path)}\` | ${escapeMarkdown(f.kind)} | ${escapeMarkdown(f.playbook)} | ${escapeMarkdown(f.notes)} |`,
  );

  const validationLines = (a.validation || []).map(
    (v) => `- ${escapeMarkdown(v)}`,
  );

  const phys = pack.physical || {};

  return [
    marker,
    "",
    "## Steward Expert Assessment",
    "",
    "### Incident",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Issue | #${escapeMarkdown(pack.issueNumber)} |`,
    `| Fingerprint | \`sha256:${escapeMarkdown(pack.fingerprint)}\` |`,
    `| Occurrence | \`${escapeMarkdown(occurrence)}\` |`,
    `| Class | ${escapeMarkdown(pack.failureClass)} |`,
    `| Workflow | ${escapeMarkdown(pack.workflowFamily)} / ${escapeMarkdown(pack.phase)} |`,
    `| Component | ${escapeMarkdown(pack.component)} |`,
    `| Terminal | ${escapeMarkdown(pack.terminalStatus)} |`,
    `| Sync PR | ${escapeMarkdown(pack.auto1.prUrl || pack.relatedPr?.url || "")} |`,
    `| Upstream SHA | \`${escapeMarkdown(pack.auto1.upstreamSha || "")}\` |`,
    "",
    "### What failed",
    "",
    escapeMarkdown(a.summary),
    "",
    "### Root cause",
    "",
    escapeMarkdown(a.rootCause),
    "",
    "### Recommended solution",
    "",
    escapeMarkdown(a.recommendedSolution),
    "",
    "### Files",
    "",
    "| Path | Kind | Playbook | Notes |",
    "| --- | --- | --- | --- |",
    ...(fileLines.length ? fileLines : ["| _(none)_ | | | |"]),
    "",
    "### Validation",
    "",
    ...validationLines,
    "",
    "### Risk",
    "",
    `| Risk | ${escapeMarkdown(a.risk)} |`,
    `| Confidence | ${escapeMarkdown(a.confidence)} |`,
    `| Repair recommended (advice only) | \`${a.repairRecommended ? "true" : "false"}\` |`,
    `| Critical freeze | \`${a.criticalFreeze ? "true" : "false"}\` |`,
    "",
    "### System state",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| mutatedMain | \`${phys.mutatedMain}\` |`,
    `| deployedHostD | \`${phys.deployedHostD}\` |`,
    `| hostPAccessed | \`${phys.hostPAccessed}\` |`,
    `| enginePaused | \`${phys.enginePaused}\` |`,
    `| configuredProvider | \`${escapeMarkdown(a.configuredProvider)}\` |`,
    `| configuredModel | \`${escapeMarkdown(a.configuredModel)}\` |`,
    `| actualProvider | \`${escapeMarkdown(a.actualProvider)}\` |`,
    `| actualModel | \`${escapeMarkdown(a.actualModel)}\` |`,
    `| assessment-version | \`${S1A_BOUNDS.assessmentVersion}\` |`,
    `| attempt | \`${a.attempt}\` |`,
    input.worktreePath
      ? `| worktree (advice-only path) | \`${escapeMarkdown(input.worktreePath)}\` |`
      : null,
    "",
    "### Reviewer",
    "",
    `| Verdict | ${escapeMarkdown(review.verdict)} |`,
    `| Reason | ${escapeMarkdown(review.reason)} |`,
    "",
    "### Owner decision",
    "",
    escapeMarkdown(a.ownerDecision),
    "",
    "### Policy",
    "",
    "- S1A advice only — no repair branch, no repair PR, no AUTO dispatch, no Host D/P.",
    "- S1B remains NOT AUTHORISED until a separate owner decision.",
    "",
  ]
    .filter((line) => line != null)
    .join("\n");
}
