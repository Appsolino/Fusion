#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:HostDTrust 2026-08-06:
 * Durable Host D trust-cycle controller for programme #109.
 * Discovers existing AUTO-3 runs before dispatch. Never depends on Cursor chat waits.
 * Host P credentials must remain unavailable.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TRUST_LEDGER_PATH = join(HERE, "host-d-trust-ledger.json");
export const TRACKING_ISSUE = 109;
export const REPO = "Appsolino/Fusion";

const TRUST_HANDOFF_RE = /\btrust[-_]/i;

/**
 * @param {string} [path]
 */
export function loadTrustLedger(path = TRUST_LEDGER_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {object} ledger
 * @param {string} [path]
 */

/**
 * Resolve trust counters. Prefer top-level `counters` (controller contract),
 * fall back to `trustWindow.counters`, and when both exist take the max of
 * *Pass counts so a partial ledger sync cannot under-count completed proofs.
 * @param {object} ledger
 */
export function resolveTrustCounters(ledger) {
  const a = (ledger && ledger.counters) || {};
  const b = (ledger && ledger.trustWindow && ledger.trustWindow.counters) || {};
  /** @type {Record<string, unknown>} */
  const out = { ...b, ...a };
  for (const key of Object.keys({ ...a, ...b })) {
    if (!/Pass$/i.test(key)) continue;
    const va = Number(a[key]);
    const vb = Number(b[key]);
    const aOk = Number.isFinite(va);
    const bOk = Number.isFinite(vb);
    if (aOk && bOk) out[key] = Math.max(va, vb);
    else if (aOk) out[key] = va;
    else if (bOk) out[key] = vb;
  }
  return out;
}

export function saveTrustLedger(ledger, path = TRUST_LEDGER_PATH) {
  ledger.updatedUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function runCapture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: opts.cwd,
    env: opts.env || process.env,
  });
  return {
    status: r.status ?? 1,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
  };
}

/**
 * @param {{ repo?: string, limit?: number, gh?: typeof runCapture }} [opts]
 * @returns {object[]}
 */
export function listRecentAuto3Runs(opts = {}) {
  const repo = opts.repo || REPO;
  const limit = opts.limit || 30;
  const gh = opts.gh || runCapture;
  const r = gh("gh", [
    "run", "list",
    "--repo", repo,
    "--workflow", "upstream-auto3-deploy.yml",
    "--limit", String(limit),
    "--json", "databaseId,status,conclusion,event,createdAt,updatedAt,headSha,displayTitle",
  ]);
  if (r.status !== 0) {
    throw new Error(`gh run list failed: ${(r.stderr || r.stdout).slice(0, 400)}`);
  }
  return JSON.parse(r.stdout || "[]");
}

/**
 * @param {object} run
 */
export function isTrustProgrammeRun(run) {
  return TRUST_HANDOFF_RE.test(String(run?.displayTitle || ""));
}

/**
 * @param {object[]} runs
 */
export function findInProgressTrustRuns(runs) {
  return (runs || []).filter((r) =>
    isTrustProgrammeRun(r)
    && (r.status === "in_progress" || r.status === "queued" || r.status === "pending" || r.status === "waiting"));
}

/**
 * Classify a completed AUTO-3 trust run from evidence fields + workflow conclusion.
 * @param {{
 *   profile?: string,
 *   forceSmokeFail?: boolean,
 *   evidence?: {
 *     terminal?: string|null,
 *     previousReleaseRestored?: boolean|null,
 *     hostPAccessed?: boolean|null,
 *     health?: string|null,
 *     enginePaused?: boolean|null,
 *     completeness?: { complete?: boolean, needsEvidence?: boolean },
 *   }|null,
 *   workflowConclusion?: string|null,
 *   liveHealthOk?: boolean|null,
 *   liveEnginePaused?: boolean|null,
 * }} input
 */
