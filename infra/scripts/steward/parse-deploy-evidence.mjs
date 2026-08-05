#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-05:
 * Parse AUTO-3 release manifest + deploy stdout as untrusted data.
 * Never execute candidate code. Unavailable fields stay null — never invent safe values.
 *
 * Terminal markers: only runtime-emitted lines count. Echoed workflow/shell source,
 * grep condition bodies, comments, and YAML dumps are ignored (#105).
 */
import { readFileSync, existsSync } from "node:fs";

const VALID_TERMINALS = new Set([
  "DEPLOYED",
  "IDEMPOTENT_NOOP",
  "ROLLED_BACK",
  "FAILED",
  "BLOCKED",
  "CRITICAL",
  "SUCCESS",
]);

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function nullIfEmpty(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Strip GitHub Actions --log prefixes and ANSI color codes from a single line.
 * @param {string} line
 */
export function stripLogDecorations(line) {
  let s = String(line || "");
  // ANSI CSI sequences
  s = s.replace(/\u001b\[[0-9;]*m/g, "");
  // GHA: job\tstep\tISO8601Z message
  const gha = /^[^\t]+\t[^\t]+\t\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(.*)$/.exec(s);
  if (gha) s = gha[1];
  return s;
}

/**
 * True when the line is workflow/shell *source* mentioning a marker, not a runtime emit.
 * @param {string} rawLine
 */
export function isScriptSourceTerminalLine(rawLine) {
  const s = stripLogDecorations(rawLine);
  if (!/AUTO3_TERMINAL_STATUS=/.test(s)) return false;
  // Quoted echo / grep / if condition / heredoc-ish workflow dumps
  if (/\becho\b/.test(s)) return true;
  if (/\bgrep\b/.test(s)) return true;
  if (/^\s*if\b/.test(s)) return true;
  if (/^\s*elif\b/.test(s)) return true;
  if (/\$OUT/.test(s) && /grep/.test(s)) return true;
  // YAML / workflow literal: `echo "AUTO3_TERMINAL_STATUS=..."` already covered;
  // bare comment
  if (/^\s*#/.test(s)) return true;
  return false;
}

/**
 * Extract a runtime terminal from one log line, or null.
 * @param {string} rawLine
 * @returns {string|null}
 */
export function runtimeTerminalFromLine(rawLine) {
  if (isScriptSourceTerminalLine(rawLine)) return null;
  const s = stripLogDecorations(rawLine).trim();
  const m = /^AUTO3_TERMINAL_STATUS=([A-Z_]+)\s*$/.exec(s);
  if (!m) return null;
  const term = m[1];
  return VALID_TERMINALS.has(term) ? term : null;
}

/**
 * Ordered runtime markers only (script-source ignored). Last valid wins.
 * @param {string} logText
 * @returns {string[]}
 */
export function extractRuntimeTerminalMarkers(logText) {
  /** @type {string[]} */
  const out = [];
  for (const line of String(logText || "").split(/\r?\n/)) {
    const term = runtimeTerminalFromLine(line);
    if (term) out.push(term);
  }
  return out;
}

/**
 * Last runtime AUTO3_TERMINAL_STATUS marker from logs (untrusted text).
 * Ignores echoed workflow source (#105).
 * @param {string} logText
 */
export function parseLastTerminalMarker(logText) {
  const markers = extractRuntimeTerminalMarkers(logText);
  if (!markers.length) return null;
  return markers[markers.length - 1];
}

/**
 * Reject impossible runtime sequences (e.g. CRITICAL then later DEPLOYED).
 * Last marker still wins for reporting; caller may open needs-evidence.
 * @param {string[]} markers
 * @returns {{ ok: boolean, last: string|null, reason: string|null }}
 */
export function validateRuntimeTerminalSequence(markers) {
  if (!markers.length) return { ok: true, last: null, reason: null };
  const last = markers[markers.length - 1];
  const rank = {
    DEPLOYED: 1,
    IDEMPOTENT_NOOP: 1,
    ROLLED_BACK: 2,
    BLOCKED: 2,
    FAILED: 2,
    CRITICAL: 3,
    SUCCESS: 0,
  };
  let sawTerminalFailure = false;
  for (const m of markers) {
    if (m === "CRITICAL" || m === "FAILED" || m === "BLOCKED" || m === "ROLLED_BACK") {
      sawTerminalFailure = true;
    }
    if (sawTerminalFailure && (m === "DEPLOYED" || m === "IDEMPOTENT_NOOP")) {
      return {
        ok: false,
        last,
        reason: `impossible-sequence:${markers.join(">")}`,
      };
    }
    void rank;
  }
  return { ok: true, last, reason: null };
}

/**
 * @param {string|object} manifestSource JSON string or object from downloaded release manifest
 */
export function parseReleaseManifest(manifestSource) {
  let obj = manifestSource;
  if (typeof manifestSource === "string") {
    try {
      obj = JSON.parse(manifestSource);
    } catch {
      return {
        ok: false,
        sourceSha: null,
        releaseId: null,
        applicationVersion: null,
        requiredSchemaCeiling: null,
        expectedHealthVersion: null,
      };
    }
  }
  if (!obj || typeof obj !== "object") {
    return {
      ok: false,
      sourceSha: null,
      releaseId: null,
      applicationVersion: null,
      requiredSchemaCeiling: null,
      expectedHealthVersion: null,
    };
  }
  /** @type {Record<string, unknown>} */
  const m = obj;
  return {
    ok: true,
    sourceSha: nullIfEmpty(m.sourceSha),
    releaseId: nullIfEmpty(m.releaseId),
    applicationVersion: nullIfEmpty(m.applicationVersion),
    requiredSchemaCeiling: nullIfEmpty(m.requiredSchemaCeiling),
    expectedHealthVersion: nullIfEmpty(m.expectedHealthVersion),
  };
}

/**
 * Normalize deploy stdout / GHA logs so JSON receipts can be re-assembled.
 * @param {string} text
 */
export function normalizeDeployOutputText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => stripLogDecorations(line))
    .join("\n");
}

/**
 * Derive factual fields from receipt reasons when dedicated keys are absent.
 * Does not invent values — only maps explicit reason phrases already emitted by auto3-deploy.
 * @param {string[]} reasons
 * @param {Record<string, unknown>} last
 */
export function deriveReceiptFieldsFromReasons(reasons, last) {
  const joined = reasons.map(String);
  /** @type {{ health: string|null, enginePaused: boolean|null, releaseId: string|null, previousReleaseRestored: boolean|null }} */
  const derived = {
    health: nullIfEmpty(last.health),
    enginePaused: typeof last.enginePaused === "boolean" ? last.enginePaused : null,
    releaseId: nullIfEmpty(last.releaseId),
    previousReleaseRestored: null,
  };

  for (const r of joined) {
    const low = r.toLowerCase();
    if (derived.health == null && /\bhealth\s+ok\b/.test(low)) derived.health = "ok";
    if (derived.enginePaused == null && /\bengine\s+paused\b/.test(low)) derived.enginePaused = true;
    if (derived.enginePaused == null && /\bengine\s+unpaused\b/.test(low)) derived.enginePaused = false;
    const rel = /^release=(.+)$/i.exec(r.trim());
    if (!derived.releaseId && rel) derived.releaseId = rel[1].trim();
    if (/\bprevious\s+release\s+restored\b/i.test(r)) derived.previousReleaseRestored = true;
  }
  return derived;
}

/**
 * Extract the last JSON object from deploy stdout that looks like an AUTO-3 receipt.
 * @param {string} deployOutputText
 */
export function parseDeployReceipt(deployOutputText) {
  const text = normalizeDeployOutputText(deployOutputText);
  /** @type {Record<string, unknown>|null} */
  let last = null;
  // Match balanced-ish JSON blocks containing "status"
  const re = /\{[^{}]*"status"\s*:\s*"[A-Z_]+"[^{}]*\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[0]);
      if (obj && typeof obj.status === "string") last = obj;
    } catch {
      // ignore untrusted partial matches
    }
  }
  // Also try multi-line pretty JSON blocks
  const pretty = text.match(/\{\s*"status"\s*:\s*"[A-Z_]+"[\s\S]*?\n\}/g);
  if (pretty) {
    for (const block of pretty) {
      try {
        const obj = JSON.parse(block);
        if (obj && typeof obj.status === "string") last = obj;
      } catch {
        // ignore
      }
    }
  }

  if (!last) {
    return {
      terminal: null,
      deployedHostP: null,
      sourceSha: null,
      releaseId: null,
      applicationVersion: null,
      previousRelease: null,
      previousReleaseRestored: null,
      highestMigration: null,
      health: null,
      enginePaused: null,
      recordedUtc: null,
      reasons: [],
    };
  }

  const reasons = Array.isArray(last.reasons) ? last.reasons.map(String) : [];
  const derived = deriveReceiptFieldsFromReasons(reasons, last);

  return {
    terminal: nullIfEmpty(last.status)?.toUpperCase() ?? null,
    deployedHostP: typeof last.deployedHostP === "boolean" ? last.deployedHostP : null,
    sourceSha: nullIfEmpty(last.sourceSha),
    releaseId: derived.releaseId || nullIfEmpty(last.releaseId),
    applicationVersion: nullIfEmpty(last.applicationVersion),
    previousRelease: nullIfEmpty(last.previousRelease),
    previousReleaseRestored: derived.previousReleaseRestored,
    highestMigration: nullIfEmpty(last.highestMigration),
    health: derived.health,
    enginePaused: derived.enginePaused,
    recordedUtc: nullIfEmpty(last.recordedUtc),
    reasons,
  };
}

