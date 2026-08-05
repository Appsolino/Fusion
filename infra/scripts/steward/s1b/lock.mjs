#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-05:
 * One repair per fingerprint+occurrence (in-process registry).
 */
import { repairOccurrenceKey } from "./policy.mjs";

/** @type {Map<string, { prNumber: number|null, prUrl: string|null, branchName: string, repairHeadSha: string, issueNumber: number }>} */
const repairRegistry = new Map();

export function getRepairRegistry() {
  return repairRegistry;
}

/** Test helper. */
export function clearRepairRegistry() {
  repairRegistry.clear();
}

/**
 * @param {string} fingerprint
 * @param {string} occurrence
 */
export function lookupRepair(fingerprint, occurrence) {
  const key = repairOccurrenceKey(fingerprint, occurrence);
  return { key, entry: repairRegistry.get(key) || null };
}

/**
 * @param {{
 *   fingerprint: string,
 *   occurrence: string,
 *   prNumber: number|null,
 *   prUrl?: string|null,
 *   branchName: string,
 *   repairHeadSha: string,
 *   issueNumber: number,
 * }} input
 */
export function registerRepair(input) {
  const key = repairOccurrenceKey(input.fingerprint, input.occurrence);
  const entry = {
    prNumber: input.prNumber,
    prUrl: input.prUrl || null,
    branchName: input.branchName,
    repairHeadSha: input.repairHeadSha,
    issueNumber: input.issueNumber,
  };
  repairRegistry.set(key, entry);
  return { key, entry };
}
