#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamRollingCandidate 2026-08-07-03:55:
 * Enforce one effective rolling upstream-integration candidate.
 * When candidateUpstreamSha != upstreamHead, mark REFRESH_REQUIRED and supersede
 * obsolete automation/upstream-* PRs instead of finishing an obsolete candidate as "current".
 */
import { evaluateFreshness, shaEquals } from "./freshness.mjs";

export { shaEquals };

/**
 * Parse upstream SHA embedded in automation/upstream-<sha12> branch names.
 * @param {string} headRefName
 */
export function parseUpstreamShaFromBranch(headRefName) {
  const m = String(headRefName || "").match(/^automation\/upstream-([0-9a-f]{7,40})$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * @param {{
 *   upstreamHead: string,
 *   openAutomationPrs: Array<{
 *     number: number,
 *     headRefName: string,
 *     headSha?: string,
 *     candidateUpstreamSha?: string|null,
 *     labels?: string[],
 *     updatedAt?: string,
 *   }>,
 * }} input
 */
export function selectRollingCandidate(input) {
  const upstreamHead = String(input.upstreamHead || "").trim().toLowerCase();
  const prs = Array.isArray(input.openAutomationPrs) ? input.openAutomationPrs : [];

  /** @type {typeof prs} */
  const current = [];
  /** @type {typeof prs} */
  const obsolete = [];

  for (const pr of prs) {
    const fromBranch = parseUpstreamShaFromBranch(pr.headRefName);
    const cand = (pr.candidateUpstreamSha || fromBranch || "").toLowerCase();
    const entry = { ...pr, candidateUpstreamSha: cand || null };
    if (cand && shaEquals(cand, upstreamHead)) current.push(entry);
    else obsolete.push(entry);
  }

  // Prefer a single current PR; if multiple match tip, keep newest updatedAt/highest number.
  current.sort((a, b) => Number(b.number) - Number(a.number));
  const active = current[0] || null;
  const duplicateCurrent = current.slice(1);

  return {
    upstreamHead,
    activeCandidate: active,
    obsoleteCandidates: [...obsolete, ...duplicateCurrent],
    refreshRequired: obsolete.length > 0 && !active
      ? true
      : Boolean(active && active.candidateUpstreamSha && !shaEquals(active.candidateUpstreamSha, upstreamHead)),
    multipleCurrent: current.length > 1,
  };
}

/**
 * Decide close/comment actions for obsolete automation PRs.
 * Never merges obsolete PRs. Safe supersede only.
 *
 * @param {ReturnType<typeof selectRollingCandidate>} selection
 * @param {{ dryRun?: boolean, newPrNumber?: number|null, newUpstreamSha?: string|null }} [opts]
 */
export function planSupersedeObsolete(selection, opts = {}) {
  const actions = [];
  for (const pr of selection.obsoleteCandidates) {
    const body = [
      "## Superseded by rolling upstream candidate",
      "",
      `This automation PR targets upstream \`${pr.candidateUpstreamSha || "unknown"}\`.`,
      `Current Runfusion/Fusion HEAD is \`${selection.upstreamHead}\`.`,
      "",
      "Closing as obsolete. Do not merge this PR as \"current\".",
      opts.newPrNumber
        ? `Replacement candidate: #${opts.newPrNumber} (upstream \`${opts.newUpstreamSha || selection.upstreamHead}\`).`
        : "AUTO-1 will open/refresh a candidate for the live upstream HEAD.",
      "",
      "FNXC:UpstreamRollingCandidate — stale candidates must not remain the effective integration path.",
    ].join("\n");
    actions.push({
      type: "supersede-close",
      prNumber: pr.number,
      headRefName: pr.headRefName,
      candidateUpstreamSha: pr.candidateUpstreamSha,
      comment: body,
      dryRun: opts.dryRun === true,
    });
  }
  return {
    refreshRequired: selection.refreshRequired || selection.obsoleteCandidates.length > 0,
    activeCandidate: selection.activeCandidate,
    actions,
  };
}

/**
 * Finalizer race guard: refuse merge-as-current when candidate upstream ≠ live tip
 * OR candidate Appsolino base ≠ live Appsolino main.
 *
 * FNXC:UpstreamRollingCandidate 2026-08-07-05:55:
 * Dual race: upstream can move AND Appsolino main can move (e.g. #124 merges) while a
 * candidate is open. Either mismatch requires REFRESH_REQUIRED and reconstruction.
 *
 * @param {{
 *   candidateUpstreamSha: string|null|undefined,
 *   liveUpstreamHead: string|null|undefined,
 *   candidateBaseAppsolinoSha?: string|null|undefined,
 *   liveAppsolinoMain?: string|null|undefined,
 *   allowRefresh?: boolean,
 * }} input
 */
export function assertFinalizerFreshness(input) {
  const cand = input.candidateUpstreamSha ? String(input.candidateUpstreamSha).trim().toLowerCase() : null;
  const live = input.liveUpstreamHead ? String(input.liveUpstreamHead).trim().toLowerCase() : null;
  if (!live) {
    return {
      ok: false,
      action: "BLOCKED_UNRESOLVED",
      reason: "live upstream HEAD unavailable immediately before finalize",
    };
  }
  if (!cand) {
    return {
      ok: false,
      action: "BLOCKED_UNRESOLVED",
      reason: "candidate upstream SHA unknown — refuse merge-as-current",
    };
  }
  if (!shaEquals(cand, live)) {
    return {
      ok: false,
      action: "REFRESH_REQUIRED",
      reason: `candidate upstream ${cand.slice(0, 12)} != live upstream ${live.slice(0, 12)} — refresh before merge`,
      mismatch: "upstream",
    };
  }

  const baseCand = input.candidateBaseAppsolinoSha
    ? String(input.candidateBaseAppsolinoSha).trim().toLowerCase()
    : null;
  const liveMain = input.liveAppsolinoMain
    ? String(input.liveAppsolinoMain).trim().toLowerCase()
    : null;

  // When either side of the Appsolino-base pair is provided, both must be present and match.
  // FNXC:UpstreamRollingCandidate 2026-08-07-05:55:
  // Unknown base with a known live main is fail-closed for merge-as-current (candidate must record base).
  if (baseCand || liveMain) {
    if (!liveMain) {
      return {
        ok: false,
        action: "BLOCKED_UNRESOLVED",
        reason: "live Appsolino main unavailable immediately before finalize",
        mismatch: "appsolino-base",
      };
    }
    if (!baseCand) {
      return {
        ok: false,
        action: "BLOCKED_UNRESOLVED",
        reason: "candidate Appsolino base SHA unknown — refuse merge-as-current",
        mismatch: "appsolino-base",
      };
    }
    if (!shaEquals(baseCand, liveMain)) {
      return {
        ok: false,
        action: "REFRESH_REQUIRED",
        reason: `candidate Appsolino base ${baseCand.slice(0, 12)} != live Appsolino main ${liveMain.slice(0, 12)} — refresh before merge`,
        mismatch: "appsolino-base",
      };
    }
  }

  return {
    ok: true,
    action: "CONTINUE",
    reason: liveMain
      ? "candidate matches live upstream HEAD and Appsolino main"
      : "candidate matches live upstream HEAD",
  };
}

/**
 * @param {{
 *   upstreamHead: string,
 *   integratedUpstreamSha: string|null,
 *   selection: ReturnType<typeof selectRollingCandidate>,
 *   auto2Action?: string|null,
 *   expertActive?: boolean,
 *   commitsBehindIntegrated?: number|null,
 * }} input
 */
export function freshnessFromRollingSelection(input) {
  const active = input.selection.activeCandidate;
  return evaluateFreshness({
    upstreamHead: input.upstreamHead,
    integratedUpstreamSha: input.integratedUpstreamSha,
    candidateUpstreamSha: active?.candidateUpstreamSha || null,
    candidateAppsolinoSha: null,
    commitsBehindIntegrated: input.commitsBehindIntegrated,
    activeCandidatePr: active?.number ?? null,
    auto2Action: input.auto2Action,
    expertActive: input.expertActive,
  });
}
