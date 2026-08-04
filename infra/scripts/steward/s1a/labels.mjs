#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Label transitions among S1A stewardship labels.
 */
import { REVIEW_VERDICT, RISK_LEVEL, S1A_LABELS, S1A_LABEL_LIST } from "./policy.mjs";

/**
 * @typedef {{
 *   getIssueLabels: (number: number) => Promise<string[]>,
 *   addLabels: (number: number, labels: string[]) => Promise<void>,
 *   removeLabels: (number: number, labels: string[]) => Promise<void>,
 *   ensureLabelsExist?: (labels: string[]) => Promise<void>,
 * }} LabelClient
 */

/**
 * Decide target S1A labels from pipeline outcome (exclusive terminal states).
 * Always clears needs-expert + expert-running when settling.
 * @param {{
 *   reviewVerdict: string,
 *   assessment: {
 *     risk?: string,
 *     criticalFreeze?: boolean,
 *     needsMoreEvidence?: boolean,
 *     repairRecommended?: boolean,
 *   },
 *   failed?: boolean,
 * }} input
 * @returns {{ add: string[], remove: string[] }}
 */
export function planLabelTransition(input) {
  /** @type {string[]} */
  const remove = [
    S1A_LABELS.NEEDS_EXPERT,
    S1A_LABELS.EXPERT_RUNNING,
  ];
  /** @type {string[]} */
  const add = [];

  if (input.failed) {
    add.push(S1A_LABELS.EXPERT_FAILED);
    return { add, remove };
  }

  const a = input.assessment || {};
  if (
    input.reviewVerdict === REVIEW_VERDICT.NEEDS_MORE_EVIDENCE ||
    a.needsMoreEvidence
  ) {
    add.push(S1A_LABELS.NEEDS_EVIDENCE);
    return { add, remove };
  }

  if (a.criticalFreeze || a.risk === RISK_LEVEL.CRITICAL) {
    add.push(S1A_LABELS.OWNER_REQUIRED);
    add.push(S1A_LABELS.ADVICE_READY);
    return { add, remove };
  }

  if (input.reviewVerdict === REVIEW_VERDICT.ACCEPT) {
    add.push(S1A_LABELS.ADVICE_READY);
    if (a.repairRecommended) {
      add.push(S1A_LABELS.REPAIR_RECOMMENDED);
    }
    if (a.risk === RISK_LEVEL.SENSITIVE) {
      add.push(S1A_LABELS.OWNER_REQUIRED);
    }
    return { add, remove };
  }

  // REJECT after revision budget exhausted → owner / failed
  add.push(S1A_LABELS.EXPERT_FAILED);
  add.push(S1A_LABELS.OWNER_REQUIRED);
  return { add, remove };
}

/**
 * Apply planned transition. Removes competing S1A terminal labels first.
 * @param {LabelClient} client
 * @param {number} issueNumber
 * @param {{ add: string[], remove: string[] }} plan
 */
export async function applyLabelTransition(client, issueNumber, plan) {
  if (client.ensureLabelsExist) {
    await client.ensureLabelsExist([...S1A_LABEL_LIST]);
  }

  const current = await client.getIssueLabels(issueNumber);
  const terminalCompetitors = S1A_LABEL_LIST.filter(
    (l) =>
      l !== S1A_LABELS.NEEDS_EXPERT &&
      l !== S1A_LABELS.EXPERT_RUNNING &&
      !plan.add.includes(l),
  );
  const toRemove = [
    ...new Set([...plan.remove, ...terminalCompetitors.filter((l) => current.includes(l))]),
  ];
  if (toRemove.length) {
    await client.removeLabels(issueNumber, toRemove);
  }
  if (plan.add.length) {
    await client.addLabels(issueNumber, plan.add);
  }
  const after = await client.getIssueLabels(issueNumber);
  return { added: plan.add, removed: toRemove, labels: after };
}

/**
 * In-memory label client for tests.
 * @param {Map<number, string[]> | Record<number, string[]>} [seed]
 */
export function createMemoryLabelClient(seed = {}) {
  /** @type {Map<number, Set<string>>} */
  const map = new Map();
  const entries =
    seed instanceof Map ? seed.entries() : Object.entries(seed).map(([k, v]) => [Number(k), v]);
  for (const [num, labels] of entries) {
    map.set(Number(num), new Set(labels || []));
  }
  return {
    map,
    async getIssueLabels(number) {
      return [...(map.get(number) || new Set())];
    },
    async addLabels(number, labels) {
      const set = map.get(number) || new Set();
      for (const l of labels) set.add(l);
      map.set(number, set);
    },
    async removeLabels(number, labels) {
      const set = map.get(number) || new Set();
      for (const l of labels) set.delete(l);
      map.set(number, set);
    },
    async ensureLabelsExist() {
      /* no-op in memory */
    },
  };
}
