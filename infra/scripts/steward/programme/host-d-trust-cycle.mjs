#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:HostDTrust 2026-08-06:
 * Durable Host D trust-cycle controller for programme #109.
 * Discovers existing AUTO-3 runs before dispatch. Never depends on Cursor chat waits.
 * Host P credentials must remain unavailable.
 * Scheduled hourly runs execute the next eligible action (at most one) with the same
 * discover-before-dispatch guards as manual execute-next.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TRUST_LEDGER_PATH = join(HERE, "host-d-trust-ledger.json");
export const TRACKING_ISSUE = 109;
export const REPO = "Appsolino/Fusion";
/** Host D durable overlay — survives git checkout; never contains Host P secrets. */
export const DEFAULT_RUNTIME_OVERLAY_PATH =
  "/srv/appsolino-fusion/staging/state/host-d-trust-runtime.json";

const TRUST_HANDOFF_RE = /\btrust[-_]/i;
const DISPATCH_ACTIONS = new Set([
  "dispatch-proof-rollback",
  "dispatch-staging-deploy",
]);

/**
 * @param {string} [path]
 */
export function loadTrustLedger(path = TRUST_LEDGER_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

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

/**
 * Map workflow event + inputs → controller mode.
 * Schedule ≡ execute-next with execute=true; reconcile-only never executes.
 * @param {{
 *   eventName?: string,
 *   executeInput?: boolean|string,
 *   modeInput?: string,
 * }} input
 */
export function resolveControllerExecutionMode(input = {}) {
  const eventName = String(input.eventName || "workflow_dispatch");
  let mode = String(input.modeInput || "decide");
  let execute =
    input.executeInput === true
    || input.executeInput === "true"
    || input.executeInput === "1";

  if (eventName === "schedule") {
    mode = "execute-next";
    execute = true;
  }
  if (mode === "reconcile-only") {
    execute = false;
  }
  return {
    eventName,
    mode,
    execute,
    shouldExecute: execute && mode === "execute-next",
  };
}

/**
 * @param {object} baseLedger git ledger
 * @param {object|null|undefined} overlay runtime overlay
 */
export function mergeLedgerOverlay(baseLedger, overlay) {
  const base = baseLedger && typeof baseLedger === "object" ? baseLedger : {};
  const over = overlay && typeof overlay === "object" ? overlay : {};
  const merged = {
    ...base,
    ...over,
    baseline: { ...(base.baseline || {}), ...(over.baseline || {}) },
    trustWindow: {
      ...(base.trustWindow || {}),
      ...(over.trustWindow || {}),
      counters: {
        ...((base.trustWindow && base.trustWindow.counters) || {}),
        ...((over.trustWindow && over.trustWindow.counters) || {}),
      },
      subsystemCounters: {
        ...((base.trustWindow && base.trustWindow.subsystemCounters) || {}),
        ...((over.trustWindow && over.trustWindow.subsystemCounters) || {}),
      },
    },
    counters: resolveTrustCounters({
      counters: { ...(base.counters || {}), ...(over.counters || {}) },
      trustWindow: {
        counters: {
          ...((base.trustWindow && base.trustWindow.counters) || {}),
          ...((over.trustWindow && over.trustWindow.counters) || {}),
        },
      },
    }),
    auto3Runs: mergeRunsById(base.auto3Runs, over.auto3Runs),
    rollbackRuns: mergeRunsById(base.rollbackRuns, over.rollbackRuns),
    defects: Array.isArray(over.defects)
      ? over.defects
      : (base.defects || []),
    dispatchedKeys: uniqueStrings([
      ...(base.dispatchedKeys || []),
      ...(over.dispatchedKeys || []),
    ]),
    pendingDispatch: over.pendingDispatch !== undefined
      ? over.pendingDispatch
      : (base.pendingDispatch || null),
    lastDispatch: over.lastDispatch || base.lastDispatch || null,
    freezeDestructive: over.freezeDestructive === true
      || base.freezeDestructive === true,
    needsEvidence: over.needsEvidence || base.needsEvidence || null,
  };
  // Keep top-level and trustWindow counters aligned after merge.
  merged.trustWindow.counters = { ...merged.counters };
  return merged;
}

/**
 * @param {object[]|undefined} a
 * @param {object[]|undefined} b
 */
function mergeRunsById(a, b) {
  /** @type {Map<number|string, object>} */
  const map = new Map();
  for (const r of [...(a || []), ...(b || [])]) {
    if (r && r.id != null) map.set(r.id, { ...(map.get(r.id) || {}), ...r });
  }
  return [...map.values()];
}

/** @param {string[]} xs */
function uniqueStrings(xs) {
  return [...new Set(xs.filter(Boolean).map(String))];
}

/**
 * @param {object} ledger
 * @param {string} [path]
 */
export function saveTrustLedger(ledger, path = TRUST_LEDGER_PATH) {
  ledger.updatedUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

/**
 * Persist runtime overlay (counters, pending dispatch, freeze). Git ledger stays read-only in CI.
 * @param {object} overlay
 * @param {string} path
 */
export function saveRuntimeOverlay(overlay, path) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = {
    schemaVersion: 1,
    updatedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    ...overlay,
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
  return body;
}

/**
 * @param {string} [path]
 */
export function loadRuntimeOverlay(path) {
  if (!path || !existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
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
 * Resolve Appsolino main tip for AUTO-3 source_sha (never stale baseline alone).
 * @param {{ repo?: string, gh?: typeof runCapture, fallbackSha?: string }} [opts]
 */
export function resolveMainTipSha(opts = {}) {
  const repo = opts.repo || REPO;
  const gh = opts.gh || runCapture;
  const r = gh("gh", [
    "api", `repos/${repo}/commits/main`, "--jq", ".sha",
  ]);
  if (r.status === 0) {
    const sha = String(r.stdout || "").trim();
    if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
  }
  const fb = String(opts.fallbackSha || "").trim();
  if (/^[0-9a-f]{40}$/i.test(fb)) return fb;
  throw new Error(`unable to resolve main tip sha: ${(r.stderr || r.stdout).slice(0, 300)}`);
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
 * Build durable dispatch dedupe key for cycle/head/test.
 * @param {{ action?: string, profile?: string }} decision
 * @param {string} mainSha
 */
export function buildDispatchKey(decision, mainSha) {
  const action = String(decision?.action || "");
  const profile = String(decision?.profile || "");
  const sha = String(mainSha || "").toLowerCase();
  return `${action}|${profile}|${sha}`;
}

/**
 * True when programme must freeze further destructive / AUTO-3 dispatch.
 * @param {object} ledger
 */
export function hasCriticalFreeze(ledger) {
  if (ledger?.freezeDestructive === true) return true;
  if (ledger?.hostP === "PROHIBITED" && Number(ledger?.hostPAccessCount || 0) > 0) {
    return true;
  }
  const defects = ledger?.defects || [];
  return defects.some((d) =>
    String(d?.severity || "").toUpperCase() === "CRITICAL"
    && !["CLOSED", "FIXED", "CLOSED_ACCEPTED_GUARD"].includes(String(d?.status || "").toUpperCase()));
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
 *     sourceSha?: string|null,
 *     releaseId?: string|null,
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

  if (ev.completeness?.needsEvidence === true || ev.completeness?.complete === false) {
    return { pass: false, severity: "MEDIUM", reason: "needs-evidence", needsEvidence: true };
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
      return { pass: false, severity: "MEDIUM", reason: "deployed-incomplete-evidence", needsEvidence: true };
    }
    if (ev.health !== "ok" || ev.enginePaused !== true) {
      if (ev.health == null || ev.enginePaused == null) {
        return { pass: false, severity: "MEDIUM", reason: "deployed-missing-physical-fields", needsEvidence: true };
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
 * Apply a classified staging/proof result onto ledger counters (pure).
 * @param {object} ledger
 * @param {{
 *   id: number|string,
 *   profile: string,
 *   classification: { pass: boolean, severity?: string|null, reason?: string, needsEvidence?: boolean },
 *   evidence?: object,
 *   sourceSha?: string,
 * }} run
 */
export function applyClassifiedRunToLedger(ledger, run) {
  const next = mergeLedgerOverlay(ledger, {});
  const counters = { ...resolveTrustCounters(next) };
  const classification = run.classification || {};
  const profile = String(run.profile || "");
  const ev = run.evidence || {};
  const terminal = String(ev.terminal || "").toUpperCase();
  const already = (next.auto3Runs || []).find((r) => String(r.id) === String(run.id));
  const alreadyPassed = already && already.classification === "PASS";

  if (classification.severity === "CRITICAL") {
    next.freezeDestructive = true;
    next.hostPAccessCount = Math.max(Number(next.hostPAccessCount || 0), 1);
    next.needsEvidence = null;
  } else if (classification.needsEvidence) {
    next.needsEvidence = {
      runId: run.id,
      reason: classification.reason,
      recordedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  } else if (classification.pass && !alreadyPassed) {
    next.needsEvidence = null;
    if (profile === "staging" && (terminal === "DEPLOYED" || terminal === "IDEMPOTENT_NOOP")) {
      counters.stagingDeploysPass = Number(counters.stagingDeploysPass || 0) + 1;
    }
    if (profile === "proof" && terminal === "ROLLED_BACK") {
      counters.proofRollbacksPass = Number(counters.proofRollbacksPass || 0) + 1;
    }
    next.pendingDispatch = null;
    const key = run.dispatchKey || (run.sourceSha
      ? buildDispatchKey(
        {
          action: profile === "proof" ? "dispatch-proof-rollback" : "dispatch-staging-deploy",
          profile,
        },
        run.sourceSha,
      )
      : null);
    if (key) {
      next.dispatchedKeys = uniqueStrings([...(next.dispatchedKeys || []), key]);
    }
  }

  next.counters = counters;
  next.trustWindow = next.trustWindow || {};
  next.trustWindow.counters = { ...counters };
  const entry = {
    id: run.id,
    profile,
    terminal: ev.terminal || null,
    classification: classification.pass ? "PASS" : "FAIL",
    severity: classification.severity || null,
    reason: classification.reason || null,
    sourceSha: run.sourceSha || ev.sourceSha || null,
    releaseId: ev.releaseId || null,
    hostPAccessed: ev.hostPAccessed === true,
    reconciledUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  next.auto3Runs = mergeRunsById(next.auto3Runs, [entry]);
  if (profile === "proof") {
    next.rollbackRuns = mergeRunsById(next.rollbackRuns, [entry]);
  }
  return next;
}

/**
 * Increment staging counter once for a validated DEPLOYED/IDEMPOTENT_NOOP run (idempotent by id).
 * @param {object} ledger
 * @param {{ id: number|string, sourceSha?: string, releaseId?: string, terminal?: string }} run
 */
export function recordStagingDeployPass(ledger, run) {
  const next = mergeLedgerOverlay(ledger, {});
  const existing = (next.auto3Runs || []).find((r) => String(r.id) === String(run.id));
  if (existing && existing.classification === "PASS" && existing.profile === "staging") {
    return next;
  }
  const counters = { ...resolveTrustCounters(next) };
  counters.stagingDeploysPass = Number(counters.stagingDeploysPass || 0) + 1;
  next.counters = counters;
  next.trustWindow = next.trustWindow || {};
  next.trustWindow.counters = { ...counters };
  next.needsEvidence = null;
  next.baseline = {
    ...(next.baseline || {}),
    mainSha: run.sourceSha || next.baseline?.mainSha,
    activeRelease: run.releaseId || next.baseline?.activeRelease,
    health: "ok",
    enginePaused: true,
  };
  const key = buildDispatchKey(
    { action: "dispatch-staging-deploy", profile: "staging" },
    run.sourceSha || "",
  );
  next.dispatchedKeys = uniqueStrings([...(next.dispatchedKeys || []), key]);
  next.auto3Runs = mergeRunsById(next.auto3Runs, [{
    id: run.id,
    profile: "staging",
    terminal: run.terminal || "DEPLOYED",
    classification: "PASS",
    sourceSha: run.sourceSha || null,
    releaseId: run.releaseId || null,
    hostPAccessed: false,
    health: "ok",
    enginePaused: true,
    reconciledUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  }]);
  next.pendingDispatch = null;
  return next;
}

/**
 * Decide the next controller action. Pure — no side effects.
 * @param {{
 *   ledger: object,
 *   runs: object[],
 *   mainSha?: string,
 *   nowMs?: number,
 * }} input
 */
export function decideNextTrustAction(input) {
  const ledger = input.ledger || {};
  if (ledger.terminal) {
    return { action: "noop-terminal", reason: "programme-already-terminal", detail: ledger.terminal };
  }
  if (hasCriticalFreeze(ledger)) {
    return { action: "stop-critical", reason: "critical-freeze-or-host-p" };
  }
  if (ledger.hostP === "PROHIBITED" && ledger.hostPAccessCount > 0) {
    return { action: "stop-critical", reason: "host-p-access-nonzero" };
  }

  if (ledger.needsEvidence) {
    return {
      action: "reconcile-needs-evidence",
      reason: "incomplete-evidence-no-redeploy",
      detail: ledger.needsEvidence,
    };
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

  // Pending checkpoint without a completed child → do not stack another dispatch.
  if (ledger.pendingDispatch?.dispatchKey) {
    const pendingAgeMs = input.nowMs && ledger.pendingDispatch.recordedUtc
      ? input.nowMs - Date.parse(ledger.pendingDispatch.recordedUtc)
      : 0;
    // Allow re-dispatch only after a long stall (bounded); default wait.
    if (!Number.isFinite(pendingAgeMs) || pendingAgeMs < 3 * 60 * 60 * 1000) {
      return {
        action: "wait-pending-dispatch",
        reason: "checkpointed-dispatch-awaiting-child",
        dispatchKey: ledger.pendingDispatch.dispatchKey,
        handoffId: ledger.pendingDispatch.handoffId || null,
      };
    }
  }

  const counters = resolveTrustCounters(ledger);
  const stagingPass = Number(counters.stagingDeploysPass || 0);
  const rollbackPass = Number(counters.proofRollbacksPass || 0);
  const backupPass = Number(counters.backupRestorePass || 0);
  const needStaging = Number(counters.requiredStagingDeploys || 3);
  const needRollback = Number(counters.requiredProofRollbacks || 2);
  const needBackup = Number(counters.requiredBackupRestores || 2);
  const mainSha = String(input.mainSha || ledger.baseline?.mainSha || "").toLowerCase();

  /** @param {object} decision */
  const guardDuplicate = (decision) => {
    if (!DISPATCH_ACTIONS.has(decision.action)) return decision;
    const key = buildDispatchKey(decision, mainSha);
    if ((ledger.dispatchedKeys || []).includes(key)) {
      return {
        action: "skip-duplicate",
        reason: "same-cycle-head-test-already-dispatched",
        dispatchKey: key,
        skipped: decision,
      };
    }
    // No unchanged deterministic retry of last successful identical dispatch.
    const last = ledger.lastDispatch;
    if (
      last
      && last.dispatchKey === key
      && last.status === "dispatched"
      && last.sourceSha === mainSha
    ) {
      return {
        action: "skip-unchanged-rerun",
        reason: "unchanged-deterministic-retry-blocked",
        dispatchKey: key,
        skipped: decision,
      };
    }
    return { ...decision, dispatchKey: key };
  };

  // Prefer local Host D proofs on the self-hosted runner before more AUTO-3.
  if (backupPass < needBackup) {
    return { action: "local-backup-restore", reason: `backup-restore ${backupPass}/${needBackup}` };
  }
  if (rollbackPass < needRollback) {
    return guardDuplicate({
      action: "dispatch-proof-rollback",
      reason: `proof-rollback ${rollbackPass}/${needRollback}`,
      profile: "proof",
      force_smoke_fail: true,
    });
  }
  if (stagingPass < needStaging) {
    return guardDuplicate({
      action: "dispatch-staging-deploy",
      reason: `staging-deploy ${stagingPass}/${needStaging}`,
      profile: "staging",
      force_smoke_fail: false,
    });
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
 * Advance past skip-* decisions when quotas still need work on a *new* tip.
 * For skip-duplicate on same SHA, bump is not automatic — soak or wait for tip change.
 * @param {object} decision
 * @param {object} ledger
 * @param {string} mainSha
 */
export function refineSkippedDecision(decision, ledger, mainSha) {
  if (decision.action !== "skip-duplicate" && decision.action !== "skip-unchanged-rerun") {
    return decision;
  }
  const skipped = decision.skipped || {};
  const counters = resolveTrustCounters(ledger);
  // If we skipped a staging deploy for this SHA but still need more staging passes,
  // do not redispatch same SHA — wait for tip movement / soak.
  if (skipped.action === "dispatch-staging-deploy") {
    const stagingPass = Number(counters.stagingDeploysPass || 0);
    const needStaging = Number(counters.requiredStagingDeploys || 3);
    if (stagingPass < needStaging) {
      return {
        action: "wait-tip-or-reconcile",
        reason: "staging-quota-open-but-sha-already-used",
        dispatchKey: decision.dispatchKey,
        mainSha,
      };
    }
  }
  if (skipped.action === "dispatch-proof-rollback") {
    const rollbackPass = Number(counters.proofRollbacksPass || 0);
    const needRollback = Number(counters.requiredProofRollbacks || 2);
    if (rollbackPass < needRollback) {
      return {
        action: "wait-tip-or-reconcile",
        reason: "proof-quota-open-but-sha-already-used",
        dispatchKey: decision.dispatchKey,
        mainSha,
      };
    }
  }
  return {
    action: "soak-observe",
    reason: "duplicate-or-unchanged-skipped-continue-soak",
    trustWindowStartedUtc: ledger.trustWindow?.startedUtc || null,
  };
}

/**
 * @param {object} decision
 * @param {{
 *   dryRun?: boolean,
 *   repo?: string,
 *   mainSha?: string,
 *   gh?: typeof runCapture,
 *   beforeDispatch?: (checkpoint: object) => void,
 * }} [opts]
 */
export function executeTrustDecision(decision, opts = {}) {
  const dryRun = opts.dryRun !== false; // default dry unless explicitly false
  const repo = opts.repo || REPO;
  const gh = opts.gh || runCapture;
  const out = { decision, dryRun, dispatched: false, commented: false, childCount: 0 };

  const noOp = new Set([
    "wait-existing",
    "wait-pending-dispatch",
    "wait-tip-or-reconcile",
    "noop-terminal",
    "soak-observe",
    "reconcile-needs-evidence",
    "skip-duplicate",
    "skip-unchanged-rerun",
    "local-backup-restore",
    "local-fault-or-backup",
  ]);
  if (noOp.has(decision.action)) {
    return out;
  }
  if (decision.action === "stop-critical") {
    out.critical = true;
    return out;
  }

  if (dryRun) {
    out.wouldDispatch = DISPATCH_ACTIONS.has(decision.action);
    return out;
  }

  if (DISPATCH_ACTIONS.has(decision.action)) {
    const mainSha = opts.mainSha;
    if (!mainSha || !/^[0-9a-f]{40}$/i.test(mainSha)) {
      throw new Error("mainSha required for AUTO-3 dispatch");
    }
    const handoff = `trust-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${Math.floor(Math.random() * 1e6)}`;
    const dispatchKey = decision.dispatchKey || buildDispatchKey(decision, mainSha);
    const checkpoint = {
      action: decision.action,
      profile: decision.profile,
      force_smoke_fail: Boolean(decision.force_smoke_fail),
      sourceSha: mainSha,
      dispatchKey,
      handoffId: handoff,
      recordedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      status: "checkpointed",
    };
    if (typeof opts.beforeDispatch === "function") {
      opts.beforeDispatch(checkpoint);
    }
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
    out.childCount = 1;
    out.handoffId = handoff;
    out.dispatchKey = dispatchKey;
    out.checkpoint = checkpoint;
  }

  return out;
}

/**
 * Build runtime overlay patch after a successful dispatch (at most one child).
 * @param {object} ledger
 * @param {object} result executeTrustDecision result
 */
export function overlayAfterDispatch(ledger, result) {
  const cp = result.checkpoint || {};
  return {
    counters: resolveTrustCounters(ledger),
    trustWindow: { counters: resolveTrustCounters(ledger) },
    pendingDispatch: {
      ...cp,
      status: "dispatched",
    },
    lastDispatch: {
      ...cp,
      status: "dispatched",
    },
    dispatchedKeys: uniqueStrings([
      ...(ledger.dispatchedKeys || []),
      cp.dispatchKey,
    ].filter(Boolean)),
    freezeDestructive: ledger.freezeDestructive === true,
    needsEvidence: ledger.needsEvidence || null,
    baseline: ledger.baseline || {},
    auto3Runs: ledger.auto3Runs || [],
    hostPAccessCount: ledger.hostPAccessCount || 0,
  };
}

function main() {
  const args = process.argv.slice(2);
  const dry = !args.includes("--execute");
  const ledgerPath = args.find((a) => a.startsWith("--ledger="))?.slice("--ledger=".length) || TRUST_LEDGER_PATH;
  const overlayPath = args.find((a) => a.startsWith("--overlay="))?.slice("--overlay=".length)
    || process.env.HOST_D_TRUST_RUNTIME_LEDGER
    || DEFAULT_RUNTIME_OVERLAY_PATH;
  if (!existsSync(ledgerPath)) {
    console.error(`ledger missing: ${ledgerPath}`);
    process.exit(2);
  }
  const baseLedger = loadTrustLedger(ledgerPath);
  let ledger = mergeLedgerOverlay(baseLedger, loadRuntimeOverlay(overlayPath));
  const runs = listRecentAuto3Runs({ repo: ledger.repository || REPO });
  let mainSha;
  try {
    mainSha = resolveMainTipSha({
      repo: ledger.repository || REPO,
      fallbackSha: ledger.baseline?.mainSha,
    });
  } catch {
    mainSha = ledger.baseline?.mainSha;
  }

  let decision = decideNextTrustAction({ ledger, runs, mainSha });
  decision = refineSkippedDecision(decision, ledger, mainSha);

  const result = executeTrustDecision(decision, {
    dryRun: dry,
    repo: ledger.repository || REPO,
    mainSha,
    beforeDispatch: (checkpoint) => {
      // Durable checkpoint before the only child dispatch.
      const pendingOverlay = {
        counters: resolveTrustCounters(ledger),
        trustWindow: { counters: resolveTrustCounters(ledger) },
        pendingDispatch: checkpoint,
        lastDispatch: ledger.lastDispatch || null,
        dispatchedKeys: ledger.dispatchedKeys || [],
        freezeDestructive: ledger.freezeDestructive === true,
        needsEvidence: ledger.needsEvidence || null,
        baseline: { ...(ledger.baseline || {}), mainSha },
        auto3Runs: ledger.auto3Runs || [],
        hostPAccessCount: ledger.hostPAccessCount || 0,
      };
      saveRuntimeOverlay(pendingOverlay, overlayPath);
    },
  });

  if (result.dispatched) {
    saveRuntimeOverlay(overlayAfterDispatch(ledger, result), overlayPath);
  }

  const report = {
    recordedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    trackingIssue: ledger.trackingIssue || TRACKING_ISSUE,
    hostP: ledger.hostP,
    hostPAccessCount: ledger.hostPAccessCount || 0,
    execution: { dryRun: dry, mainSha },
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