/**
 * Completeness notes for steward (null fields stay null — never invent).
 * @param {{
 *   terminal?: string|null,
 *   health?: string|null,
 *   enginePaused?: boolean|null,
 *   previousRelease?: string|null,
 *   previousReleaseRestored?: boolean|null,
 *   hostPAccessed?: boolean|null,
 *   reasons?: string[],
 * }} ev
 */
export function assessAuto3EvidenceCompleteness(ev) {
  const terminal = String(ev.terminal || "").toUpperCase();
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const notes = [];

  if (terminal === "DEPLOYED") {
    if (ev.health == null) missing.push("health");
    if (ev.enginePaused == null) missing.push("enginePaused");
  }
  if (terminal === "ROLLED_BACK") {
    const restored = ev.previousReleaseRestored === true
      || (ev.reasons || []).some((r) => /\bprevious\s+release\s+restored\b/i.test(String(r)));
    if (!restored && ev.previousRelease == null) missing.push("previousReleaseRestoration");
    if (!restored) notes.push("rollback-restoration-unproven");
  }
  if (ev.hostPAccessed === true) notes.push("host-p-accessed");

  return {
    complete: missing.length === 0,
    missing,
    notes,
    needsEvidence: missing.length > 0,
  };
}

/**
 * Build factual evidence object. Unavailable → null. Never invent hostP/enginePaused.
 *
 * Precedence for terminal:
 *   dedicated terminal file → deploy JSON receipt → runtime marker lines
 *
 * @param {{
 *   manifest?: string|object|null,
 *   deployOutput?: string|null,
 *   terminalFile?: string|null,
 *   buildSourceSha?: string|null,
 *   buildReleaseId?: string|null,
 *   recordedUtc?: string|null,
 * }} input
 */
