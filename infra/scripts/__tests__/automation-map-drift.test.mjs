#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-20:04:
 * Deterministic drift guard: AUTOMATION-MAP.json mechanicallyChecked entries must match
 * workflow YAML name / on-triggers / concurrency group / cancel-in-progress.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const mapPath = join(root, "docs/appsolino/upstream/AUTOMATION-MAP.json");

/**
 * Minimal YAML field extraction for our workflow front-matter (no full YAML parser).
 * @param {string} text
 */
export function extractWorkflowMechanics(text) {
  const nameMatch = text.match(/^name:\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, "") : null;

  /** @type {string[]} */
  const triggers = [];
  const onIdx = text.search(/^on:\s*$/m);
  if (onIdx >= 0) {
    const after = text.slice(onIdx + 3);
    const nextTop = after.search(/\n(?=[a-zA-Z])/);
    const block = nextTop >= 0 ? after.slice(0, nextTop) : after.slice(0, 800);
    if (/^\s*workflow_dispatch\s*:/m.test(block) || /^\s*-\s*workflow_dispatch\b/m.test(block) || /workflow_dispatch\s*$/m.test(block)) {
      triggers.push("workflow_dispatch");
    }
    if (/^\s*schedule\s*:/m.test(block)) triggers.push("schedule");
    if (/^\s*pull_request\s*:/m.test(block)) triggers.push("pull_request");
    if (/^\s*workflow_run\s*:/m.test(block)) triggers.push("workflow_run");
    // Shorthand: on: [push, pull_request]
    const short = block.match(/on:\s*\[([^\]]+)\]/);
    if (short) {
      for (const part of short[1].split(",")) {
        const t = part.trim().replace(/['"]/g, "");
        if (t && !triggers.includes(t)) triggers.push(t);
      }
    }
  }

  const concIdx = text.search(/^concurrency:\s*$/m);
  let concurrencyGroup = null;
  let cancelInProgress = null;
  if (concIdx >= 0) {
    const after = text.slice(concIdx);
    const groupMatch = after.match(/^\s*group:\s*(.+)$/m);
    concurrencyGroup = groupMatch ? groupMatch[1].trim() : null;
    const cancelMatch = after.match(/^\s*cancel-in-progress:\s*(true|false)\s*$/m);
    cancelInProgress = cancelMatch ? cancelMatch[1] === "true" : null;
  }

  return { name, triggers: [...new Set(triggers)].sort(), concurrencyGroup, cancelInProgress };
}

describe("automation-map-drift", () => {
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  const checked = (map.workflows || []).filter((w) => w.mechanicallyChecked === true);
  assert.ok(checked.length >= 5, "expected mechanicallyChecked workflow entries");

  for (const entry of checked) {
    it(`${entry.file} matches map`, () => {
      const yaml = readFileSync(join(root, entry.file), "utf8");
      const mech = extractWorkflowMechanics(yaml);
      assert.equal(mech.name, entry.name, `name drift in ${entry.file}`);
      assert.equal(mech.concurrencyGroup, entry.concurrencyKey, `concurrencyKey drift in ${entry.file}`);
      assert.equal(mech.cancelInProgress, entry.cancelInProgress, `cancelInProgress drift in ${entry.file}`);
      const expectedTriggers = [...entry.triggers].sort();
      for (const t of expectedTriggers) {
        assert.ok(
          mech.triggers.includes(t),
          `${entry.file}: missing trigger ${t} (found ${mech.triggers.join(",")})`,
        );
      }
    });
  }
});
