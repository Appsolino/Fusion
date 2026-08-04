#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardGrok 2026-08-04:
 * Verdict schema validation — fail closed on malformed / drifted responses.
 */
import { createHash } from "node:crypto";
import {
  ALLOWED_REPO,
  GROK_PROVIDER,
  RISKS,
  VERDICTS,
} from "./policy.mjs";

/**
 * @param {unknown} v
 */
export function validateVerdict(v, opts = {}) {
  if (!v || typeof v !== "object") throw new Error("verdict missing");
  const art = /** @type {Record<string, any>} */ (v);
  if (Number(art.schemaVersion) !== 1) {
    throw new Error(`verdict schemaVersion mismatch: ${art.schemaVersion}`);
  }
  if (art.role !== "reviewer" && art.role !== "approver") {
    throw new Error(`verdict role invalid: ${art.role}`);
  }
  if (!VERDICTS.includes(art.verdict)) {
    throw new Error(`verdict invalid: ${art.verdict}`);
  }
  if (!RISKS.includes(art.risk)) {
    throw new Error(`risk invalid: ${art.risk}`);
  }
  if (art.repository !== ALLOWED_REPO) {
    throw new Error(`cross-repository target rejected: ${art.repository}`);
  }
  if (!/^[0-9a-f]{40}$/.test(String(art.baseSha || ""))) {
    throw new Error("baseSha must be full 40-char SHA");
  }
  if (!/^[0-9a-f]{40}$/.test(String(art.headSha || ""))) {
    throw new Error("headSha must be full 40-char SHA");
  }
  if (!/^[0-9a-f]{64}$/.test(String(art.diffSha256 || ""))) {
    throw new Error("diffSha256 must be sha256 hex");
  }
  if (!/^[0-9a-f]{64}$/.test(String(art.testsSha256 || ""))) {
    throw new Error("testsSha256 must be sha256 hex");
  }
  if (!Array.isArray(art.blockingFindings)) {
    throw new Error("blockingFindings must be array");
  }
  if (!Array.isArray(art.nonBlockingFindings)) {
    throw new Error("nonBlockingFindings must be array");
  }
  if (!Array.isArray(art.requiredChanges)) {
    throw new Error("requiredChanges must be array");
  }
  if (!Array.isArray(art.evidenceChecked)) {
    throw new Error("evidenceChecked must be array");
  }
  if (!art.authorityCheck || typeof art.authorityCheck !== "object") {
    throw new Error("authorityCheck missing");
  }
  for (const k of ["hostP", "production", "destructiveData", "secretExpansion"]) {
    if (art.authorityCheck[k] !== false) {
      throw new Error(`authorityCheck.${k} must be false`);
    }
  }
  if (art.configuredProvider !== GROK_PROVIDER || art.actualProvider !== GROK_PROVIDER) {
    throw new Error("provider must be xai (silent fallback forbidden)");
  }
  if (
    !art.configuredModel ||
    !art.actualModel ||
    art.configuredModel !== art.actualModel
  ) {
    throw new Error("configured/actual model mismatch or missing (fail closed)");
  }
  if (opts.expectModel && art.actualModel !== opts.expectModel) {
    throw new Error(
      `model drift: expected ${opts.expectModel} got ${art.actualModel}`,
    );
  }
  if (!art.requestId) throw new Error("requestId missing");
  if (!art.expiresAt) throw new Error("expiresAt missing");
  if (opts.nowMs != null) {
    const exp = Date.parse(String(art.expiresAt));
    if (!Number.isFinite(exp) || exp <= opts.nowMs) {
      throw new Error("approval expired");
    }
  }
  if (opts.expectHeadSha && art.headSha !== opts.expectHeadSha) {
    throw new Error("stale head rejected");
  }
  if (opts.expectDiffSha256 && art.diffSha256 !== opts.expectDiffSha256) {
    throw new Error("changed diff rejected");
  }
  if (opts.expectTestsSha256 && art.testsSha256 !== opts.expectTestsSha256) {
    throw new Error("changed tests rejected");
  }
  return /** @type {typeof art} */ (art);
}

/**
 * @param {string} text
 */
export function sha256Text(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}
