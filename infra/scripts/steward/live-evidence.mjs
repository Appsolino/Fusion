#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-03:
 * Side-effect-free shared live evidence helpers for steward S0.
 * Importing this module must never execute a CLI or call GitHub.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    return { ok: false, stdout: r.stdout || "", stderr: r.stderr || "" };
  }
  try {
    return { ok: true, data: JSON.parse(r.stdout || "null"), stdout: r.stdout };
  } catch {
    return { ok: true, data: null, stdout: r.stdout || "" };
  }
}

/**
 * Download auto3-evidence-* artifact for a run into destDir; return parsed JSON or null.
 * @param {string} repo
 * @param {string|number} runId
 * @param {string} destDir
 */
export function downloadAuto3EvidenceArtifact(repo, runId, destDir) {
  mkdirSync(destDir, { recursive: true });
  const list = ghJson([
    "api",
    `repos/${repo}/actions/runs/${runId}/artifacts?per_page=50`,
  ]);
  if (!list.ok || !list.data?.artifacts) return null;
  const art = (list.data.artifacts || []).find((a) => String(a.name || "").startsWith("auto3-evidence-"));
  if (!art) return null;
  const dl = spawnSync(
    "gh",
    ["api", `repos/${repo}/actions/artifacts/${art.id}/zip`],
    { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
  );
  if (dl.status !== 0 || !dl.stdout?.length) return null;
  const zipPath = join(destDir, "evidence.zip");
  writeFileSync(zipPath, dl.stdout);
  const unzip = spawnSync("unzip", ["-o", zipPath, "-d", destDir], { encoding: "utf8" });
  if (unzip.status !== 0) return null;
  const jsonPath = join(destDir, "auto3-evidence.json");
  if (!existsSync(jsonPath)) {
    for (const name of readdirSync(destDir)) {
      if (name.endsWith(".json")) {
        try {
          return JSON.parse(readFileSync(join(destDir, name), "utf8"));
        } catch {
          // continue
        }
      }
    }
    return null;
  }
  try {
    return JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Cap untrusted workflow logs while keeping head + tail.
 * AUTO-1 structured results (outcome/prUrl/conflictedFiles) are emitted near
 * the end after a large changedFiles dump; head-only truncation drops them.
 * @param {string} text
 * @param {{ maxTotal?: number, head?: number, tail?: number }} [opts]
 */
export function clipLogTextKeepTail(text, opts = {}) {
  const src = String(text || "");
  const maxTotal = Number(opts.maxTotal ?? 200_000);
  const head = Number(opts.head ?? 80_000);
  const tail = Number(opts.tail ?? 120_000);
  if (src.length <= maxTotal) return src;
  const h = Math.max(0, head);
  const t = Math.max(0, tail);
  if (h + t >= src.length) return src;
  return `${src.slice(0, h)}\n/* …steward log truncated… */\n${src.slice(-t)}`;
}

/**
 * Fetch workflow run logs as text. Prefer `gh run view --log`; fall back to
 * per-job archive logs when the view path is empty (common for older runs).
 * @param {string} repo
 * @param {string|number} runId
 */
export function fetchWorkflowRunLogText(repo, runId) {
  const view = spawnSync(
    "gh",
    ["run", "view", String(runId), "--repo", repo, "--log"],
    { encoding: "utf8", maxBuffer: 40 * 1024 * 1024 },
  );
  let text = view.stdout || "";
  if (text.length < 1024) {
    const jobs = ghJson([
      "api",
      `repos/${repo}/actions/runs/${runId}/jobs?per_page=30`,
    ]);
    /** @type {string[]} */
    const parts = [];
    for (const job of jobs.data?.jobs || []) {
      const lr = spawnSync(
        "gh",
        ["api", `repos/${repo}/actions/jobs/${job.id}/logs`],
        { encoding: "utf8", maxBuffer: 40 * 1024 * 1024 },
      );
      if (lr.status === 0 && lr.stdout) parts.push(lr.stdout);
    }
    if (parts.length) text = parts.join("\n");
  }
  return clipLogTextKeepTail(text);
}
