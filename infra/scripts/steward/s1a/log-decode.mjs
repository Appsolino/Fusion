#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Decode GitHub Actions run logs into capped head+tail plain text.
 * Prefer per-job plain-text logs; fall back to unzipping the run archive.
 */
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { clipLogTextKeepTail } from "../live-evidence.mjs";
import { S1A_BOUNDS } from "./policy.mjs";

/**
 * @param {unknown} buf
 * @returns {Buffer}
 */
export function toBuffer(buf) {
  if (Buffer.isBuffer(buf)) return buf;
  if (buf instanceof ArrayBuffer) return Buffer.from(buf);
  if (ArrayBuffer.isView(buf)) {
    return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (typeof buf === "string") return Buffer.from(buf, "utf8");
  return Buffer.from(String(buf || ""), "utf8");
}

/**
 * Detect ZIP (PK..) magic — run-level /logs returns an archive.
 * @param {Buffer} buf
 */
export function looksLikeZip(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

/**
 * Concatenate text files under dir (best-effort, size-capped per file).
 * @param {string} dir
 * @param {number} [maxPerFile]
 */
export function collectTextFiles(dir, maxPerFile = 64_000) {
  /** @type {string[]} */
  const parts = [];
  /** @type {string[]} */
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let names = [];
    try {
      names = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = join(cur, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!/\.(txt|log)$/i.test(name) && !name.includes("step")) {
        // Still try unknown small files that are mostly text.
        if (st.size > maxPerFile * 2) continue;
      }
      try {
        const raw = readFileSync(p);
        // Skip obvious binaries.
        if (looksLikeZip(raw)) continue;
        const text = raw.toString("utf8");
        if (text.includes("\u0000")) continue;
        parts.push(`===== ${p.slice(dir.length + 1)} =====\n${text.slice(0, maxPerFile)}`);
      } catch {
        /* ignore */
      }
    }
  }
  return parts.join("\n\n");
}

/**
 * Unzip run archive buffer into capped plain text.
 * @param {Buffer} zipBuf
 * @param {{ maxTotal?: number }} [opts]
 */
export function decodeRunLogArchive(zipBuf, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "s1a-runlogs-"));
  try {
    const zipPath = join(dir, "logs.zip");
    writeFileSync(zipPath, zipBuf);
    const unzip = spawnSync("unzip", ["-o", "-q", zipPath, "-d", dir], {
      encoding: "utf8",
    });
    if (unzip.status !== 0) {
      throw new Error(
        `unzip run-log archive failed: ${(unzip.stderr || unzip.stdout || "").slice(0, 300)}`,
      );
    }
    const text = collectTextFiles(dir);
    const clipped = clipLogTextKeepTail(text, {
      maxTotal: opts.maxTotal ?? S1A_BOUNDS.maxWorkflowLogBytes,
    });
    return {
      format: "zip-archive",
      excerpt: clipped,
      truncated: clipped.includes("steward log truncated"),
      byteLength: zipBuf.length,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Build evidence log object from already-fetched job texts.
 * @param {string} joined
 * @param {{ maxTotal?: number, source?: string }} [opts]
 */
export function finalizeLogText(joined, opts = {}) {
  const clipped = clipLogTextKeepTail(joined, {
    maxTotal: opts.maxTotal ?? S1A_BOUNDS.maxWorkflowLogBytes,
  });
  return {
    format: opts.source || "plain-text",
    excerpt: clipped,
    truncated: clipped.includes("steward log truncated"),
    byteLength: Buffer.byteLength(joined, "utf8"),
  };
}
