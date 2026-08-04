#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Fingerprint+occurrence advisory lock via GitHub label + in-process map
 * (concurrent unit tests / same-process races).
 */
import { S1A_LABELS } from "./policy.mjs";

/** @type {Map<string, { issueNumber: number, acquiredAt: number }>} */
const processLocks = new Map();

/**
 * @param {string} fingerprint
 * @param {string} occurrence
 */
export function lockKey(fingerprint, occurrence) {
  return `${String(fingerprint || "").toLowerCase()}::${String(occurrence || "").trim()}`;
}

/**
 * @returns {Map<string, { issueNumber: number, acquiredAt: number }>}
 */
export function getProcessLockMap() {
  return processLocks;
}

/** Test helper — clear in-process locks. */
export function clearProcessLocks() {
  processLocks.clear();
}

/**
 * @typedef {{
 *   getIssueLabels: (number: number) => Promise<string[]>,
 *   addLabels: (number: number, labels: string[]) => Promise<void>,
 *   removeLabels: (number: number, labels: string[]) => Promise<void>,
 * }} LabelClient
 */

/**
 * Acquire expert-running lock.
 * @param {LabelClient} client
 * @param {{
 *   issueNumber: number,
 *   fingerprint: string,
 *   occurrence: string,
 * }} input
 */
export async function acquireLock(client, input) {
  const key = lockKey(input.fingerprint, input.occurrence);
  if (processLocks.has(key)) {
    return {
      acquired: false,
      reason: "process-lock-held",
      key,
    };
  }

  const labels = await client.getIssueLabels(input.issueNumber);
  if (labels.includes(S1A_LABELS.EXPERT_RUNNING)) {
    return {
      acquired: false,
      reason: "label-lock-held",
      key,
    };
  }

  processLocks.set(key, {
    issueNumber: input.issueNumber,
    acquiredAt: Date.now(),
  });

  try {
    await client.addLabels(input.issueNumber, [S1A_LABELS.EXPERT_RUNNING]);
  } catch (err) {
    processLocks.delete(key);
    throw err;
  }

  // Re-check after add for races that land the label from another worker.
  const after = await client.getIssueLabels(input.issueNumber);
  const runningCount = after.filter((l) => l === S1A_LABELS.EXPERT_RUNNING).length;
  if (!after.includes(S1A_LABELS.EXPERT_RUNNING)) {
    processLocks.delete(key);
    return { acquired: false, reason: "label-add-failed", key };
  }

  return {
    acquired: true,
    reason: "ok",
    key,
    labels: after,
    runningCount,
  };
}

/**
 * Release expert-running lock.
 * @param {LabelClient} client
 * @param {{
 *   issueNumber: number,
 *   fingerprint: string,
 *   occurrence: string,
 * }} input
 */
export async function releaseLock(client, input) {
  const key = lockKey(input.fingerprint, input.occurrence);
  processLocks.delete(key);
  await client.removeLabels(input.issueNumber, [S1A_LABELS.EXPERT_RUNNING]);
  return { released: true, key };
}
