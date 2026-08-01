/**
 * Shared contracts for clearing an explicit DUPLICATE: marker without a real plan.
 *
 * FNXC:NearDuplicateDetection 2026-08-01-18:47:
 * Clearing a DUPLICATE marker must leave needs-replan + durable feedback +
 * nearDuplicateDismissed — never status:null. status:null is the planning-finished
 * signal the scheduler wakes on, so a prompt-less null-status card re-dispatches,
 * FS-fails, and storms (observed on FN-8704 / inactive FN-8676).
 */

/** Log action picked up by triage's needs-replan feedback scanner. */
export const TRIAGE_MARKER_CLEARED_REPLAN_LOG_ACTION = "Duplicate marker cleared for re-specification";

export function buildInactiveDuplicateClearFeedback(canonicalId: string): string {
  return `Explicit duplicate marker targeting ${canonicalId} was cleared because that task is missing, deleted, done, or archived. Write a full PROMPT.md for this work. Do not re-emit DUPLICATE: ${canonicalId}.`;
}

export function buildKeepDuplicateClearFeedback(canonicalId: string): string {
  return `Duplicate marker for ${canonicalId} was cleared (Keep / keep-acknowledged). Write a full PROMPT.md for this work. Do not re-emit DUPLICATE: ${canonicalId}.`;
}

/** Patch applied when a marker is cleared so the card is unplanned, not "planning finished". */
export function buildMarkerClearedReplanTaskPatch(canonicalId: string): {
  paused: false;
  pausedReason: null;
  status: "needs-replan";
  error: null;
  sourceMetadataPatch: {
    nearDuplicateOf: string;
    nearDuplicateScore: number;
    duplicateSource: "triage-marker";
    nearDuplicateDismissed: true;
  };
} {
  return {
    paused: false,
    pausedReason: null,
    status: "needs-replan",
    error: null,
    sourceMetadataPatch: {
      nearDuplicateOf: canonicalId,
      nearDuplicateScore: 1,
      duplicateSource: "triage-marker",
      nearDuplicateDismissed: true,
    },
  };
}
