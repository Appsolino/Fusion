#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Live issue upsert from observation JSON using Appsolino Automation App token.
 * Read-only evidence already collected; this process only mutates Issues.
 */
import { readFileSync } from "node:fs";
import { upsertIncident } from "./upsert-incident.mjs";
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
function createGithubIssueClient(token, repo) {
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

  return {
    async searchIssuesByMarker(fingerprint) {
      const q = encodeURIComponent(
        `repo:${repo} in:body "appsolino-steward-fingerprint: sha256:${fingerprint}"`,
      );
      const data = await gh(`/search/issues?q=${q}&per_page=10`);
      const out = [];
      for (const it of data.items || []) {
        const full = await gh(`/repos/${repo}/issues/${it.number}`);
        if (extractFingerprintFromIssueBody(full.body || "") === fingerprint) {
          out.push(full);
        }
      }
      return out;
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
  const results = [];
  for (const n of input.candidates || []) {
    results.push(await upsertIncident(client, n));
  }
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
