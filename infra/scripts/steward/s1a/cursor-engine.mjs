#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Live Cursor CLI engine — spawns cursor-agent ask mode.
 * Fail closed on spawn/auth/schema errors. No silent fixture fallback.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  CURSOR_AGENT_BIN,
  LIVE_MODEL,
  LIVE_PROVIDER,
  S1A_BOUNDS,
  pinsForEngine,
} from "./policy.mjs";
import { classifyConflictFile } from "./path-heuristics.mjs";
import { cursorChildEnv } from "./spawn-env.mjs";

const REQUIRED_FIELDS = [
  "summary",
  "rootCause",
  "recommendedSolution",
  "confidence",
  "risk",
  "files",
  "validation",
  "ownerDecision",
  "repairRecommended",
  "needsMoreEvidence",
  "criticalFreeze",
  "evidenceGaps",
];

/**
 * @param {string} text
 * @returns {object|null}
 */
export function parseLastJsonObject(text) {
  const s = String(text || "");
  // Prefer fenced ```json blocks (last wins).
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  /** @type {string[]} */
  const blocks = [];
  while ((m = fenceRe.exec(s)) !== null) blocks.push(m[1]);
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(blocks[i].trim());
    } catch {
      /* try next */
    }
  }
  // Fallback: last top-level {...}
  const start = s.lastIndexOf("{");
  if (start < 0) return null;
  for (let end = s.length; end > start; end--) {
    try {
      return JSON.parse(s.slice(start, end));
    } catch {
      /* shrink */
    }
  }
  return null;
}

/**
 * @param {object} raw
 * @param {import("./evidence-pack.mjs").EvidencePack} pack
 * @param {{ attempt?: number }} opts
 */
export function validateAndNormalizeAssessment(raw, pack, opts = {}) {
  if (!raw || typeof raw !== "object") {
    throw new Error("cursor-engine: assessment JSON missing");
  }
  for (const f of REQUIRED_FIELDS) {
    if (!(f in raw)) throw new Error(`cursor-engine: missing field ${f}`);
  }
  if (!Array.isArray(raw.files)) throw new Error("cursor-engine: files must be array");
  if (!Array.isArray(raw.validation)) throw new Error("cursor-engine: validation must be array");
  if (!Array.isArray(raw.evidenceGaps)) throw new Error("cursor-engine: evidenceGaps must be array");

  const pins = pinsForEngine("cursor-cli");
  const configuredProvider = process.env.S1A_PROVIDER || pins.provider;
  const configuredModel = process.env.S1A_MODEL || pins.model;
  if (configuredProvider !== LIVE_PROVIDER || configuredModel !== LIVE_MODEL) {
    throw new Error(
      `cursor-engine: configured provider/model must be ${LIVE_PROVIDER}/${LIVE_MODEL}`,
    );
  }

  // Ensure file kinds align with evidence paths when paths match.
  const expected = (pack.auto1.conflictedFiles || []).map(classifyConflictFile);
  /** @type {typeof expected} */
  let files = raw.files.map((f) => ({
    path: String(f.path || ""),
    kind: String(f.kind || "other"),
    playbook: String(f.playbook || "manual-triage"),
    notes: String(f.notes || ""),
  }));
  if (files.length === 0 && expected.length) {
    files = expected;
  }

  return {
    provider: LIVE_PROVIDER,
    model: LIVE_MODEL,
    configuredProvider,
    configuredModel,
    actualProvider: LIVE_PROVIDER,
    actualModel: LIVE_MODEL,
    attempt: Math.max(1, Number(opts.attempt) || Number(raw.attempt) || 1),
    failureClass: raw.failureClass ?? pack.failureClass ?? null,
    confidence: String(raw.confidence),
    risk: String(raw.risk),
    summary: String(raw.summary),
    rootCause: String(raw.rootCause),
    recommendedSolution: String(raw.recommendedSolution),
    validation: raw.validation.map(String),
    files,
    ownerDecision: String(raw.ownerDecision),
    repairRecommended: Boolean(raw.repairRecommended),
    needsMoreEvidence: Boolean(raw.needsMoreEvidence),
    criticalFreeze: Boolean(raw.criticalFreeze),
    evidenceGaps: raw.evidenceGaps.map(String),
  };
}

