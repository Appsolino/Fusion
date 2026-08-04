#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Live GitHub clients for S1A (App token via GH_TOKEN). Read/write issues only.
 * Never dispatches workflows or touches Host D/P.
 */
import { S1A_LABEL_LIST } from "./policy.mjs";

/**
 * @param {{ repo: string, token?: string, fetchImpl?: typeof fetch }} opts
 */
export function createLiveClients(opts) {
  const repo = opts.repo;
  const token = opts.token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN required for live S1A clients");
  const fetchImpl = opts.fetchImpl || globalThis.fetch;

  /**
   * @param {string} path
   * @param {RequestInit} [init]
   */
  async function gh(path, init = {}) {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${res.status} ${path}: ${text.slice(0, 400)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    async getIssue(number) {
      const issue = await gh(`/repos/${repo}/issues/${number}`);
      return {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        body: issue.body || "",
        labels: (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
      };
    },
    labels: {
      async getIssueLabels(number) {
        const issue = await gh(`/repos/${repo}/issues/${number}`);
        return (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
      },
      async addLabels(number, labels) {
        await gh(`/repos/${repo}/issues/${number}/labels`, {
          method: "POST",
          body: JSON.stringify({ labels }),
        });
      },
      async removeLabels(number, labels) {
        for (const label of labels) {
          const enc = encodeURIComponent(label);
          try {
            await gh(`/repos/${repo}/issues/${number}/labels/${enc}`, { method: "DELETE" });
          } catch (err) {
            // 404 = already absent
            if (!String(err.message || "").includes("404")) throw err;
          }
        }
      },
      async ensureLabelsExist(labels = S1A_LABEL_LIST) {
        for (const name of labels) {
          try {
            await gh(`/repos/${repo}/labels/${encodeURIComponent(name)}`);
          } catch {
            await gh(`/repos/${repo}/labels`, {
              method: "POST",
              body: JSON.stringify({
                name,
                color: "0e8a16",
                description: "Appsolino Steward S1A",
              }),
            });
          }
        }
      },
    },
    comments: {
      async listComments(number) {
        /** @type {any[]} */
        const all = [];
        let page = 1;
        for (;;) {
          const batch = await gh(
            `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`,
          );
          if (!batch.length) break;
          all.push(...batch);
          if (batch.length < 100) break;
          page += 1;
        }
        return all.map((c) => ({ id: c.id, body: c.body || "", user: c.user?.login }));
      },
      async createComment(number, body) {
        const c = await gh(`/repos/${repo}/issues/${number}/comments`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
        return { id: c.id, body: c.body || "" };
      },
      async updateComment(commentId, body) {
        const c = await gh(`/repos/${repo}/issues/comments/${commentId}`, {
          method: "PATCH",
          body: JSON.stringify({ body }),
        });
        return { id: c.id, body: c.body || "" };
      },
    },
  };
}
