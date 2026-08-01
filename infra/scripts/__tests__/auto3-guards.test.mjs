#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto3 2026-08-01-01:20: Unit/integration harness for AUTO-3 guards + packaging admission.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, chmodSync, rmSync, cpSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  admitSourceSha,
  classifyIdempotentDeploy,
  verifyArtifactIntegrity,
  isAllowedReleaseRoot,
  containsHostPMarker,
  validateManifestShape,
  buildDeployResult,
} from "../auto3-guards.mjs";
import { buildAuto3Release } from "../auto3-build-release.mjs";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`not ok - ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`not ok - ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

test("exact-main SHA admitted when ancestor", () => {
  const r = admitSourceSha({
    sourceSha: "a".repeat(40),
    mainTipSha: "b".repeat(40),
    isAncestorOfMain: true,
  });
  assert.equal(r.admitted, true);
});

test("PR-head-only SHA rejected", () => {
  const r = admitSourceSha({
    sourceSha: "a".repeat(40),
    mainTipSha: "b".repeat(40),
    isAncestorOfMain: true,
    fromPrHeadOnly: true,
  });
  assert.equal(r.admitted, false);
  assert.match(r.reasons.join(" "), /pull-request head/);
});

test("stale / non-main SHA rejected", () => {
  const r = admitSourceSha({
    sourceSha: "a".repeat(40),
    mainTipSha: "b".repeat(40),
    isAncestorOfMain: false,
  });
  assert.equal(r.admitted, false);
});

test("expected merged SHA mismatch rejected", () => {
  const r = admitSourceSha({
    sourceSha: "a".repeat(40),
    mainTipSha: "a".repeat(40),
    isAncestorOfMain: true,
    expectedMergedSha: "c".repeat(40),
  });
  assert.equal(r.admitted, false);
});

test("duplicate SHA idempotent", () => {
  const r = classifyIdempotentDeploy({
    activeMainSha: "a".repeat(40),
    candidateMainSha: "a".repeat(40),
    activeExeSha256: "e".repeat(64),
    candidateExeSha256: "e".repeat(64),
    activeReleaseId: "auto3-x",
    candidateReleaseId: "auto3-x",
  });
  assert.equal(r.idempotent, true);
  assert.equal(r.action, "IDEMPOTENT_NOOP");
});

test("archive hash mismatch rejected", () => {
  const r = verifyArtifactIntegrity({
    expectedArchiveSha256: "1".repeat(64),
    actualArchiveSha256: "2".repeat(64),
    expectedExeSha256: "3".repeat(64),
    actualExeSha256: "3".repeat(64),
    expectedExeModeExecutable: true,
    actualExeModeExecutable: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /archive hash/);
});

test("executable mode mismatch rejected", () => {
  const r = verifyArtifactIntegrity({
    expectedArchiveSha256: "1".repeat(64),
    actualArchiveSha256: "1".repeat(64),
    expectedExeSha256: "3".repeat(64),
    actualExeSha256: "3".repeat(64),
    expectedExeModeExecutable: true,
    actualExeModeExecutable: false,
  });
  assert.equal(r.ok, false);
});

test("unknown / Host P path forbidden", () => {
  assert.equal(isAllowedReleaseRoot("/opt/appsolino-fusion/production/releases"), false);
  assert.equal(containsHostPMarker("/opt/appsolino-fusion/production"), true);
  assert.equal(isAllowedReleaseRoot("/opt/appsolino-fusion/staging/releases"), true);
});

test("manifest missing fields blocked", () => {
  const r = validateManifestShape({ sourceSha: "a".repeat(40) });
  assert.equal(r.ok, false);
});

test("deploy result never marks Host P", () => {
  const r = buildDeployResult("DEPLOYED", ["ok"]);
  assert.equal(r.deployedHostP, false);
});

test("workflow build job has no App/deploy secret wiring to candidate", () => {
  const text = readFileSync(join(ROOT, ".github/workflows/upstream-auto3-deploy.yml"), "utf8");
  assert.equal(text.includes("create-github-app-token"), false);
  assert.match(text, /Refuse deploy secrets in build zone/);
  assert.match(text, /environment: host-d-staging/);
  const buildSection = text.split("deploy:")[0];
  assert.match(buildSection, /persist-credentials:\s*false/);
  // Build job may reference secret names only to assert they are empty — never create-github-app-token
  assert.doesNotMatch(buildSection, /permission-contents:\s*write/);
});

test("deploy job never executes candidate package scripts", () => {
  const yml = readFileSync(join(ROOT, ".github/workflows/upstream-auto3-deploy.yml"), "utf8");
  const deploySection = yml.split(/^\s*deploy:/m)[1] || "";
  assert.equal(/pnpm (test|install|build)/.test(deploySection), false);
  assert.equal(/node infra\/scripts\/auto3-build/.test(deploySection), false);
  assert.match(deploySection, /environment: host-d-staging/);
});

await testAsync("skip-build packaging from fixture dist", async () => {
  const g13Dist = "/opt/appsolino-fusion/staging/releases/g13b-0.74.0-beta.5-cadf34dd4";
  if (!existsSync(join(g13Dist, "fn"))) {
    console.log("skip - no g13b dist on host");
    return;
  }
  const out = mkdtempSync(join(tmpdir(), "auto3-pack-"));
  const dist = join(out, "dist");
  mkdirSync(dist, { recursive: true });
  for (const n of ["fn", "client", "migrations", "plugins", "runtime"]) {
    if (existsSync(join(g13Dist, n))) cpSync(join(g13Dist, n), join(dist, n), { recursive: true });
  }
  chmodSync(join(dist, "fn"), 0o755);
  const result = await buildAuto3Release({
    sourceSha: "cadf34dd4305e540f82e0e6685b8b8a02d86fee4",
    skipBuild: true,
    distDir: dist,
    outDir: join(out, "artifacts"),
    allowMissingMain: true,
    deploymentReason: "unit-fixture",
  });
  assert.equal(result.ok, true);
  assert.ok(result.manifest.executableSha256);
  assert.ok(result.manifest.archiveSha256);
  rmSync(out, { recursive: true, force: true });
});

console.log(`\n${passed} tests passed`);
