#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamLatency 2026-08-07-14:10:
 * REQUEST_CHANGES targeting + non-convergence detection for repair loops.
 * Same semantic requiredChanges twice with no meaningful delta → NON_CONVERGING_LOOP.
 * Empty expert delta while REQUEST_CHANGES open → stop immediately.
 */

/**
 * @param {string[]|null|undefined} changes
 * @returns {string}
 */
export function normalizeRequiredChangesSignature(changes) {
  return (Array.isArray(changes) ? changes : [])
    .map((s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean)
    .sort()
    .join("|");
}

/**
 * Track OPEN / RESOLVED / STILL_FAILING / SUPERSEDED for each required change.
 * @param {string[]} priorOpen
 * @param {string[]} nextRequired
 * @param {{ hadMeaningfulDelta?: boolean }} [opts]
 */
export function trackRequiredChangeStatus(priorOpen = [], nextRequired = [], opts = {}) {
  const prior = [...new Set((priorOpen || []).map((s) => String(s).trim()).filter(Boolean))];
  const next = [...new Set((nextRequired || []).map((s) => String(s).trim()).filter(Boolean))];
  const nextLower = new Set(next.map((s) => s.toLowerCase()));
  /** @type {{ text: string, status: string }[]} */
  const items = [];
  for (const p of prior) {
    if (nextLower.has(p.toLowerCase())) {
      items.push({ text: p, status: opts.hadMeaningfulDelta === false ? "STILL_FAILING" : "OPEN" });
    } else {
      items.push({ text: p, status: "RESOLVED" });
    }
  }
  const priorLower = new Set(prior.map((s) => s.toLowerCase()));
  for (const n of next) {
    if (!priorLower.has(n.toLowerCase())) {
      items.push({ text: n, status: prior.length ? "SUPERSEDED" : "OPEN" });
      // New items after a prior set are OPEN (new reviewer asks), not SUPERSEDED of old.
      // SUPERSEDED means the old item was replaced — mark new as OPEN.
      items[items.length - 1].status = "OPEN";
    }
  }
  return {
    items,
    open: items.filter((i) => i.status === "OPEN" || i.status === "STILL_FAILING").map((i) => i.text),
    signature: normalizeRequiredChangesSignature(next),
  };
}

/**
 * @param {{
 *   priorSignature: string|null,
 *   nextSignature: string,
 *   hadMeaningfulDelta: boolean,
 *   repeatCount?: number,
 * }} input
 */
export function detectNonConvergence(input) {
  const next = input.nextSignature || "";
  const prior = input.priorSignature || "";
  if (!next || !prior) {
    return { nonConverging: false, repeatCount: 0 };
  }
  if (next === prior && input.hadMeaningfulDelta === false) {
    const repeatCount = (input.repeatCount || 1) + 1;
    return {
      nonConverging: repeatCount >= 2,
      repeatCount,
      classification: "REPAIR_NON_CONVERGENCE",
      next: "NON_CONVERGING_LOOP",
      reason:
        "same semantic requiredChanges returned twice with no meaningful candidate delta — stop blind retry",
    };
  }
  return { nonConverging: false, repeatCount: next === prior ? (input.repeatCount || 0) + 1 : 0 };
}

/**
 * Summarize prior attempts for prompts — do not grow unbounded context.
 * @param {object[]} attempts
 * @param {number} [max]
 */
export function summarizePreviousAttempts(attempts, max = 3) {
  const list = Array.isArray(attempts) ? attempts.slice(-max) : [];
  return list.map((a) => ({
    attempt: a.attempt,
    phase: a.phase,
    next: a.next || null,
    verifierVerdict: a.verifierVerdict || null,
    testsPassed: a.testsPassed ?? null,
    requiredChanges: (a.requiredChanges || []).slice(0, 12),
    expertDecision: a.expertDecision || null,
    reason: a.reason ? String(a.reason).slice(0, 240) : null,
    latencyMs: a.latencyMs ?? a.expertLatencyMs ?? a.verifierLatencyMs ?? null,
  }));
}

/**
 * Build targeted repair instruction block for expert prompt.
 * @param {string[]} requiredChanges
 * @param {{ acceptedAreas?: string[] }} [opts]
 */
export function buildTargetedRepairInstructions(requiredChanges, opts = {}) {
  const changes = (requiredChanges || []).map((s) => String(s).trim()).filter(Boolean);
  if (!changes.length) return "";
  const accepted = (opts.acceptedAreas || []).filter(Boolean);
  return [
    "TARGETED REPAIR — previous candidate already passed deterministic gates and/or accepted areas.",
    "Fix ONLY these unresolved reviewer requirements:",
    ...changes.map((c, i) => `${i + 1}. ${c}`),
    accepted.length ? `Do not re-investigate already accepted areas: ${accepted.join("; ")}` : "",
    "Do not re-litigate the entire candidate. Prefer minimal delta.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {{ filesChanged?: string[], diffText?: string, porcelain?: string }} evidence
 */
export function hasMeaningfulCandidateDelta(evidence = {}) {
  const files = Array.isArray(evidence.filesChanged) ? evidence.filesChanged.filter(Boolean) : [];
  if (files.length > 0) return true;
  const diff = String(evidence.diffText || "").trim();
  if (diff.length > 40) return true; // more than a header stub
  const porcelain = String(evidence.porcelain || "").trim();
  return porcelain.length > 0;
}
