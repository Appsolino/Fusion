#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("gh PR meta compat", () => {
  it("does not request baseRefOid from gh pr view --json", () => {
    const src = readFileSync(join(here, "../gh-pr.mjs"), "utf8");
    const jsonFlag = src.match(/"--json",\s*\n\s*"([^"]+)"/);
    assert.ok(jsonFlag, "expected --json field list");
    assert.equal(jsonFlag[1].includes("baseRefOid"), false);
    assert.ok(jsonFlag[1].includes("headRefOid"));
    assert.ok(jsonFlag[1].includes("statusCheckRollup"));
    assert.match(src, /repos\/\$\{input\.repo\}\/pulls\/\$\{input\.prNumber\}/);
  });

  it("orchestrator and writer use fetchPullRequestMeta", () => {
    const orch = readFileSync(join(here, "../run-dual-approve.mjs"), "utf8");
    const writer = readFileSync(join(here, "../writer.mjs"), "utf8");
    assert.match(orch, /fetchPullRequestMeta/);
    assert.match(writer, /fetchPullRequestMeta/);
    assert.equal(/baseRefOid,headRefOid/.test(orch), false);
    assert.equal(/baseRefOid,headRefOid/.test(writer), false);
  });
});
