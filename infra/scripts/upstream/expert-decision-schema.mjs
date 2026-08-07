#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamExpertSchema 2026-08-07-04:00:
 * Versioned structured decision schemas for the real AI expert resolver and independent
 * AI verifier. Malformed/incomplete model output fails closed. Model self-confidence is
 * never treated as proof. Deterministic gates remain authoritative.
 */
export const EXPERT_DECISION_SCHEMA_VERSION = 1;
export const VERIFIER_VERDICT_SCHEMA_VERSION = 1;

export const EXPERT_DECISIONS = Object.freeze([
  "RESOLVED",
  "NEEDS_MORE_EVIDENCE",
  "BLOCKED_UNRESOLVED",
  "REQUIRES_POLICY_DECISION",
]);

export const EXPERT_PROBLEM_TYPES = Object.freeze([
  "GIT_MERGE_CONFLICT",
  "SEMANTIC_CONFLICT",
  "BUILD_FAILURE",
  "TEST_FAILURE",
  "MIGRATION_INCOMPATIBILITY",
  "DEPENDENCY_CONFLICT",
  "PROVIDER_RUNTIME_CONFLICT",
  "AUTH_SECRETS_CONFLICT",
  "ARCHITECTURE_CONFLICT",
  "PATCH_VS_UPSTREAM",
  "OBSOLETE_LOCAL_PATCH",
  "UPSTREAM_SUPERSEDES_LOCAL",
  "REGRESSION_FROM_ABSORPTION",
  "OTHER_ENGINEERING",
]);

export const VERIFIER_VERDICTS = Object.freeze([
  "APPROVE",
  "REQUEST_CHANGES",
  "BLOCK_POLICY",
]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 */
function asStringArray(value) {
  if (!Array.isArray(value)) return null;
  if (!value.every((x) => typeof x === "string")) return null;
  return value.map(String);
}

/**
 * Validate expert structured response. Fail closed.
 * @param {unknown} raw
 */
export function validateExpertDecision(raw) {
  /** @type {string[]} */
  const errors = [];
  if (!isObject(raw)) {
    return { ok: false, errors: ["expert decision must be a JSON object"], decision: null };
  }
  const schemaVersion = Number(raw.schemaVersion ?? raw.schema_version ?? EXPERT_DECISION_SCHEMA_VERSION);
  if (schemaVersion !== EXPERT_DECISION_SCHEMA_VERSION) {
    errors.push(`unsupported expert schemaVersion ${schemaVersion}`);
  }
  const decision = String(raw.decision || "").toUpperCase();
  if (!EXPERT_DECISIONS.includes(/** @type {*} */ (decision))) {
    errors.push(`decision must be one of ${EXPERT_DECISIONS.join("|")}`);
  }
  const problemTypeRaw = String(raw.problemType || raw.problem_type || "").toUpperCase();
  /*
  FNXC:UpstreamAiProtocol 2026-08-07-11:20:
  Unknown problemType enums from the model must not park as silent ENGINEERING_UNRESOLVED.
  Coerce to OTHER_ENGINEERING so schema-valid decisions can proceed; invented types were
  observed on #135 attempt 3 after two valid REQUEST_CHANGES rounds.
  */
  let problemType = problemTypeRaw;
  if (!EXPERT_PROBLEM_TYPES.includes(/** @type {*} */ (problemType))) {
    if (!problemTypeRaw) {
      errors.push(`problemType must be one of ${EXPERT_PROBLEM_TYPES.join("|")}`);
    } else {
      problemType = "OTHER_ENGINEERING";
    }
  }
  for (const field of ["rootCause", "upstreamIntent", "appsolinoIntent", "resolution"]) {
    const v = raw[field] ?? raw[field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)];
    if (typeof v !== "string" || !v.trim()) errors.push(`${field} must be a non-empty string`);
  }
  const filesChanged = asStringArray(raw.filesChanged ?? raw.files_changed ?? []);
  if (!filesChanged) errors.push("filesChanged must be an array of strings");
  const testsAddedOrChanged = asStringArray(raw.testsAddedOrChanged ?? raw.tests_added_or_changed ?? []);
  if (!testsAddedOrChanged) errors.push("testsAddedOrChanged must be an array of strings");
  const patchActions = asStringArray(raw.patchActions ?? raw.patch_actions ?? []);
  if (!patchActions) errors.push("patchActions must be an array of strings");
  const remainingRisks = asStringArray(raw.remainingRisks ?? raw.remaining_risks ?? []);
  if (!remainingRisks) errors.push("remainingRisks must be an array of strings");
  if (typeof raw.requiresPolicyDecision !== "boolean" && typeof raw.requires_policy_decision !== "boolean") {
    errors.push("requiresPolicyDecision must be boolean");
  }
  // Confidence is informational only — never gates success.
  const confidence = raw.confidence;
  if (confidence != null && typeof confidence !== "number") {
    errors.push("confidence when present must be a number (informational only)");
  }

  if (errors.length) return { ok: false, errors, decision: null };

  const requiresPolicyDecision = Boolean(raw.requiresPolicyDecision ?? raw.requires_policy_decision);
  return {
    ok: true,
    errors: [],
    decision: {
      schemaVersion: EXPERT_DECISION_SCHEMA_VERSION,
      decision,
      problemType,
      rootCause: String(raw.rootCause || raw.root_cause),
      upstreamIntent: String(raw.upstreamIntent || raw.upstream_intent),
      appsolinoIntent: String(raw.appsolinoIntent || raw.appsolino_intent),
      resolution: String(raw.resolution),
      filesChanged,
      testsAddedOrChanged,
      patchActions,
      remainingRisks,
      requiresPolicyDecision,
      confidence: typeof confidence === "number" ? confidence : null,
    },
  };
}

