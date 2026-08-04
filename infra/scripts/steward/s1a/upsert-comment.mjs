#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Idempotent assessment comment upsert by fingerprint + occurrence marker.
 * Same fingerprint+occurrence → no duplicate; new evidence (new occurrence) → new comment.
 * Revision after reviewer REJECT may post a new comment with same occurrence but higher attempt
 * only when prior was REJECT-marked; otherwise noop when identical key exists and accepted.
 */
import { extractAssessmentMarker } from "./policy.mjs";

/**
 * @typedef {{
 *   id: number,
 *   body: string,
 *   user?: string,
 * }} CommentLike
 */

/**
 * @typedef {{
 *   listComments: (issueNumber: number) => Promise<CommentLike[]>,
 *   createComment: (issueNumber: number, body: string) => Promise<CommentLike>,
 *   updateComment?: (commentId: number, body: string) => Promise<CommentLike>,
 * }} CommentClient
 */

/**
 * Find existing assessment comment for fingerprint+occurrence.
 * @param {CommentLike[]} comments
 * @param {string} fingerprint
 * @param {string} occurrence
 */
export function findAssessmentComment(comments, fingerprint, occurrence) {
  const fp = String(fingerprint || "").toLowerCase();
  const occ = String(occurrence || "").trim();
  return (comments || []).find((c) => {
    const m = extractAssessmentMarker(c.body || "");
    return m && m.fingerprint === fp && m.occurrence === occ;
  }) || null;
}

/**
 * @param {CommentClient} client
 * @param {{
 *   issueNumber: number,
 *   fingerprint: string,
 *   occurrence: string,
 *   body: string,
 *   forceRevision?: boolean,
 * }} input
 */
export async function upsertAssessmentComment(client, input) {
  const comments = await client.listComments(input.issueNumber);
  const existing = findAssessmentComment(
    comments,
    input.fingerprint,
    input.occurrence,
  );

  if (existing && !input.forceRevision) {
    return {
      action: "noop-duplicate-assessment",
      commentId: existing.id,
      issueNumber: input.issueNumber,
    };
  }

  if (existing && input.forceRevision && client.updateComment) {
    const updated = await client.updateComment(existing.id, input.body);
    return {
      action: "revise-assessment",
      commentId: updated.id,
      issueNumber: input.issueNumber,
    };
  }

  // New occurrence or forced revision without update API → create (revision comment).
  const created = await client.createComment(input.issueNumber, input.body);
  return {
    action: existing ? "revision-comment" : "create",
    commentId: created.id,
    issueNumber: input.issueNumber,
  };
}

/**
 * In-memory comment client for tests.
 * @param {CommentLike[]} [seed]
 */
export function createMemoryCommentClient(seed = []) {
  /** @type {CommentLike[]} */
  const comments = seed.map((c) => ({ ...c }));
  let next = Math.max(0, ...comments.map((c) => c.id), 0) + 1;
  return {
    comments,
    async listComments() {
      return comments.slice();
    },
    async createComment(_issueNumber, body) {
      const c = { id: next++, body, user: "steward-s1a" };
      comments.push(c);
      return c;
    },
    async updateComment(commentId, body) {
      const c = comments.find((x) => x.id === commentId);
      if (!c) throw new Error(`comment ${commentId} not found`);
      c.body = body;
      return c;
    },
  };
}
