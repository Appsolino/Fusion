#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Create or update one GitHub Issue per steward fingerprint. Hidden HTML marker
 * enables search/dedup. Occurrence IDs prevent duplicate comments for the same run.
 * S0 upsert only — no merge, dispatch, or repair branches.
 */
import {
  escapeMarkdown,
  extractFingerprintFromIssueBody,
  fingerprintMarkerHtml,
  STEWARD_PHASE,
} from "./policy.mjs";
import { resolveS0HandoffS1a } from "./activation/resolve-activation.mjs";

/**
 * @typedef {{
 *   number: number,
 *   title: string,
 *   state: string,
 *   body?: string,
 * }} IssueLike
 */

/**
 * @typedef {{
 *   searchIssuesByMarker: (fingerprint: string) => Promise<IssueLike[]>,
 *   createIssue: (input: { title: string, body: string, labels?: string[] }) => Promise<IssueLike>,
 *   updateIssue: (number: number, input: { body?: string, state?: string, title?: string }) => Promise<IssueLike>,
 *   createComment?: (number: number, body: string) => Promise<{ id: number }>,
 * }} IssueClient
 */

/**
 * Decide upsert action for a normalized incident.
 * @param {{
 *   fingerprint: string,
 *   existingIssues: IssueLike[],
 *   occurrenceId: string,
 * }} input
 */
export function planUpsert(input) {
  const fp = String(input.fingerprint || "").toLowerCase();
  const matching = (input.existingIssues || []).filter(
    (i) => extractFingerprintFromIssueBody(i.body || "") === fp,
  );

  if (!matching.length) {
    return { action: "create", fingerprint: fp, issueNumber: null };
  }

  // Prefer open issue; else reopen closed.
  const open = matching.find((i) => String(i.state).toLowerCase() === "open");
  const target = open || matching[0];
  const body = target.body || "";
  if (bodyIncludesOccurrence(body, input.occurrenceId)) {
    return {
      action: "noop-duplicate-occurrence",
      fingerprint: fp,
      issueNumber: target.number,
      issueState: target.state,
    };
  }

  if (String(target.state).toLowerCase() === "closed") {
    return {
      action: "reopen-and-append",
      fingerprint: fp,
      issueNumber: target.number,
      issueState: target.state,
    };
  }

  return {
    action: "append",
    fingerprint: fp,
    issueNumber: target.number,
    issueState: target.state,
  };
}

/**
 * @param {string} body
 * @param {string} occurrenceId
 */
export function bodyIncludesOccurrence(body, occurrenceId) {
  const needle = `occurrence-id: ${occurrenceId}`;
  return String(body || "").includes(needle);
}

/**
 * @param {ReturnType<import("./normalize-evidence.mjs").normalizeEvidence>} normalized
 */
export function buildNewIssueContent(normalized) {
  const fp = normalized.fingerprint;
  if (!fp) throw new Error("cannot build issue without fingerprint");
  const marker = fingerprintMarkerHtml(fp);
  const title = `[steward] ${normalized.failureClass} · ${normalized.workflowFamily}/${normalized.phase}`;
  const auto1 = normalized.instance?.auto1Result || {};
  const conflictSection = normalized.failureClass === "upstream-merge-conflict"
    ? [
      "",
      "### AUTO-1 conflict",
      "",
      `| Upstream SHA | \`${escapeMarkdown(auto1.upstreamSha || "")}\` |`,
      `| Sync PR | ${auto1.prUrl ? escapeMarkdown(auto1.prUrl) : ""} |`,
      `| Conflicted files | ${(auto1.conflictedFiles || []).map((f) => `\`${escapeMarkdown(f)}\``).join(", ")} |`,
      `| Workflows / migrations / lockfile | ${auto1.touchesWorkflows}/${auto1.touchesMigrations}/${auto1.touchesLockfile} |`,
      `| mutatedMain | \`${auto1.mutatedMain === false ? "false" : escapeMarkdown(auto1.mutatedMain)}\` |`,
      `| deployedHostD | \`${auto1.deployedHostD === false ? "false" : escapeMarkdown(auto1.deployedHostD)}\` |`,
      "",
    ]
    : [];
  const body = [
    marker,
    "",
    `## Upstream Reliability Steward (${STEWARD_PHASE})`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Fingerprint | \`sha256:${fp}\` |`,
    `| Class | ${escapeMarkdown(normalized.failureClass)} |`,
    `| Workflow | ${escapeMarkdown(normalized.workflowFamily)} |`,
    `| Phase | ${escapeMarkdown(normalized.phase)} |`,
    `| Component | ${escapeMarkdown(normalized.component)} |`,
    `| Terminal | ${escapeMarkdown(normalized.terminalStatus)} |`,
    `| Error signature | ${escapeMarkdown(normalized.errorSignature)} |`,
    ...conflictSection,
    "### Occurrences",
    "",
    formatOccurrenceBlock(normalized),
    "",
    "### Policy",
    "",
    "- S0 observation only — no repair, dispatch, merge, or Host D deploy from steward.",
    "- Same fingerprint updates this issue; volatile run IDs live only in occurrence blocks.",
    "",
  ].join("\n");

  const labels = ["appsolino-steward", "s0-observation", normalized.failureClass];
  // Optional S0 → S1A handoff. Prefer activation-policy.json; env override remains.
  if (resolveS0HandoffS1a()) {
    labels.push("steward/needs-expert");
  }
  return {
    title: title.slice(0, 200),
    body,
    labels,
  };
}