/**
 * Validate independent verifier verdict. Fail closed.
 * Optional SHA binding: when expected SHAs are supplied, a verdict that omits them
 * or refers to a different candidate/upstream/base is AI_PROTOCOL_ERROR (invalid).
 *
 * @param {unknown} raw
 * @param {{
 *   expectedCandidateSha?: string|null,
 *   expectedUpstreamSha?: string|null,
 *   expectedBaseAppsolinoSha?: string|null,
 *   requireShaBinding?: boolean,
 * }} [opts]
 */
export function validateVerifierVerdict(raw, opts = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!isObject(raw)) {
    return { ok: false, errors: ["verifier verdict must be a JSON object"], verdict: null };
  }
  const schemaVersion = Number(raw.schemaVersion ?? raw.schema_version ?? VERIFIER_VERDICT_SCHEMA_VERSION);
  if (schemaVersion !== VERIFIER_VERDICT_SCHEMA_VERSION) {
    errors.push(`unsupported verifier schemaVersion ${schemaVersion}`);
  }
  const verdict = String(raw.verdict || "").toUpperCase();
  if (!VERIFIER_VERDICTS.includes(/** @type {*} */ (verdict))) {
    errors.push(`verdict must be one of ${VERIFIER_VERDICTS.join("|")}`);
  }
  const summary = String(raw.summary || "").trim();
  if (!summary) errors.push("summary must be a non-empty string");
  const blockingFindings = asStringArray(
    raw.blockingFindings ?? raw.blocking_findings ?? raw.findings ?? [],
  );
  if (!blockingFindings) errors.push("blockingFindings/findings must be an array of strings");
  const requiredChanges = asStringArray(raw.requiredChanges ?? raw.required_changes ?? []);
  if (!requiredChanges) errors.push("requiredChanges must be an array of strings");
  const remainingRisks = asStringArray(raw.remainingRisks ?? raw.remaining_risks ?? []);
  if (raw.remainingRisks != null || raw.remaining_risks != null) {
    if (!remainingRisks) errors.push("remainingRisks must be an array of strings when present");
  }

  if (verdict === "REQUEST_CHANGES" && requiredChanges && requiredChanges.length === 0) {
    errors.push("REQUEST_CHANGES requires non-empty requiredChanges");
  }
  if (verdict === "APPROVE" && blockingFindings && blockingFindings.length > 0) {
    errors.push("APPROVE cannot include blockingFindings");
  }

  const candidateSha = normalizeSha(raw.candidateSha ?? raw.candidate_sha);
  const upstreamSha = normalizeSha(raw.upstreamSha ?? raw.upstream_sha);
  const baseAppsolinoSha = normalizeSha(raw.baseAppsolinoSha ?? raw.base_appsolino_sha ?? raw.candidateBaseAppsolinoSha);

  const requireBinding = opts.requireShaBinding === true
    || Boolean(opts.expectedCandidateSha || opts.expectedUpstreamSha || opts.expectedBaseAppsolinoSha);

  if (requireBinding) {
    if (!candidateSha) errors.push("candidateSha required and must be a git SHA");
    if (!upstreamSha) errors.push("upstreamSha required and must be a git SHA");
    if (!baseAppsolinoSha) errors.push("baseAppsolinoSha required and must be a git SHA");
    if (candidateSha && opts.expectedCandidateSha && !shaEquals(candidateSha, opts.expectedCandidateSha)) {
      errors.push("candidateSha does not match the candidate under review");
    }
    if (upstreamSha && opts.expectedUpstreamSha && !shaEquals(upstreamSha, opts.expectedUpstreamSha)) {
      errors.push("upstreamSha does not match the upstream tip under review");
    }
    if (baseAppsolinoSha && opts.expectedBaseAppsolinoSha && !shaEquals(baseAppsolinoSha, opts.expectedBaseAppsolinoSha)) {
      errors.push("baseAppsolinoSha does not match the Appsolino base under review");
    }
  } else {
    // When present without requireBinding, still reject clearly wrong shape.
    if ((raw.candidateSha || raw.candidate_sha) && !candidateSha) {
      errors.push("candidateSha when present must be a git SHA");
    }
  }

  const deterministicEvidenceAccepted = raw.deterministicEvidenceAccepted ?? raw.deterministic_evidence_accepted;
  if (deterministicEvidenceAccepted != null && typeof deterministicEvidenceAccepted !== "boolean") {
    errors.push("deterministicEvidenceAccepted must be boolean when present");
  }
  if (verdict === "APPROVE" && deterministicEvidenceAccepted === false) {
    errors.push("APPROVE cannot set deterministicEvidenceAccepted=false");
  }
  const requiresPolicyDecision = raw.requiresPolicyDecision ?? raw.requires_policy_decision;
  if (requiresPolicyDecision != null && typeof requiresPolicyDecision !== "boolean") {
    errors.push("requiresPolicyDecision must be boolean when present");
  }
  if (verdict === "APPROVE" && requiresPolicyDecision === true) {
    errors.push("APPROVE cannot set requiresPolicyDecision=true");
  }

  if (errors.length) return { ok: false, errors, verdict: null };
  return {
    ok: true,
    errors: [],
    verdict: {
      schemaVersion: VERIFIER_VERDICT_SCHEMA_VERSION,
      verdict,
      summary,
      blockingFindings: blockingFindings || [],
      requiredChanges: requiredChanges || [],
      remainingRisks: remainingRisks || [],
      risk: String(raw.risk || "UNKNOWN").toUpperCase(),
      candidateSha: candidateSha || null,
      upstreamSha: upstreamSha || null,
      baseAppsolinoSha: baseAppsolinoSha || null,
      deterministicEvidenceAccepted:
        typeof deterministicEvidenceAccepted === "boolean" ? deterministicEvidenceAccepted : null,
      requiresPolicyDecision: typeof requiresPolicyDecision === "boolean" ? requiresPolicyDecision : false,
    },
  };
}

