/**
 * FNXC:FullAutonomy 2026-08-07-21:21:
 * Bounded CI-repair agent run for `pr-respond` nodes with `config.mode=ci-repair`.
 * Mirrors pr-response-run discipline: injectable I/O, no force-push, never throws
 * to the graph, refuse when decideCiRepairAction says wait/exhausted/ignore.
 */
import type { PrEntity } from "@fusion/core";
import {
  decideCiRepairAction,
  type CiRepairDecision,
} from "./ci-repair.js";
import {
  buildCiRepairAgentPrompt,
  parseCiRepairAgentVerdict,
  type CiFailureEvidence,
} from "./ci-failure-evidence.js";
import type { PrPushResult } from "./pr-response-run.js";

export interface CiRepairRunDeps {
  entity: PrEntity;
  evidence: CiFailureEvidence;
  attemptCount: number;
  maxAttempts?: number;
  lastRepairedHeadOid?: string | null;
  lastFailureFingerprint?: string | null;
  signal?: AbortSignal;
  runAgent: (input: {
    prompt: string;
    systemPrompt: string;
    signal?: AbortSignal;
  }) => Promise<{ text: string; changedFiles?: string[] }>;
  push: (signal?: AbortSignal) => Promise<PrPushResult>;
  scanSecrets?: (cwdHint?: string) => Promise<{ ok: boolean; findings?: string[] }>;
  audit?: (reason: string, detail: string) => void;
}

export interface CiRepairRunResult {
  value: "fixed" | "disagreed-only" | "exhausted";
  decision: CiRepairDecision;
  evidence: CiFailureEvidence;
  contextPatch?: Record<string, unknown>;
}

export async function runCiRepairRun(deps: CiRepairRunDeps): Promise<CiRepairRunResult> {
  const decision = decideCiRepairAction({
    checksRollup: deps.entity.checksRollup,
    attemptCount: deps.attemptCount,
    maxAttempts: deps.maxAttempts,
    failureClass: deps.evidence.failureClass,
    headOid: deps.entity.headOid ?? deps.evidence.headOid,
    lastRepairedHeadOid: deps.lastRepairedHeadOid,
    failureFingerprint: deps.evidence.fingerprint,
    lastFailureFingerprint: deps.lastFailureFingerprint,
  });

  if (decision.action === "exhausted" || decision.action === "ignore") {
    deps.audit?.("ci-repair-exhausted", decision.reason);
    return { value: "exhausted", decision, evidence: deps.evidence };
  }
  if (decision.action === "wait" || decision.action === "ready" || decision.action === "retry-wait") {
    deps.audit?.("ci-repair-wait", decision.reason);
    return { value: "disagreed-only", decision, evidence: deps.evidence };
  }
  if (deps.signal?.aborted) {
    return { value: "disagreed-only", decision, evidence: deps.evidence };
  }

  const { systemPrompt, prompt } = buildCiRepairAgentPrompt(deps.evidence);
  let agentText = "";
  try {
    const agentResult = await deps.runAgent({ prompt, systemPrompt, signal: deps.signal });
    agentText = agentResult.text || "";
  } catch (err) {
    deps.audit?.(
      "ci-repair-agent-error",
      err instanceof Error ? err.message : String(err),
    );
    return { value: "disagreed-only", decision, evidence: deps.evidence };
  }

  const verdict = parseCiRepairAgentVerdict(agentText);
  if (verdict === "blocked") {
    deps.audit?.("ci-repair-blocked", "agent reported blocked/out-of-scope");
    return {
      value: "exhausted",
      decision,
      evidence: deps.evidence,
      contextPatch: {
        lastFailureFingerprint: deps.evidence.fingerprint,
        lastRepairedHeadOid: deps.entity.headOid ?? deps.evidence.headOid ?? null,
      },
    };
  }

  if (deps.scanSecrets) {
    try {
      const scan = await deps.scanSecrets();
      if (!scan.ok) {
        deps.audit?.("ci-repair-secret-scan", "secret scan blocked push");
        return { value: "disagreed-only", decision, evidence: deps.evidence };
      }
    } catch (err) {
      deps.audit?.(
        "ci-repair-secret-scan-error",
        err instanceof Error ? err.message : String(err),
      );
      return { value: "disagreed-only", decision, evidence: deps.evidence };
    }
  }

  let push: PrPushResult;
  try {
    push = await deps.push(deps.signal);
  } catch (err) {
    deps.audit?.(
      "ci-repair-push-error",
      err instanceof Error ? err.message : String(err),
    );
    return { value: "disagreed-only", decision, evidence: deps.evidence };
  }

  if (push.status !== "pushed") {
    deps.audit?.("ci-repair-push-aborted", push.status);
    return { value: "disagreed-only", decision, evidence: deps.evidence };
  }

  return {
    value: "fixed",
    decision,
    evidence: deps.evidence,
    contextPatch: {
      lastRepairedHeadOid: push.sha || deps.entity.headOid || deps.evidence.headOid || null,
      lastFailureFingerprint: deps.evidence.fingerprint,
    },
  };
}
