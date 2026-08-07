#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-19:56:
 * Release freshness is a separate plane from source freshness.
 * Source can be 0.75.1 while GitHub Latest Release remains v0.73.0 — that is
 * RELEASE_STALE, not a source rollback. Do not auto-publish every upstream commit;
 * publish when upstream VERSION changes and release-level validation passes.
 */
export const RELEASE_FRESHNESS_STATES = Object.freeze([
  "RELEASE_CURRENT",
  "RELEASE_PENDING",
  "RELEASE_STALE",
  "RELEASE_UNKNOWN",
]);

/**
 * @param {{
 *   sourceVersion?: string|null,
 *   latestPublishedVersion?: string|null,
 *   upstreamVersionChanged?: boolean|null,
 * }} input
 */
export function classifyReleaseFreshness(input = {}) {
  const source = normalizeVersion(input.sourceVersion);
  const published = normalizeVersion(input.latestPublishedVersion);

  if (!source && !published) {
    return {
      status: "RELEASE_UNKNOWN",
      sourceVersion: null,
      latestPublishedVersion: null,
      reason: "source and published versions unavailable",
    };
  }
  if (!published) {
    return {
      status: "RELEASE_STALE",
      sourceVersion: source,
      latestPublishedVersion: null,
      reason: "source version present but no Appsolino GitHub Release tag found",
    };
  }
  if (!source) {
    return {
      status: "RELEASE_UNKNOWN",
      sourceVersion: null,
      latestPublishedVersion: published,
      reason: "published version present but source package version unavailable",
    };
  }
  if (source === published) {
    return {
      status: "RELEASE_CURRENT",
      sourceVersion: source,
      latestPublishedVersion: published,
      reason: "source package version matches latest published GitHub Release",
    };
  }
  if (input.upstreamVersionChanged === true) {
    return {
      status: "RELEASE_PENDING",
      sourceVersion: source,
      latestPublishedVersion: published,
      reason: "upstream VERSION changed — release pending after release-level validation",
    };
  }
  return {
    status: "RELEASE_STALE",
    sourceVersion: source,
    latestPublishedVersion: published,
    reason: `source ${source} ≠ published ${published} — track explicitly; do not infer product state from Latest Release badge alone`,
  };
}

/**
 * @param {string|null|undefined} v
 */
export function normalizeVersion(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/^v/i, "");
  return s || null;
}

/**
 * Three-plane freshness snapshot for operators.
 * @param {{
 *   source?: object,
 *   release?: ReturnType<typeof classifyReleaseFreshness>,
 *   hostD?: { version?: string|null, sourceSha?: string|null },
 *   hostP?: { version?: string|null, sourceSha?: string|null },
 * }} planes
 */
export function buildFreshnessPlanesReport(planes = {}) {
  return {
    schemaVersion: 1,
    recordedAtUtc: new Date().toISOString(),
    sourceFreshness: planes.source || null,
    releaseFreshness: planes.release || null,
    deployFreshness: {
      hostD: planes.hostD || null,
      hostP: planes.hostP || null,
      note: "Host P remains inaccessible until explicitly authorised",
    },
  };
}