/**
 * @param {string} existingBody
 * @param {ReturnType<import("./normalize-evidence.mjs").normalizeEvidence>} normalized
 */
export function appendOccurrenceToBody(existingBody, normalized) {
  const oid = normalized.instance.occurrenceId;
  if (bodyIncludesOccurrence(existingBody, oid)) {
    return { body: existingBody, appended: false };
  }
  const block = formatOccurrenceBlock(normalized);
  const body = `${String(existingBody || "").trimEnd()}\n\n${block}\n`;
  return { body, appended: true };
}

/**
 * @param {ReturnType<import("./normalize-evidence.mjs").normalizeEvidence>} normalized
 */
export function formatOccurrenceBlock(normalized) {
  const i = normalized.instance || {};
  const lines = [
    `<details>`,
    `<summary>occurrence-id: ${escapeMarkdown(i.occurrenceId)}</summary>`,
    "",
    `- runId: \`${escapeMarkdown(i.runId)}\``,
    `- attempt: \`${escapeMarkdown(i.attempt)}\``,
    `- parentRunId: \`${escapeMarkdown(i.parentRunId)}\``,
    `- childRunId: \`${escapeMarkdown(i.childRunId)}\``,
    `- sourceSha: \`${escapeMarkdown(i.sourceSha)}\``,
    `- headSha: \`${escapeMarkdown(i.headSha)}\``,
    `- handoffId: \`${escapeMarkdown(i.handoffId)}\``,
    `- releaseId: \`${escapeMarkdown(i.releaseId)}\``,
    `- recordedUtc: \`${escapeMarkdown(i.recordedUtc)}\``,
    `- parentTerminal: \`${escapeMarkdown(i.parentTerminal)}\``,
    `- childTerminal: \`${escapeMarkdown(i.childTerminal)}\``,
  ];
  const a = i.auto1Result && typeof i.auto1Result === "object" ? i.auto1Result : null;
  if (a && (a.outcome || a.prUrl || a.upstreamSha || (a.conflictedFiles || []).length)) {
    lines.push(`- auto1.outcome: \`${escapeMarkdown(a.outcome)}\``);
    lines.push(`- auto1.upstreamSha: \`${escapeMarkdown(a.upstreamSha)}\``);
    lines.push(`- auto1.prUrl: \`${escapeMarkdown(a.prUrl)}\``);
    lines.push(`- auto1.conflictedFiles: \`${escapeMarkdown((a.conflictedFiles || []).join(", "))}\``);
    lines.push(`- auto1.mutatedMain: \`${a.mutatedMain === false ? "false" : escapeMarkdown(a.mutatedMain)}\``);
    lines.push(`- auto1.deployedHostD: \`${a.deployedHostD === false ? "false" : escapeMarkdown(a.deployedHostD)}\``);
  }
  lines.push(
    "",
    "Log excerpt (escaped, untrusted):",
    "",
    "```text",
    String(i.logExcerpt || "").slice(0, 1200),
    "```",
    "",
    `</details>`,
  );
  return lines.join("\n");
}

/**
 * In-process fingerprint lock for one upsert batch / steward run.
 * Avoids GitHub Search eventual-consistency creating a second issue for
 * the same fingerprint when multiple candidates share a digest.
 * @returns {{ byFingerprint: Map<string, IssueLike> }}
 */
export function createUpsertSession() {
  return { byFingerprint: new Map() };
}

/**
 * @param {{ byFingerprint: Map<string, IssueLike> } | null | undefined} session
 * @param {string} fingerprint
 * @param {IssueLike[]} remote
 */
function resolveExistingIssues(session, fingerprint, remote) {
  const fp = String(fingerprint || "").toLowerCase();
  /** @type {IssueLike[]} */
  const out = [];
  const seen = new Set();
  const cached = session?.byFingerprint?.get(fp);
  if (cached) {
    out.push(cached);
    seen.add(cached.number);
  }
  for (const issue of remote || []) {
    if (seen.has(issue.number)) continue;
    out.push(issue);
    seen.add(issue.number);
  }
  return out;
}

/**
 * @param {{ byFingerprint: Map<string, IssueLike> } | null | undefined} session
 * @param {string} fingerprint
 * @param {IssueLike} issue
 */
function rememberSessionIssue(session, fingerprint, issue) {
  if (!session?.byFingerprint || !issue) return;
  session.byFingerprint.set(String(fingerprint || "").toLowerCase(), issue);
}