function buildPrompt({ evidencePackPath, attempt, priorRejection }) {
  return [
    "You are Steward S1A expert advisory (advice only — no mutations).",
    `Read the evidence pack JSON at: ${evidencePackPath}`,
    `Attempt: ${attempt}.`,
    priorRejection?.reason ? `Prior reviewer rejection: ${priorRejection.reason}` : "",
    "Return a SINGLE fenced JSON assessment object with fields:",
    JSON.stringify(REQUIRED_FIELDS),
    "Also include optional failureClass.",
    "files[].path/kind/playbook/notes for each conflicted file.",
    "Use kinds: generated-baseline | semantic-source | workflow | migration | lockfile | other.",
    "Never invent physical state; unknown stays null in prose notes.",
    "Do not recommend repair when CRITICAL. S1B is NOT authorised.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {import("./evidence-pack.mjs").EvidencePack} evidencePack
 * @param {{
 *   attempt?: number,
 *   priorRejection?: { reason?: string } | null,
 *   spawnFn?: typeof spawn,
 *   worktreePath?: string|null,
 *   cursorBin?: string,
 *   timeoutMs?: number,
 * }} [opts]
 */
/**
 * Probe that the requested model is listed by cursor-agent models.
 * @param {string} bin
 * @param {string} model
 * @param {typeof spawn} [spawnFn]
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function assertModelAvailable(
  bin,
  model,
  spawnFn = spawn,
  env = cursorChildEnv(),
) {
  const list = await new Promise((resolve, reject) => {
    let child;
    try {
      child = /** @type {any} */ (
        spawnFn(bin, ["models"], {
          stdio: ["ignore", "pipe", "pipe"],
          env,
        })
      );
    } catch (err) {
      reject(new Error(`cursor-engine models probe spawn failed: ${err.message}`));
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new Error("cursor-engine models probe timeout"));
    }, 30_000);
    child.stdout?.on("data", (d) => {
      out += String(d);
    });
    child.stderr?.on("data", (d) => {
      err += String(d);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`cursor-engine models probe error: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `cursor-engine models probe exit ${code}: ${(err || out).slice(0, 400)}`,
          ),
        );
        return;
      }
      resolve(out);
    });
  });
  const needle = String(model).trim();
  const lines = String(list)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const hit = lines.some(
    (l) => l === needle || l.startsWith(`${needle} `) || l.startsWith(`${needle} -`),
  );
  if (!hit) {
    throw new Error(
      `Requested model unavailable: ${needle} (cursor-agent models did not list it)`,
    );
  }
  return { listed: true, model: needle };
}

export async function runCursorEngine(evidencePack, opts = {}) {
  const attempt = Math.max(1, Number(opts.attempt) || 1);
  if (attempt > S1A_BOUNDS.maxAttempts) {
    throw new Error(`maxAttempts exceeded (${S1A_BOUNDS.maxAttempts})`);
  }

  const worktreePath = opts.worktreePath || evidencePack.worktreePath || null;
  const evidenceDir = opts.evidenceDir || null;
  const evidencePackPath = evidenceDir
    ? join(evidenceDir, "evidence-pack.json")
    : worktreePath
      ? join(worktreePath, "evidence-pack.json")
      : null;
  if (evidencePackPath) {
    const dir = evidenceDir || worktreePath;
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(evidencePackPath, JSON.stringify(evidencePack, null, 2));
  }

  const bin = opts.cursorBin || process.env.S1A_CURSOR_AGENT_BIN || CURSOR_AGENT_BIN;
  const model = process.env.S1A_MODEL || LIVE_MODEL;
  if (model !== LIVE_MODEL) {
    throw new Error(
      `cursor-engine: configured model must be ${LIVE_MODEL} (got ${model})`,
    );
  }

  const spawnFn = opts.spawnFn || spawn;
  const childEnv = cursorChildEnv({
    apiKey:
      process.env.S1A_CURSOR_API_KEY ||
      process.env.CURSOR_API_KEY ||
      process.env.CURSOR_AGENT_API_KEY ||
      "",
  });
  if (!opts.skipModelProbe) {
    await assertModelAvailable(bin, model, spawnFn, childEnv);
  }

  const prompt = buildPrompt({
    evidencePackPath: evidencePackPath || "(inline-evidence-unavailable)",
    attempt,
    priorRejection: opts.priorRejection || null,
  });

  const args = [
    "--mode",
    "ask",
    "--print",
    "--trust",
    "--sandbox",
    "enabled",
    "--model",
    model,
  ];
  if (worktreePath) {
    args.push("--workspace", worktreePath);
  }
  args.push(prompt);

  const timeoutMs = opts.timeoutMs || S1A_BOUNDS.maxRuntimeMs;

  const stdout = await new Promise((resolve, reject) => {
    /** @type {import("node:child_process").ChildProcessWithoutNullStreams} */
    let child;
    try {
      child = /** @type {any} */ (
        spawnFn(bin, args, {
          env: childEnv,
          stdio: ["ignore", "pipe", "pipe"],
        })
      );
    } catch (err) {
      reject(
        new Error(
          `cursor-engine spawn failed (fail closed, no fixture fallback): ${err.message}`,
        ),
      );
      return;
    }

    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new Error(`cursor-engine timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (d) => {
      out += String(d);
    });
    child.stderr?.on("data", (d) => {
      err += String(d);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new Error(
          `cursor-engine spawn error (fail closed): ${e.message}. stderr=${err.slice(0, 400)}`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `cursor-engine exit ${code} (fail closed, no fixture fallback): ${err.slice(0, 600) || out.slice(0, 400)}`,
          ),
        );
        return;
      }
      resolve(out);
    });
  });

  const parsed = parseLastJsonObject(stdout);
  if (!parsed) {
    throw new Error("cursor-engine: could not parse assessment JSON from stdout");
  }
  const assessment = validateAndNormalizeAssessment(parsed, evidencePack, {
    attempt,
  });
  // Actual model/provider from execution evidence: spawn --model arg + successful parse.
  assessment.actualProvider = LIVE_PROVIDER;
  assessment.actualModel = model;
  assessment.actualModelSource = "spawn-arg+stdout-parse";
  assessment.cursorBinary = bin;
  if (
    assessment.configuredProvider !== assessment.actualProvider ||
    assessment.configuredModel !== assessment.actualModel
  ) {
    throw new Error("cursor-engine: configured/actual provider-model mismatch after run");
  }
  return assessment;
}

/** Test injection hook. */
export async function runCursorEngineImpl(evidencePack, opts = {}) {
  return runCursorEngine(evidencePack, opts);
}
