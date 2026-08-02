#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * CLI entry for S0 observation. Modes: fixture-replay, event-file, reconcile-file.
 * Never dispatches workflows, never SSHes Host D/P, never checks out candidates.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectFromEvent,
  collectFromFixture,
  listFixtureNames,
} from "./collect-evidence.mjs";
import { reconcileRuns, mergeCandidatesIdempotent } from "./reconcile-runs.mjs";
import { createMemoryIssueClient, upsertIncident } from "./upsert-incident.mjs";
import { STEWARD_PHASE, S0_FORBIDDEN } from "./policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES = join(HERE, "__tests__", "fixtures");

function usage() {
  return `Usage:
  node run-observation.mjs --mode=fixture-replay [--fixtures-dir=DIR] [--out=FILE]
  node run-observation.mjs --mode=event-file --input=FILE [--out=FILE]
  node run-observation.mjs --mode=reconcile-file --input=FILE [--out=FILE]
  node run-observation.mjs --mode=upsert-dry-run --input=FILE [--out=FILE]

S0 forbids: ${S0_FORBIDDEN.join(", ")}
`;
}

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = { mode: "" };
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--mode=")) out.mode = a.slice(7);
    else if (a.startsWith("--fixtures-dir=")) out.fixturesDir = a.slice(15);
    else if (a.startsWith("--input=")) out.input = a.slice(8);
    else if (a.startsWith("--out=")) out.out = a.slice(6);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.mode) {
    process.stdout.write(usage());
    process.exit(args.help ? 0 : 2);
  }

  let result;
  if (args.mode === "fixture-replay") {
    result = await runFixtureReplay(String(args.fixturesDir || DEFAULT_FIXTURES));
  } else if (args.mode === "event-file") {
    const input = JSON.parse(readFileSync(String(args.input), "utf8"));
    result = { phase: STEWARD_PHASE, ...collectFromEvent(input) };
  } else if (args.mode === "reconcile-file") {
    const input = JSON.parse(readFileSync(String(args.input), "utf8"));
    const once = reconcileRuns(input);
    const twice = reconcileRuns(input);
    result = {
      phase: STEWARD_PHASE,
      once,
      twice,
      idempotent: JSON.stringify(once.candidates.map((c) => c.instance.occurrenceId).sort())
        === JSON.stringify(twice.candidates.map((c) => c.instance.occurrenceId).sort()),
      merged: mergeCandidatesIdempotent(once.candidates, twice.candidates),
    };
  } else if (args.mode === "upsert-dry-run") {
    const input = JSON.parse(readFileSync(String(args.input), "utf8"));
    const client = createMemoryIssueClient();
    const collected = Array.isArray(input.candidates)
      ? input.candidates
      : [collectFromEvent(input).normalized];
    const actions = [];
    for (const n of collected) {
      actions.push(await upsertIncident(client, n));
    }
    // Second pass proves occurrence idempotency.
    for (const n of collected) {
      actions.push(await upsertIncident(client, n));
    }
    result = {
      phase: STEWARD_PHASE,
      actions,
      issues: client.issues.map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        bodyLength: (i.body || "").length,
      })),
    };
  } else {
    throw new Error(`unknown mode: ${args.mode}`);
  }

  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (args.out) {
    const outPath = resolve(String(args.out));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text, "utf8");
  } else {
    process.stdout.write(text);
  }
}

/**
 * @param {string} fixturesDir
 */
async function runFixtureReplay(fixturesDir) {
  const names = listFixtureNames(fixturesDir);
  const client = createMemoryIssueClient();
  const rows = [];

  for (const name of names) {
    const collected = collectFromFixture(join(fixturesDir, name));
    const { normalized, expected } = collected;
    let upsert = null;
    if (normalized.openIncident) {
      upsert = await upsertIncident(client, normalized);
      // Duplicate delivery of same occurrence must noop.
      const dup = await upsertIncident(client, normalized);
      upsert = { first: upsert, duplicate: dup };
    }

    const row = {
      fixture: name,
      openIncident: normalized.openIncident,
      failureClass: normalized.failureClass,
      fingerprint: normalized.fingerprint,
      fingerprintPayload: normalized.fingerprintPayload,
      expected,
      expectOk: assertExpected(normalized, expected),
      upsert,
    };
    rows.push(row);
  }

  return {
    phase: STEWARD_PHASE,
    fixturesDir,
    rows,
    issueCount: client.issues.length,
    allExpectOk: rows.every((r) => r.expectOk),
  };
}

/**
 * @param {import("./normalize-evidence.mjs").normalizeEvidence extends Function ? any : any} normalized
 * @param {Record<string, unknown>|null} expected
 */
function assertExpected(normalized, expected) {
  if (!expected) return true;
  if (expected.incident === false) {
    return normalized.openIncident === false;
  }
  if (expected.failureClass && expected.failureClass !== normalized.failureClass) {
    return false;
  }
  if (expected.fingerprintPayload) {
    const p = normalized.fingerprintPayload || {};
    for (const [k, v] of Object.entries(expected.fingerprintPayload)) {
      if (String(p[k]) !== String(v)) return false;
    }
  }
  if (expected.incident === true && !normalized.openIncident) return false;
  return true;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
