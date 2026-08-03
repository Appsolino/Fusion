#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-03:
 * Live issue upsert from observation JSON using Appsolino Automation App token.
 * Read-only evidence already collected; this process only mutates Issues.
 *
 * Lookup lists steward-labeled issues (authoritative) instead of Search API
 * (eventually consistent). An in-process fingerprint session collapses
 * same-batch duplicates that previously produced #64/#65.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createUpsertSession, upsertIncident } from "./upsert-incident.mjs";
import { extractFingerprintFromIssueBody } from "./policy.mjs";

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * @param {string} token
 * @param {string} repo
 */
export function createGithubIssueClient(token, repo) {
  async function gh(path, init = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${res.status} ${path}: ${t}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /**
   * Authoritative lookup: list steward-labeled issues and match the marker.
   * @param {string} fingerprint
   */
  async function listStewardIssuesByMarker(fingerprint) {
    const fp = String(fingerprint || "").toLowerCase();
    /** @type {import("./upsert-incident.mjs").IssueLike[]} */
    const out = [];
    const seen = new Set();
    for (const state of ["open", "closed"]) {
      let page = 1;
      while (page <= 5) {
        const batch = await gh(
          `/repos/${repo}/issues?state=${state}&labels=${encodeURIComponent("appsolino-steward")}&per_page=100&page=${page}`,
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const it of batch) {
          if (it.pull_request) continue;
          if (extractFingerprintFromIssueBody(it.body || "") !== fp) continue;
          if (seen.has(it.number)) continue;
          seen.add(it.number);
          out.push(it);
        }
        if (batch.length < 100) break;
        page += 1;
      }
    }
    return out;
  }

  return {
    async searchIssuesByMarker(fingerprint) {
      return listStewardIssuesByMarker(fingerprint);
    },
    async createIssue({ title, body, labels }) {
      return gh(`/repos/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify({ title, body, labels }),
      });
    },
    async updateIssue(number, patch) {
      return gh(`/repos/${repo}/issues/${number}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
  };
}

export async function upsertFromCandidates(client, candidates, session = createUpsertSession()) {
  const results = [];
  for (const n of candidates || []) {
    results.push(await upsertIncident(client, n, session));
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!inputPath || !token || !repo) {
    throw new Error("require --input=, GH_TOKEN, GITHUB_REPOSITORY");
  }
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const client = createGithubIssueClient(token, repo);
  const results = await upsertFromCandidates(client, input.candidates || []);
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
