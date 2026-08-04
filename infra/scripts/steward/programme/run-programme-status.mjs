#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardProgramme 2026-08-04:
 * Print programme status (live main + ledger + activation).
 *
 *   node run-programme-status.mjs [--repo-root=.]
 */
import { fileURLToPath } from "node:url";
import { loadLedger, resolveLiveMainSha } from "./ledger.mjs";
import { summarizeActivation } from "../activation/resolve-activation.mjs";

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

export function buildProgrammeStatus(opts = {}) {
  const ledger = loadLedger(opts.ledgerPath);
  const liveMainSha = opts.liveMainSha || resolveLiveMainSha({ cwd: opts.repoRoot });
  const activation = summarizeActivation({ env: opts.env });
  return {
    ok: true,
    programme: ledger.programme,
    trackingIssue: ledger.trackingIssue,
    liveMainSha,
    s1aImplementationBaselineSha: ledger.s1aImplementationBaselineSha,
    documentationClosureMergeSha: ledger.documentationClosureMergeSha,
    startMainSha: ledger.startMainSha,
    activePhase: ledger.activePhase,
    phases: ledger.phases,
    activation,
    openOwnerActions: ledger.openOwnerActions || [],
    providerPins: ledger.providerPins,
    hostP: ledger.hostP,
  };
}

if (isMain) {
  let repoRoot = process.cwd();
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--repo-root=")) repoRoot = a.slice("--repo-root=".length);
  }
  const status = buildProgrammeStatus({ repoRoot });
  console.log(JSON.stringify(status, null, 2));
}
