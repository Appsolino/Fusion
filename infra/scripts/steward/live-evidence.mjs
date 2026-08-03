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