export function buildFactualAuto3Evidence(input) {
  const manifest = input.manifest != null
    ? parseReleaseManifest(input.manifest)
    : {
      ok: false,
      sourceSha: null,
      releaseId: null,
      applicationVersion: null,
      requiredSchemaCeiling: null,
      expectedHealthVersion: null,
    };
  const receipt = parseDeployReceipt(input.deployOutput || "");
  const markerFromFile = nullIfEmpty(input.terminalFile)?.toUpperCase() ?? null;
  const markerFromLog = parseLastTerminalMarker(input.deployOutput || "");
  const seq = validateRuntimeTerminalSequence(extractRuntimeTerminalMarkers(input.deployOutput || ""));

  // Prefer dedicated terminal file, then receipt status, then runtime markers.
  const terminal = markerFromFile || receipt.terminal || markerFromLog || null;

  // Prefer manifest for package identity; cross-check receipt/build when present.
  const sourceSha = manifest.sourceSha || receipt.sourceSha || nullIfEmpty(input.buildSourceSha);
  const releaseId = manifest.releaseId || receipt.releaseId || nullIfEmpty(input.buildReleaseId);
  const applicationVersion = manifest.applicationVersion || receipt.applicationVersion || null;

  /** @type {string[]} */
  const crossCheckNotes = [];
  if (manifest.sourceSha && input.buildSourceSha
    && manifest.sourceSha.toLowerCase() !== String(input.buildSourceSha).toLowerCase()) {
    crossCheckNotes.push("manifest-sourceSha-ne-build");
  }
  if (manifest.releaseId && input.buildReleaseId
    && manifest.releaseId !== input.buildReleaseId) {
    crossCheckNotes.push("manifest-releaseId-ne-build");
  }
  if (receipt.sourceSha && sourceSha
    && receipt.sourceSha.toLowerCase() !== sourceSha.toLowerCase()) {
    crossCheckNotes.push("receipt-sourceSha-mismatch");
  }
  if (!seq.ok && seq.reason) crossCheckNotes.push(seq.reason);

  const evidence = {
    schemaVersion: 1,
    sourceSha,
    releaseId,
    applicationVersion,
    terminal,
    highestMigration: receipt.highestMigration || manifest.requiredSchemaCeiling || null,
    health: receipt.health || null,
    enginePaused: receipt.enginePaused,
    hostPAccessed: receipt.deployedHostP,
    previousRelease: receipt.previousRelease || null,
    previousReleaseRestored: receipt.previousReleaseRestored,
    recordedUtc: receipt.recordedUtc || nullIfEmpty(input.recordedUtc) || null,
    reasons: receipt.reasons,
    crossCheckNotes,
  };

  const completeness = assessAuto3EvidenceCompleteness(evidence);
  return {
    ...evidence,
    completeness,
  };
}

/**
 * @param {string} path
 */
export function readTextIfExists(path) {
  if (!path || !existsSync(path)) return null;
  return readFileSync(path, "utf8");
}