export function classifyTrustAuto3Result(input) {
  const ev = input.evidence || {};
  const terminal = String(ev.terminal || "").toUpperCase();
  const hostP = ev.hostPAccessed === true;
  if (hostP) {
    return { pass: false, severity: "CRITICAL", reason: "host-p-accessed" };
  }

  if (input.forceSmokeFail || String(input.profile || "") === "proof") {
    if (terminal === "ROLLED_BACK" && ev.previousReleaseRestored === true) {
      const liveOk = input.liveHealthOk !== false;
      const pausedOk = input.liveEnginePaused !== false;
      if (liveOk && pausedOk) {
        return { pass: true, severity: null, reason: "proof-rollback-restored" };
      }
      return { pass: false, severity: "HIGH", reason: "rollback-restored-but-live-unhealthy" };
    }
    if (terminal === "BLOCKED" && /IMMUTABLE_CONFLICT/i.test(String(input.workflowConclusion || ""))) {
      return { pass: false, severity: "MEDIUM", reason: "immutable-conflict", fingerprint: "auto3/immutable-conflict-same-sha-rebuild" };
    }
    if (terminal === "BLOCKED") {
      return { pass: false, severity: "MEDIUM", reason: `blocked:${terminal}` };
    }
  }

  if (terminal === "DEPLOYED" || terminal === "IDEMPOTENT_NOOP") {
    if (ev.completeness?.needsEvidence) {
      return { pass: false, severity: "MEDIUM", reason: "deployed-incomplete-evidence" };
    }
    if (ev.health !== "ok" || ev.enginePaused !== true) {
      // Allow reason-derived fields already on evidence; if still null → incomplete
      if (ev.health == null || ev.enginePaused == null) {
        return { pass: false, severity: "MEDIUM", reason: "deployed-missing-physical-fields" };
      }
      if (ev.health !== "ok" || ev.enginePaused !== true) {
        return { pass: false, severity: "HIGH", reason: "deployed-unhealthy-or-unpaused" };
      }
    }
    return { pass: true, severity: null, reason: terminal.toLowerCase() };
  }

  return {
    pass: false,
    severity: "MEDIUM",
    reason: `unclassified-terminal:${terminal || input.workflowConclusion || "unknown"}`,
  };
}

/**
 * Decide the next controller action. Pure — no side effects.
 * @param {{
 *   ledger: object,
 *   runs: object[],
 *   nowMs?: number,
 * }} input
 */
export function decideNextTrustAction(input) {
  const ledger = input.ledger || {};
  if (ledger.terminal) {
    return { action: "noop-terminal", reason: "programme-already-terminal", detail: ledger.terminal };
  }
  if (ledger.hostP === "PROHIBITED" && ledger.hostPAccessCount > 0) {
    return { action: "stop-critical", reason: "host-p-access-nonzero" };
  }

  const inFlight = findInProgressTrustRuns(input.runs || []);
  if (inFlight.length) {
    return {
      action: "wait-existing",
      reason: "trust-auto3-in-progress",
      runIds: inFlight.map((r) => r.databaseId),
      titles: inFlight.map((r) => r.displayTitle),
    };
  }

  const counters = resolveTrustCounters(ledger);
  const stagingPass = Number(counters.stagingDeploysPass || 0);
  const rollbackPass = Number(counters.proofRollbacksPass || 0);
  const backupPass = Number(counters.backupRestorePass || 0);
  const needStaging = Number(counters.requiredStagingDeploys || 3);
  const needRollback = Number(counters.requiredProofRollbacks || 2);
  const needBackup = Number(counters.requiredBackupRestores || 2);

  // Prefer local Host D proofs on the self-hosted runner before more AUTO-3.
  if (backupPass < needBackup) {
    return { action: "local-backup-restore", reason: `backup-restore ${backupPass}/${needBackup}` };
  }
  if (rollbackPass < needRollback) {
    return {
      action: "dispatch-proof-rollback",
      reason: `proof-rollback ${rollbackPass}/${needRollback}`,
      profile: "proof",
      force_smoke_fail: true,
    };
  }
  if (stagingPass < needStaging) {
    return {
      action: "dispatch-staging-deploy",
      reason: `staging-deploy ${stagingPass}/${needStaging}`,
      profile: "staging",
      force_smoke_fail: false,
    };
  }

  const next = ledger.nextEligible?.action;
  if (next === "process-kill-recovery" || next === "second-backup-restore") {
    return { action: "local-fault-or-backup", reason: String(next) };
  }

  return {
    action: "soak-observe",
    reason: "deploy-rollback-backup-quotas-met-continue-soak",
    trustWindowStartedUtc: ledger.trustWindow?.startedUtc || null,
  };
}

