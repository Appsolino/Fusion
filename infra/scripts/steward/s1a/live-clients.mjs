#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Live GitHub clients (read) + write helpers for upsert job only.
 * Analyze must use read token (GITHUB_TOKEN). Upsert uses App issues:write.
 */
import { S1A_LABEL_LIST } from "./policy.mjs";
import { inferSensitiveTouches, parseRunIdFromOccurrence } from "./evidence-pack.mjs";

/**
 * @param {{ repo: string, token?: string, fetchImpl?: typeof fetch }} opts
 */
function makeGh(opts) {
  const repo = opts.repo;
  const token = opts.token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN/GH_TOKEN required");
  const fetchImpl = opts.fetchImpl || globalThis.fetch;

  /**
   * @param {string} path
   * @param {RequestInit} [init]
   */
  async function gh(path, init = {}) {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: init.headers?.Accept || "application/vnd.github+json",
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
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return res.arrayBuffer();
  }

  return { repo, token, gh };
}

/**
 * Read-only clients for analyze job (contents/actions/pull-requests/issues read).
 * @param {{ repo: string, token?: string, fetchImpl?: typeof fetch }} opts
 */
export function createLiveReadClients(opts) {
  const { repo, gh } = makeGh(opts);

  return {
    kind: "read",
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
      return all.map((c) => ({
        id: c.id,
        body: c.body || "",
        user: c.user?.login,
        bodyExcerpt: String(c.body || "").slice(0, 500),
      }));
    },
    async getRelatedPr(prNumber) {
      if (!prNumber) return null;
      const pr = await gh(`/repos/${repo}/pulls/${prNumber}`);
      const files = await gh(`/repos/${repo}/pulls/${prNumber}/files?per_page=100`);
      const changedFiles = (files || []).map((f) => f.filename);
      const patchExcerpt = (files || [])
        .map((f) => `### ${f.filename}\n${(f.patch || "").slice(0, 2000)}`)
        .join("\n\n")
        .slice(0, 20000);
      const inf = inferSensitiveTouches(changedFiles);
      return {
        number: pr.number,
        url: pr.html_url,
        title: pr.title,
        changedFiles,
        patchExcerpt,
        touchesWorkflows: inf.touchesWorkflows ? true : null,
        touchesMigrations: inf.touchesMigrations ? true : null,
        touchesLockfile: inf.touchesLockfile ? true : null,
      };
    },
    /**
     * Fetch workflow run logs as capped plain text.
     * Prefer per-job plain-text logs; fall back to unzipping the run archive.
     * @param {string|null} runId
     */
    async getWorkflowRunLogs(runId) {
      if (!runId) return null;
      try {
        const { decodeRunLogArchive, finalizeLogText, looksLikeZip, toBuffer } =
          await import("./log-decode.mjs");

        // Option B: list jobs → download each job log (plain text).
        try {
          const jobsPayload = await gh(
            `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
          );
          const jobs = jobsPayload?.jobs || [];
          /** @type {string[]} */
          const parts = [];
          for (const job of jobs) {
            if (!job?.id) continue;
            try {
              const jobBuf = await gh(`/repos/${repo}/actions/jobs/${job.id}/logs`, {
                headers: { Accept: "application/vnd.github+json" },
              });
              const buf = toBuffer(jobBuf);
              if (looksLikeZip(buf)) continue;
              const text = buf.toString("utf8");
              if (!text || text.includes("\u0000")) continue;
              parts.push(`===== job ${job.id} ${job.name || ""} =====\n${text}`);
            } catch {
              /* try next job */
            }
          }
          if (parts.length) {
            return {
              runId: String(runId),
              ...finalizeLogText(parts.join("\n\n"), { source: "job-logs" }),
            };
          }
        } catch {
          /* fall through to archive */
        }

        // Option A: run-level archive → unzip safely.
        const archive = await gh(`/repos/${repo}/actions/runs/${runId}/logs`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        const buf = toBuffer(archive);
        if (looksLikeZip(buf)) {
          const decoded = decodeRunLogArchive(buf);
          return { runId: String(runId), ...decoded };
        }
        return {
          runId: String(runId),
          ...finalizeLogText(buf.toString("utf8"), { source: "run-logs-plain" }),
        };
      } catch {
        return { runId: String(runId), excerpt: null, truncated: false, format: "error" };
      }
    },
    async tryFetchAuto3Evidence(_hint) {
      // Optional linked artifact — null when absent (never invent).
      return null;
    },
    labels: {
      async getIssueLabels(number) {
        const issue = await gh(`/repos/${repo}/issues/${number}`);
        return (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
      },
    },
  };
}

/**
 * Write clients for upsert-advice job only (App token issues:write).
 * @param {{ repo: string, token?: string, fetchImpl?: typeof fetch }} opts
 */
export function createLiveWriteClients(opts) {
  const { repo, gh } = makeGh(opts);
  return {
    kind: "write",
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

/**
 * @deprecated Prefer createLiveReadClients / createLiveWriteClients.
 */
export function createLiveClients(opts) {
  const read = createLiveReadClients(opts);
  const write = createLiveWriteClients(opts);
  return {
    getIssue: read.getIssue.bind(read),
    relatedPr: async (pack) => {
      const url = pack?.auto1?.prUrl || "";
      const m = String(url).match(/\/pull\/(\d+)/);
      if (!m) return null;
      return read.getRelatedPr(Number(m[1]));
    },
    labels: write.labels,
    comments: write.comments,
  };
}

export { parseRunIdFromOccurrence };
