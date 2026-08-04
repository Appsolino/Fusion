#!/usr/bin/env node
/* eslint-env node */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requireXaiApiKey, resolveGrokModel } from "../client.mjs";
import {
  FORBIDDEN_GROK_ENV,
  assertNoWriteCreds,
  grokChildEnv,
} from "../policy.mjs";
import { sha256Text, validateVerdict } from "../verdict.mjs";
import { assertApprovalsStillValid } from "../approver.mjs";

function baseVerdict(over = {}) {
  return {
    schemaVersion: 1,
    role: "reviewer",
    verdict: "APPROVE",
    risk: "LOW",
    repository: "Appsolino/Fusion",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    diffSha256: "c".repeat(64),
    testsSha256: "d".repeat(64),
    blockingFindings: [],
    nonBlockingFindings: [],
    requiredChanges: [],
    evidenceChecked: ["diff"],
    authorityCheck: {
      hostP: false,
      production: false,
      destructiveData: false,
      secretExpansion: false,
    },
    configuredProvider: "xai",
    configuredModel: "grok-4.5-exact",
    actualProvider: "xai",
    actualModel: "grok-4.5-exact",
    modelFingerprint: "grok-4.5-exact",
    requestId: "req-1",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

describe("grok control plane", () => {
  it("missing key fail-closed", () => {
    const prev = process.env.XAI_API_KEY;
    try {
      delete process.env.XAI_API_KEY;
      assert.throws(() => requireXaiApiKey({ apiKey: "" }), /XAI_API_KEY missing/);
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });

  it("model drift / unavailable model fail-closed", async () => {
    await assert.rejects(
      () =>
        resolveGrokModel({
          apiKey: "k",
          fetchImpl: async () =>
            new Response(JSON.stringify({ data: [{ id: "grok-3" }] }), {
              status: 200,
            }),
        }),
      /unavailable/,
    );
  });

  it("structured output enforcement + malformed rejected", () => {
    assert.throws(() => validateVerdict({}), /schemaVersion/);
    assert.throws(
      () => validateVerdict(baseVerdict({ verdict: "YEET" })),
      /verdict invalid/,
    );
  });

  it("cross-repository target rejected", () => {
    assert.throws(
      () =>
        validateVerdict(baseVerdict({ repository: "Runfusion/Fusion" })),
      /cross-repository/,
    );
  });

  it("stale head / changed diff / changed tests / expired rejected", () => {
    const v = baseVerdict();
    assert.throws(
      () => validateVerdict(v, { expectHeadSha: "e".repeat(40) }),
      /stale head/,
    );
    assert.throws(
      () => validateVerdict(v, { expectDiffSha256: "f".repeat(64) }),
      /changed diff/,
    );
    assert.throws(
      () => validateVerdict(v, { expectTestsSha256: "f".repeat(64) }),
      /changed tests/,
    );
    assert.throws(
      () =>
        validateVerdict(baseVerdict({ expiresAt: "2000-01-01T00:00:00Z" }), {
          nowMs: Date.now(),
        }),
      /expired/,
    );
  });

  it("configured/actual model reporting required", () => {
    assert.throws(
      () =>
        validateVerdict(
          baseVerdict({ configuredModel: "a", actualModel: "b" }),
        ),
      /mismatch/,
    );
  });

  it("no write credentials in grok child env", () => {
    const env = grokChildEnv({
      apiKey: "xai-k",
      src: {
        PATH: "/bin",
        HOME: "/h",
        GITHUB_TOKEN: "gh",
        CURSOR_API_KEY: "c",
        APPSOLINO_AUTOMATION_APP_PRIVATE_KEY: "pk",
      },
    });
    assertNoWriteCreds(env);
    assert.equal(env.XAI_API_KEY, "xai-k");
    for (const k of FORBIDDEN_GROK_ENV) assert.equal(env[k], undefined);
  });

  it("candidate cannot self-approve; contexts must stay separate", () => {
    const reviewer = baseVerdict({ role: "reviewer", requestId: "same" });
    const approver = baseVerdict({ role: "approver", requestId: "same" });
    assert.throws(
      () =>
        assertApprovalsStillValid({
          reviewer,
          approver,
          currentHeadSha: reviewer.headSha,
          currentDiffSha256: reviewer.diffSha256,
          currentTestsSha256: reviewer.testsSha256,
        }),
      /self-approve/,
    );
    const ok = assertApprovalsStillValid({
      reviewer,
      approver: { ...approver, requestId: "other" },
      currentHeadSha: reviewer.headSha,
      currentDiffSha256: reviewer.diffSha256,
      currentTestsSha256: reviewer.testsSha256,
    });
    assert.equal(ok.reviewer.role, "reviewer");
    assert.equal(ok.approver.role, "approver");
  });

  it("sha256 digests are stable", () => {
    assert.equal(sha256Text("abc"), sha256Text("abc"));
    assert.notEqual(sha256Text("abc"), sha256Text("abd"));
  });

  it("resolveGrokModel pins exact alias when listed", async () => {
    const pin = await resolveGrokModel({
      apiKey: "k",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ data: [{ id: "grok-4.5" }, { id: "grok-3" }] }),
          { status: 200 },
        ),
    });
    assert.equal(pin.actualModel, "grok-4.5");
    assert.equal(pin.configuredProvider, "xai");
    assert.equal(pin.actualProvider, "xai");
  });
});
