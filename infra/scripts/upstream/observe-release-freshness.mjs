#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AutomationGovernance 2026-08-07-20:04:
 * Observe release freshness (detection only — never publishes tags/releases).
 * Persists .appsolino/release-freshness.json for operators/agents.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  classifyReleaseFreshness,
  buildFreshnessPlanesReport,
  normalizeVersion,
} from "./release-freshness.mjs";

export const RELEASE_FRESHNESS_PATH = ".appsolino/release-freshness.json";

/**
 * @param {string} repoDir
 */
export function readSourceVersion(repoDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8"));
    return normalizeVersion(pkg.version);
  } catch {
    return null;
  }
}

/**
 * @param {(args: string[]) => {status:number,stdout:string,stderr:string}} runGh
 * @param {string} repo
 */
export function fetchLatestPublishedRelease(runGh, repo) {
  const res = runGh(["api", `repos/${repo}/releases/latest`, "--jq", "{tag:.tag_name,sha:.target_commitish}"]);
  if (res.status !== 0) {
    return { version: null, ref: null, error: (res.stderr || "").slice(0, 200) };
  }
  try {
    const j = JSON.parse(res.stdout || "{}");
    return { version: normalizeVersion(j.tag), ref: j.sha || null, error: null };
  } catch {
    return { version: null, ref: null, error: "parse failure" };
  }
}

/**
 * @param {(args: string[]) => {status:number,stdout:string,stderr:string}} runGh
 * @param {string} repo
 */
export function fetchLatestVersionTag(runGh, repo) {
  const res = runGh([
    "api",
    `repos/${repo}/tags?per_page=20`,
    "--jq",
    "[.[] | select(.name | test(\"^v?[0-9]\"))] | .[0] | {name,sha:.commit.sha}",
  ]);
  if (res.status !== 0) return { version: null, sha: null };
  try {
    const j = JSON.parse(res.stdout || "null");
    if (!j) return { version: null, sha: null };
    return { version: normalizeVersion(j.name), sha: j.sha || null };
  } catch {
    return { version: null, sha: null };
  }
}

/**
 * @param {{
 *   repoDir: string,
 *   appsolinoRepo?: string,
 *   upstreamRepo?: string,
 *   runGh?: Function,
 *   writePath?: string|null,
 *   upstreamVersionChanged?: boolean,
 * }} input
 */
export function observeReleaseFreshness(input) {
  const runGh =
    input.runGh ||
    ((args) => {
      const r = spawnSync("gh", args, { encoding: "utf8" });
      return { status: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
    });
  const appsolinoRepo = input.appsolinoRepo || "Appsolino/Fusion";
  const upstreamRepo = input.upstreamRepo || "Runfusion/Fusion";
  const sourceVersion = readSourceVersion(input.repoDir);
  const published = fetchLatestPublishedRelease(runGh, appsolinoRepo);
  const tag = fetchLatestVersionTag(runGh, appsolinoRepo);
  const upstreamPkg = fetchLatestPublishedRelease(runGh, upstreamRepo);

  const latestPublishedVersion = published.version || tag.version;
  const classification = classifyReleaseFreshness({
    sourceVersion,
    latestPublishedVersion,
    upstreamVersionChanged: input.upstreamVersionChanged === true,
  });

  const record = {
    schemaVersion: 1,
    recordedAtUtc: new Date().toISOString(),
    sourceVersion: classification.sourceVersion,
    sourceSha: null,
    latestPublishedVersion: classification.latestPublishedVersion,
    latestPublishedRef: published.ref || tag.sha || null,
    latestTagVersion: tag.version,
    upstreamLatestReleaseVersion: upstreamPkg.version,
    status: classification.status,
    reason: classification.reason,
    policy:
      "Detect RELEASE_STALE/PENDING automatically. Do not auto-publish every upstream commit; publish when VERSION changes after release-level validation.",
  };

  const writePath = input.writePath === null ? null : input.writePath || join(input.repoDir, RELEASE_FRESHNESS_PATH);
  if (writePath) {
    mkdirSync(dirname(writePath), { recursive: true });
    writeFileSync(writePath, `${JSON.stringify(record, null, 2)}\n`);
  }

  return {
    ...record,
    planes: buildFreshnessPlanesReport({
      release: classification,
    }),
  };
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("observe-release-freshness.mjs") ||
    process.argv[1].includes("observe-release-freshness.mjs"));
if (isMain) {
  const repoDir = process.argv[2] || process.cwd();
  const out = observeReleaseFreshness({ repoDir });
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exit(out.status === "RELEASE_UNKNOWN" ? 2 : 0);
}

export { existsSync };
