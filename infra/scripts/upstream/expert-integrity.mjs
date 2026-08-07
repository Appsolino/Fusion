#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamAiProtocol 2026-08-07-09:20:
 * Deterministic integrity for expert repair must detect REAL merge-conflict markers,
 * not prose/fixtures that mention `<<<<<<<` (docs, prompts, census fixtures).
 * Match line-anchored markers only in dirty / expert-touched paths. A whole-tree
 * substring or even line-anchored grep falsely fails on fixture files that embed
 * `<<<<<<< HEAD` samples (observed on #133).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MARKER_RE = /^<<<<<<< |^=======$|^>>>>>>> /m;

/**
 * @param {string} worktreePath
 * @returns {{ passed: boolean, failures: string[], detail?: string }}
 */
export function runExpertIntegrityChecks(worktreePath) {
  const wt = String(worktreePath || "");
  if (!wt) return { passed: false, failures: ["worktree path missing"] };

  const oid = spawnSync("git", ["-C", wt, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (oid.status !== 0) return { passed: false, failures: ["cannot read HEAD"] };

  const unmerged = spawnSync("git", ["-C", wt, "ls-files", "-u"], { encoding: "utf8" });
  if (unmerged.status === 0 && unmerged.stdout.trim()) {
    return {
      passed: false,
      failures: ["unmerged index paths present"],
      detail: unmerged.stdout.trim().slice(0, 2000),
    };
  }

  const dirtyPaths = listDirtyPaths(wt);
  /** @type {string[]} */
  const hits = [];
  for (const rel of dirtyPaths) {
    const full = join(wt, rel);
    if (!existsSync(full)) continue;
    let text;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (MARKER_RE.test(text)) hits.push(rel);
  }

  if (hits.length) {
    return {
      passed: false,
      failures: ["line-anchored conflict markers in expert-touched paths"],
      detail: hits.slice(0, 40).join("\n"),
    };
  }

  return { passed: true, failures: [] };
}

/**
 * @param {string} wt
 * @returns {string[]}
 */
function listDirtyPaths(wt) {
  const r = spawnSync("git", ["-C", wt, "status", "--porcelain", "-uall"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.status !== 0) return [];
  /** @type {Set<string>} */
  const paths = new Set();
  for (const line of String(r.stdout || "").split("\n")) {
    if (!line.trim()) continue;
    // XY PATH or XY ORIG -> PATH
    const rest = line.slice(3);
    if (rest.includes(" -> ")) {
      paths.add(rest.split(" -> ").pop().trim());
    } else {
      paths.add(rest.trim());
    }
  }
  return [...paths];
}
