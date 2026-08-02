#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-02-04:55:
 * Parse AUTO-3 release manifest + deploy stdout as untrusted data.
 * Never execute candidate code. Unavailable fields stay null — never invent safe values.
 */
import { readFileSync, existsSync } from "node:fs";

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
 * Extract the last JSON object from deploy stdout that looks like an AUTO-3 receipt.
 * @param {string} deployOutputText
 */
export function parseDeployReceipt(deployOutputText) {
  const text = String(deployOutputText || "");
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
      highestMigration: null,
      health: null,
      enginePaused: null,
      recordedUtc: null,
      reasons: [],
    };
  }

  return {
    terminal: nullIfEmpty(last.status)?.toUpperCase() ?? null,
    deployedHostP: typeof last.deployedHostP === "boolean" ? last.deployedHostP : null,
    sourceSha: nullIfEmpty(last.sourceSha),
    releaseId: nullIfEmpty(last.releaseId),
    applicationVersion: nullIfEmpty(last.applicationVersion),
    previousRelease: nullIfEmpty(last.previousRelease),
    highestMigration: nullIfEmpty(last.highestMigration),
    health: nullIfEmpty(last.health),
    enginePaused: typeof last.enginePaused === "boolean" ? last.enginePaused : null,
    recordedUtc: nullIfEmpty(last.recordedUtc),
    reasons: Array.isArray(last.reasons) ? last.reasons.map(String) : [],
  };
}

/**
 * Last AUTO3_TERMINAL_STATUS marker from logs (untrusted text).
 * @param {string} logText
 */
export function parseLastTerminalMarker(logText) {
  const matches = [...String(logText || "").matchAll(/AUTO3_TERMINAL_STATUS=([A-Z_]+)/g)];
  if (!matches.length) return null;
  return matches[matches.length - 1][1];
}

/**
 * Build factual evidence object. Unavailable → null. Never invent hostP/enginePaused.
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

  const terminal = receipt.terminal || markerFromFile || markerFromLog || null;

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

  return {
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
    recordedUtc: receipt.recordedUtc || nullIfEmpty(input.recordedUtc) || null,
    crossCheckNotes,
  };
}

/**
 * @param {string} path
 */
export function readTextIfExists(path) {
  if (!path || !existsSync(path)) return null;
  return readFileSync(path, "utf8");
}
