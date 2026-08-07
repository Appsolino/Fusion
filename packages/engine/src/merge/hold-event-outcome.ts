/**
 * FNXC:FullAutonomy 2026-08-07-21:10:
 * Map GitHub PR reconcile event tags onto hold-node outcome values so the
 * resumed graph can traverse `outcome:approved`, `outcome:checks-failed`, and
 * other routable PR event edges without teaching the scheduler PR semantics.
 * The outcome uses the existing task sourceMetadata envelope because workflow
 * custom fields are operator schema data and reject internal continuation keys.
 */
export const PENDING_HOLD_OUTCOME_FIELD = "workflowExternalEventOutcome";

const GITHUB_PR_EVENT_PREFIX = "github:pr-";

/** Parse `github:pr-<event>` to the outcome value accepted by graph edges. */
export function parseGithubPrHoldEventTag(eventTag: string): string | null {
  const tag = String(eventTag || "").trim();
  if (!tag.startsWith(GITHUB_PR_EVENT_PREFIX)) return null;
  const value = tag.slice(GITHUB_PR_EVENT_PREFIX.length).trim();
  return /^[a-z][a-z0-9-]*$/.test(value) ? value : null;
}

export function pendingHoldOutcomeMetadataPatch(outcome: string | null): Record<string, unknown> {
  return { [PENDING_HOLD_OUTCOME_FIELD]: outcome };
}
