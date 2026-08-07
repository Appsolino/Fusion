#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamLiveModelProof 2026-08-07-04:35:
 * Protected live-model integration proof. Invokes the actual configured Cursor model.
 * Proves credentials work, structured output returns, schema validates, metadata recorded,
 * and fail-closed when model unavailable. Never logs API keys or full sensitive prompts.
 *
 * Usage:
 *   node infra/scripts/upstream/live-model-proof.mjs [--json] [--allow-skip-if-unavailable]
 * Exit 0 on proof PASS; 2 on fail-closed unavailable when --allow-skip-if-unavailable;
 * Exit 1 on hard failure.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { runUpstreamExpertResolver } from "./expert-resolver.mjs";
import { runUpstreamAiVerifier } from "./ai-verifier.mjs";
import { validateExpertDecision, validateVerifierVerdict } from "./expert-decision-schema.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

async function main() {
  const args = new Set(process.argv.slice(2));
  const allowSkip = args.has("--allow-skip-if-unavailable");
  const asJson = args.has("--json");
  const started = Date.now();
  const outDir = join(ROOT, ".appsolino", "proofs");
  mkdirSync(outDir, { recursive: true });

  const evidence = {
    upstreamHead: "0".repeat(40),
    appsolinoBaseSha: "1".repeat(40),
    candidateUpstreamSha: "0".repeat(40),
    conflictedFiles: [],
    changedFiles: ["docs/appsolino/START-HERE.md"],
    failingTests: [],
    problemSummary: "live-model-proof: return a trivial RESOLVED structured decision for schema validation only; do not modify files",
  };

  const expert = await runUpstreamExpertResolver({
    worktreePath: ROOT,
    evidence,
    timeoutMs: 180_000,
  });

  const meta = {
    role: "live-model-proof",
    startedUtc: new Date(started).toISOString(),
    endedUtc: new Date().toISOString(),
    latencyMs: Date.now() - started,
    expert: {
      ok: expert.ok,
      action: expert.action,
      reason: expert.reason,
      configuredProvider: expert.configuredProvider,
      configuredModel: expert.configuredModel,
      actualProvider: expert.actualProvider,
      actualModel: expert.actualModel,
      schemaVersion: expert.schemaVersion,
      decisionOk: expert.decision ? validateExpertDecision(expert.decision).ok : false,
    },
  };

  if (!expert.ok) {
    meta.outcome = "FAIL_CLOSED_UNAVAILABLE_OR_INVALID";
    writeFileSync(join(outDir, "live-model-proof.json"), `${JSON.stringify(meta, null, 2)}\n`);
    if (asJson) process.stdout.write(`${JSON.stringify(meta, null, 2)}\n`);
    else process.stderr.write(`LIVE_MODEL_PROOF ${meta.outcome}: ${expert.reason}\n`);
    process.exit(allowSkip ? 2 : 1);
  }

  // Independent verifier invocation (separate call, fresh context).
  const verifier = await runUpstreamAiVerifier({
    worktreePath: ROOT,
    evidence: {
      originalProblem: "live-model-proof verifier: approve only if expert returned valid schema; otherwise REQUEST_CHANGES",
      diffText: "diff --git a/docs/appsolino/START-HERE.md b/docs/appsolino/START-HERE.md\n--- proof only ---\n",
      deterministicTestResults: { passed: true, failures: [] },
      riskClass: "LOW",
    },
    timeoutMs: 180_000,
  });

  meta.verifier = {
    ok: verifier.ok,
    action: verifier.action,
    reason: verifier.reason,
    configuredProvider: verifier.configuredProvider,
    configuredModel: verifier.configuredModel,
    actualProvider: verifier.actualProvider,
    actualModel: verifier.actualModel,
    schemaVersion: verifier.schemaVersion,
    verdictOk: verifier.verdict ? validateVerifierVerdict(verifier.verdict).ok : false,
    verdict: verifier.verdict?.verdict || null,
  };

  const pass =
    expert.ok &&
    meta.expert.decisionOk &&
    expert.actualProvider &&
    expert.actualModel &&
    verifier.ok &&
    meta.verifier.verdictOk;

  meta.outcome = pass ? "PASS" : "FAIL";
  meta.secretsLogged = false;
  writeFileSync(join(outDir, "live-model-proof.json"), `${JSON.stringify(meta, null, 2)}\n`);
  if (asJson) process.stdout.write(`${JSON.stringify(meta, null, 2)}\n`);
  else process.stdout.write(`LIVE_MODEL_PROOF ${meta.outcome} expert=${expert.actualModel} verifier=${verifier.actualModel}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