/** @param {unknown} value */
function normalizeSha(value) {
  const s = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(s) ? s : null;
}

/** @param {string} a @param {string} b */
function shaEquals(a, b) {
  const x = String(a || "").trim().toLowerCase();
  const y = String(b || "").trim().toLowerCase();
  if (!x || !y) return false;
  const n = Math.min(x.length, y.length);
  return n >= 7 && x.slice(0, n) === y.slice(0, n);
}

/**
 * Combine expert + verifier + deterministic gate outcomes.
 * AI cannot bypass failing deterministic tests.
 *
 * @param {{
 *   expert: ReturnType<typeof validateExpertDecision>["decision"],
 *   verifier: ReturnType<typeof validateVerifierVerdict>["verdict"],
 *   deterministicPassed: boolean,
 *   deterministicFailures?: string[],
 *   repairAttempt?: number,
 *   maxRepairAttempts?: number,
 * }} input
 */
export function combineResolutionGate(input) {
  const maxAttempts = Number(input.maxRepairAttempts ?? 3);
  const attempt = Number(input.repairAttempt ?? 1);
  if (!input.deterministicPassed) {
    return {
      finalizable: false,
      next: attempt < maxAttempts ? "EXPERT_RESOLVING" : "BLOCKED_UNRESOLVED",
      reason: "deterministic regression/tests still failing — AI RESOLVED claim is insufficient",
      failures: input.deterministicFailures || [],
    };
  }
  if (!input.expert) {
    return {
      finalizable: false,
      next: "BLOCKED_UNRESOLVED",
      reason: "missing validated expert decision",
      failures: [],
    };
  }
  if (input.expert.requiresPolicyDecision || input.expert.decision === "REQUIRES_POLICY_DECISION") {
    return {
      finalizable: false,
      next: "BLOCKED_POLICY",
      reason: "expert marked requiresPolicyDecision",
      failures: [],
    };
  }
  if (input.expert.decision === "BLOCKED_UNRESOLVED" || input.expert.decision === "NEEDS_MORE_EVIDENCE") {
    return {
      finalizable: false,
      next: attempt < maxAttempts && input.expert.decision === "NEEDS_MORE_EVIDENCE"
        ? "EXPERT_RESOLVING"
        : "BLOCKED_UNRESOLVED",
      reason: `expert decision ${input.expert.decision}`,
      failures: [],
    };
  }
  if (!input.verifier) {
    return {
      finalizable: false,
      next: "BLOCKED_UNRESOLVED",
      reason: "independent AI verifier verdict missing — fail closed",
      failures: [],
    };
  }
  if (input.verifier.verdict === "BLOCK_POLICY") {
    return {
      finalizable: false,
      next: "BLOCKED_POLICY",
      reason: "verifier BLOCK_POLICY",
      failures: input.verifier.blockingFindings,
    };
  }
  if (input.verifier.verdict === "REQUEST_CHANGES") {
    return {
      finalizable: false,
      next: attempt < maxAttempts ? "EXPERT_RESOLVING" : "BLOCKED_UNRESOLVED",
      reason: "verifier REQUEST_CHANGES — return to expert repair loop",
      failures: input.verifier.requiredChanges,
      failureClass: "AI_VERIFIER_REQUEST_CHANGES",
    };
  }
  if (input.expert.decision === "RESOLVED" && input.verifier.verdict === "APPROVE") {
    if (input.verifier.requiresPolicyDecision === true) {
      return {
        finalizable: false,
        next: "BLOCKED_POLICY",
        reason: "verifier APPROVE claimed requiresPolicyDecision",
        failures: [],
        failureClass: "POLICY_BLOCKED",
      };
    }
    return {
      finalizable: true,
      next: "CONTINUE",
      reason: "expert RESOLVED + verifier APPROVE + deterministic gates passed",
      failures: [],
    };
  }
  return {
    finalizable: false,
    next: "BLOCKED_UNRESOLVED",
    reason: "unhandled expert/verifier combination",
    failures: [],
  };
}