/**
 * Execute upsert against an IssueClient (real gh API or in-memory fake).
 * @param {IssueClient} client
 * @param {ReturnType<import("./normalize-evidence.mjs").normalizeEvidence>} normalized
 * @param {{ byFingerprint: Map<string, IssueLike> } | null} [session]
 */
export async function upsertIncident(client, normalized, session = null) {
  if (!normalized.openIncident || !normalized.fingerprint) {
    return { ok: true, action: "skip-no-incident", issueNumber: null };
  }

  const remote = await client.searchIssuesByMarker(normalized.fingerprint);
  const existing = resolveExistingIssues(session, normalized.fingerprint, remote);
  const plan = planUpsert({
    fingerprint: normalized.fingerprint,
    existingIssues: existing,
    occurrenceId: normalized.instance.occurrenceId,
  });

  if (plan.action === "create") {
    // FNXC:AppsolinoStewardS0 2026-08-02-04:55: Re-search immediately before create to shrink duplicate races.
    const racedRemote = await client.searchIssuesByMarker(normalized.fingerprint);
    const raced = resolveExistingIssues(session, normalized.fingerprint, racedRemote);
    const racedPlan = planUpsert({
      fingerprint: normalized.fingerprint,
      existingIssues: raced,
      occurrenceId: normalized.instance.occurrenceId,
    });
    if (racedPlan.action !== "create") {
      if (racedPlan.action === "noop-duplicate-occurrence") {
        const kept = raced.find((i) => i.number === racedPlan.issueNumber) || raced[0];
        rememberSessionIssue(session, normalized.fingerprint, kept);
        return { ok: true, action: racedPlan.action, issueNumber: racedPlan.issueNumber, plan: racedPlan };
      }
      const current = raced.find((i) => i.number === racedPlan.issueNumber) || raced[0];
      const { body, appended } = appendOccurrenceToBody(current.body || "", normalized);
      const patch = { body };
      if (racedPlan.action === "reopen-and-append") patch.state = "open";
      const updated = await client.updateIssue(racedPlan.issueNumber, patch);
      rememberSessionIssue(session, normalized.fingerprint, updated);
      return {
        ok: true,
        action: racedPlan.action,
        issueNumber: updated.number,
        appended,
        plan: racedPlan,
      };
    }
    const content = buildNewIssueContent(normalized);
    const created = await client.createIssue(content);
    rememberSessionIssue(session, normalized.fingerprint, created);
    return { ok: true, action: "create", issueNumber: created.number, plan };
  }

  if (plan.action === "noop-duplicate-occurrence") {
    const kept = existing.find((i) => i.number === plan.issueNumber) || existing[0];
    const auto1 = normalized.instance?.auto1Result;
    const prUrl = auto1?.prUrl ? String(auto1.prUrl) : "";
    const body = kept?.body || "";
    const missingConflictDetail = Boolean(prUrl) && !body.includes(prUrl);
    if (missingConflictDetail) {
      const content = buildNewIssueContent(normalized);
      const updated = await client.updateIssue(plan.issueNumber, {
        title: content.title,
        body: content.body,
      });
      rememberSessionIssue(session, normalized.fingerprint, updated);
      return {
        ok: true,
        action: "enrich-auto1-conflict-fields",
        issueNumber: updated.number,
        plan,
      };
    }
    rememberSessionIssue(session, normalized.fingerprint, kept);
    return { ok: true, action: plan.action, issueNumber: plan.issueNumber, plan };
  }

  const current = existing.find((i) => i.number === plan.issueNumber) || existing[0];
  const { body, appended } = appendOccurrenceToBody(current.body || "", normalized);
  const patch = { body };
  if (plan.action === "reopen-and-append") {
    patch.state = "open";
  }
  const updated = await client.updateIssue(plan.issueNumber, patch);
  rememberSessionIssue(session, normalized.fingerprint, updated);
  return {
    ok: true,
    action: plan.action,
    issueNumber: updated.number,
    appended,
    plan,
  };
}

/**
 * In-memory IssueClient for unit tests.
 */
export function createMemoryIssueClient(seed = []) {
  /** @type {IssueLike[]} */
  const issues = seed.map((i) => ({ ...i, body: i.body || "" }));
  let next = Math.max(0, ...issues.map((i) => i.number), 0) + 1;

  return {
    issues,
    async searchIssuesByMarker(fingerprint) {
      const fp = String(fingerprint).toLowerCase();
      return issues.filter((i) => extractFingerprintFromIssueBody(i.body || "") === fp);
    },
    async createIssue({ title, body, labels }) {
      const issue = {
        number: next++,
        title,
        body,
        state: "open",
        labels: labels || [],
      };
      issues.push(issue);
      return issue;
    },
    async updateIssue(number, input) {
      const issue = issues.find((i) => i.number === number);
      if (!issue) throw new Error(`issue ${number} not found`);
      if (input.body != null) issue.body = input.body;
      if (input.state != null) issue.state = input.state;
      if (input.title != null) issue.title = input.title;
      return issue;
    },
    async createComment() {
      return { id: 1 };
    },
  };
}
