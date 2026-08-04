#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Assert S1A workflow YAML / package have no Host D/P secrets, AUTO dispatch,
 * or repair-branch mutation commands.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} text
 * @param {"workflow"|"source"} kind
 */
export function scanAuthorityText(text, kind) {
  /** @type {{ id: string, message: string, match: string }[]} */
  const hits = [];
  const s = String(text || "");

  const hostD = s.match(/\$\{\{\s*secrets\.HOST_D_/i);
  if (hostD) hits.push({ id: "host-d-secret", message: "Host D secret references forbidden", match: hostD[0] });

  const hostP = s.match(/\$\{\{\s*secrets\.HOST_P_/i);
  if (hostP) hits.push({ id: "host-p-secret", message: "Host P secret references forbidden", match: hostP[0] });

  // Strip line comments / block comments lightly before command greps on source,
  // but workflow YAML uses # comments — remove those too for command detection.
  const stripped = s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*#.*$/gm, "");

  // Flag real command invocations; ignore static grep-guard lines that mention the banned string.
  for (const ln of stripped.split("\n")) {
    if (/\bgrep\b/.test(ln) || /\becho\b/.test(ln) || /::error::/.test(ln) || /\bawk\b/.test(ln)) continue;
    if (/\bgh\s+workflow\s+run\b/.test(ln)) {
      hits.push({ id: "gh-workflow-run", message: "gh workflow run (AUTO dispatch) forbidden", match: ln.trim() });
    }
    if (/\bgh\s+run\s+rerun\b/.test(ln)) {
      hits.push({ id: "gh-run-rerun", message: "gh run rerun forbidden", match: ln.trim() });
    }
  }
  if (/\bgit\s+push\b[\s\S]{0,80}\brepair\//.test(stripped) || /\bgit\s+checkout\s+-b\s+repair\//.test(stripped)) {
    hits.push({ id: "repair-branch-cmd", message: "repair branch commands forbidden in S1A", match: "repair/" });
  }

  if (kind === "workflow") {
    if (/^[ \t]*issues:[ \t]*write[ \t]*$/m.test(s)) {
      hits.push({
        id: "issues-write-workflow-token",
        message: "workflow-level issues:write forbidden (use App token job)",
        match: "issues: write",
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
    if (name === "node_modules" || name === "fixtures") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "__tests__") continue;
      listSourceFiles(p, acc);
    } else if ([".mjs", ".js"].includes(extname(p))) {
      if (name === "guard-authority.mjs") continue;
      acc.push(p);
    }
  }
  return acc;
}

/**
 * @param {{
 *   packageDir?: string,
 *   workflowPath?: string|null,
 * }} [opts]
 */
export function assertS1aAuthority(opts = {}) {
  const packageDir = opts.packageDir || HERE;
  const defaultWf = join(
    packageDir,
    "..",
    "..",
    "..",
    "..",
    ".github",
    "workflows",
    "upstream-reliability-steward-s1a.yml",
  );
  const workflowPath = opts.workflowPath === undefined ? defaultWf : opts.workflowPath;

  /** @type {{ file: string, id: string, message: string, match: string }[]} */
  const violations = [];

  for (const file of listSourceFiles(packageDir)) {
    const text = readFileSync(file, "utf8");
    for (const hit of scanAuthorityText(text, "source")) {
      violations.push({ file, ...hit });
    }
  }

  if (workflowPath && existsSync(workflowPath)) {
    const wf = readFileSync(workflowPath, "utf8");
    for (const hit of scanAuthorityText(wf, "workflow")) {
      violations.push({ file: workflowPath, ...hit });
    }
  } else if (opts.workflowPath) {
    violations.push({
      file: String(opts.workflowPath),
      id: "workflow-missing",
      message: "workflow file missing",
      match: "",
    });
  }

  return { ok: violations.length === 0, violations };
}

/**
 * @param {Parameters<typeof assertS1aAuthority>[0]} [opts]
 */
export function guardAuthorityOrThrow(opts) {
  const result = assertS1aAuthority(opts);
  if (!result.ok) {
    const msg = result.violations
      .map((v) => `${v.file}: ${v.id} — ${v.message}`)
      .join("\n");
    throw new Error(`S1A authority guard failed:\n${msg}`);
  }
  return result;
}

function parseArgs(argv) {
  /** @type {{ workflow?: string }} */
  const out = {};
  for (const a of argv) {
    if (a.startsWith("--workflow=")) out.workflow = a.slice("--workflow=".length);
  }
  return out;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const r = assertS1aAuthority({
    workflowPath: args.workflow || undefined,
  });
  if (!r.ok) {
    console.error(JSON.stringify(r, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, violations: [] }));
}
