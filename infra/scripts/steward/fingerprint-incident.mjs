#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Stable incident fingerprints. Hash only normalized structural fields —
 * never run/job IDs, timestamps, attempts, handoff nonces, temp paths, or runners.
 */
import { createHash } from "node:crypto";
import { VOLATILE_FINGERPRINT_EXCLUSIONS } from "./policy.mjs";

/**
 * @typedef {{
 *   workflow: string,
 *   phase: string,
 *   class: string,
 *   error: string,
 *   component: string,
 *   terminal?: string,
 * }} FingerprintPayload
 */

/**
 * Build the stable fingerprint payload from normalized evidence.
 * @param {{
 *   workflowFamily: string,
 *   phase: string,
 *   failureClass: string,
 *   errorSignature: string,
 *   component: string,
 *   terminalStatus?: string,
 * }} normalized
 * @returns {FingerprintPayload}
 */
export function buildFingerprintPayload(normalized) {
  const payload = {
    workflow: String(normalized.workflowFamily || "unknown").toLowerCase().trim(),
    phase: String(normalized.phase || "unknown").toLowerCase().trim(),
    class: String(normalized.failureClass || "needs-triage").toLowerCase().trim(),
    error: normalizeErrorSignature(normalized.errorSignature),
    component: String(normalized.component || "unknown").toLowerCase().trim(),
  };
  const terminal = String(normalized.terminalStatus || "").toUpperCase().trim();
  if (terminal) payload.terminal = terminal;
  assertNoVolatileKeys(payload);
  return payload;
}

/**
 * Collapse whitespace and drop volatile substrings from error text.
 * @param {unknown} raw
 */
export function normalizeErrorSignature(raw) {
  let s = String(raw ?? "")
    .toLowerCase()
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  // Strip hex SHAs, numeric run ids, ISO timestamps, handoff ids.
  s = s.replace(/\b[0-9a-f]{7,40}\b/g, "<sha>");
  s = s.replace(/\b\d{10,}\b/g, "<id>");
  s = s.replace(/\b\d{4}-\d{2}-\d{2}t[\d:.z+-]+\b/gi, "<ts>");
  s = s.replace(/\bauto2-[a-z0-9_-]+\b/gi, "<handoff>");
  s = s.replace(/\/tmp\/[^\s]+/g, "<tmp>");
  s = s.replace(/\/srv\/[^\s]+/g, "<path>");
  s = s.replace(/runner[_-]?[a-z0-9-]+/gi, "<runner>");
  return s.slice(0, 240) || "unspecified";
}

/**
 * @param {FingerprintPayload} payload
 * @returns {{ payload: FingerprintPayload, fingerprint: string, canonical: string }}
 */
export function fingerprintIncident(payload) {
  // Reject volatile keys on the inbound object (not only the ordered subset).
  assertNoVolatileKeys(payload || {});
  const ordered = {
    workflow: payload.workflow,
    phase: payload.phase,
    class: payload.class,
    error: payload.error,
    component: payload.component,
    ...(payload.terminal ? { terminal: payload.terminal } : {}),
  };
  assertNoVolatileKeys(ordered);
  const canonical = JSON.stringify(ordered);
  const fingerprint = createHash("sha256").update(canonical, "utf8").digest("hex");
  return { payload: ordered, fingerprint, canonical };
}

/**
 * @param {Record<string, unknown>} obj
 */
function assertNoVolatileKeys(obj) {
  for (const key of Object.keys(obj)) {
    if (VOLATILE_FINGERPRINT_EXCLUSIONS.includes(key)) {
      throw new Error(`fingerprint must not include volatile field: ${key}`);
    }
  }
}