/**
 * @param {object} decision
 * @param {{ dryRun?: boolean, repo?: string, mainSha?: string, gh?: typeof runCapture }} [opts]
 */
export function executeTrustDecision(decision, opts = {}) {
  const dryRun = opts.dryRun !== false; // default dry unless explicitly false
  const repo = opts.repo || REPO;
  const gh = opts.gh || runCapture;
  const out = { decision, dryRun, dispatched: false, commented: false };

  if (decision.action === "wait-existing" || decision.action === "noop-terminal" || decision.action === "soak-observe") {
    return out;
  }
  if (decision.action === "stop-critical") {
    out.critical = true;
    return out;
  }

  if (dryRun) {
    out.wouldDispatch = decision.action.startsWith("dispatch-");
    return out;
  }

  if (decision.action === "dispatch-proof-rollback" || decision.action === "dispatch-staging-deploy") {
    const mainSha = opts.mainSha;
    if (!mainSha || !/^[0-9a-f]{40}$/i.test(mainSha)) {
      throw new Error("mainSha required for AUTO-3 dispatch");
    }
    const handoff = `trust-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${Math.floor(Math.random() * 1e6)}`;
    const args = [
      "workflow", "run", "upstream-auto3-deploy.yml",
      "--repo", repo,
      "--ref", "main",
      "-f", `source_sha=${mainSha}`,
      "-f", `deployment_reason=host-d-trust-controller-${decision.action}`,
      "-f", `profile=${decision.profile}`,
      "-f", `force_smoke_fail=${decision.force_smoke_fail ? "true" : "false"}`,
      "-f", `handoff_id=${handoff}`,
    ];
    const r = gh("gh", args);
    if (r.status !== 0) {
      throw new Error(`AUTO-3 dispatch failed: ${(r.stderr || r.stdout).slice(0, 400)}`);
    }
    out.dispatched = true;
    out.handoffId = handoff;
  }

  return out;
}

function main() {
  const args = process.argv.slice(2);
  const dry = !args.includes("--execute");
  const ledgerPath = args.find((a) => a.startsWith("--ledger="))?.slice("--ledger=".length) || TRUST_LEDGER_PATH;
  if (!existsSync(ledgerPath)) {
    console.error(`ledger missing: ${ledgerPath}`);
    process.exit(2);
  }
  const ledger = loadTrustLedger(ledgerPath);
  const runs = listRecentAuto3Runs({ repo: ledger.repository || REPO });
  const decision = decideNextTrustAction({ ledger, runs });
  const result = executeTrustDecision(decision, {
    dryRun: dry,
    repo: ledger.repository || REPO,
    mainSha: ledger.baseline?.mainSha,
  });
  const report = {
    recordedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    trackingIssue: ledger.trackingIssue || TRACKING_ISSUE,
    hostP: ledger.hostP,
    hostPAccessCount: ledger.hostPAccessCount || 0,
    inProgressTrustRuns: findInProgressTrustRuns(runs).map((r) => ({
      id: r.databaseId,
      status: r.status,
      title: r.displayTitle,
    })),
    decision,
    result,
    counters: resolveTrustCounters(ledger),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (result.critical) process.exit(3);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
