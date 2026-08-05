#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1B 2026-08-05:
 * Authority guard — S1B may push repair branches / open PRs / invoke dual review,
 * but must never deploy, touch Host P, or merge.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} text
 * @param {"source"|"workflow"} kind
 */
export function scanS1bAuthorityText(text, kind = "source") {
  /** @type {{ id: string, message: string, match: string }[]} */
  const hits = [];
  const s = String(text || "");

  if (/\$\{\{\s*secrets\.HOST_P_/i.test(s)) {
    hits.push({
      id: "host-p-secret",
      message: "Host P secret references forbidden in S1B",
      match: "${{ secrets.HOST_P_",
    });
  }
  if (/\$\{\{\s*secrets\.HOST_D_/i.test(s)) {
    hits.push({
      id: "host-d-secret",
      message: "Host D deploy secret references forbidden in S1B",
      match: "${{ secrets.HOST_D_",
    });
  }

  const stripped = s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*#.*$/gm, "");

  for (const ln of stripped.split("\n")) {
    if (/\bgrep\b/.test(ln) || /\becho\b/.test(ln) || /::error::/.test(ln)) continue;
    // Allow documenting forbidden strings in tests via assert.doesNotMatch / comments already stripped.
    if (/\bgh\s+pr\s+merge\b/.test(ln)) {
      hits.push({
        id: "gh-pr-merge",
        message: "gh pr merge forbidden inside S1B",
        match: ln.trim().slice(0, 120),
      });
    }
    if (/\bwriterRevalidateAndMaybeMerge\s*\(/.test(ln)) {
      hits.push({
        id: "writer-merge",
        message: "writer merge forbidden inside S1B",
        match: ln.trim().slice(0, 120),
      });
    }
    if (/\bauto3-build-release\b/.test(ln) || /\bauto3-hostd-deploy\b/.test(ln)) {
      hits.push({
        id: "deploy-authority",
        message: "deployment authority forbidden inside S1B",
        match: ln.trim().slice(0, 120),
      });
    }
  }

  if (kind === "workflow") {
    if (/permission-deployments:\s*write/i.test(s)) {
      hits.push({
        id: "deployments-write",
        message: "deployments:write forbidden in S1B workflow",
        match: "permission-deployments: write",
      });
    }
  }

  return hits;
}

/**
 * @param {string} dir
 * @param {string[]} [acc]
 */
function listSourceFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) listSourceFiles(p, acc);
    else if ([".mjs", ".js"].includes(extname(p))) {
      if (name === "guard-authority.mjs") continue;
      acc.push(p);
    }
  }
  return acc;
}

/**
 * @param {{ packageDir?: string }} [opts]
 */
export function assertS1bAuthority(opts = {}) {
  const packageDir = opts.packageDir || HERE;
  /** @type {{ file: string, id: string, message: string, match: string }[]} */
  const violations = [];
  for (const file of listSourceFiles(packageDir)) {
    const text = readFileSync(file, "utf8");
    for (const hit of scanS1bAuthorityText(text, "source")) {
      violations.push({ file, ...hit });
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * @param {Parameters<typeof assertS1bAuthority>[0]} [opts]
 */
export function guardS1bAuthorityOrThrow(opts) {
  const result = assertS1bAuthority(opts);
  if (!result.ok) {
    const msg = result.violations
      .map((v) => `${v.file}: ${v.id} — ${v.message}`)
      .join("\n");
    throw new Error(`S1B authority guard failed:\n${msg}`);
  }
  return result;
}
