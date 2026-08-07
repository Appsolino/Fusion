#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:UpstreamAiProtocol 2026-08-07-08:40:
 * Production-robust structured JSON extraction for expert/verifier model output.
 * Preference order: whole-text JSON → fenced ```json → balanced-brace candidates
 * validated against a schema callback. Never invent fields; never turn prose into APPROVE.
 */
export const AI_FAILURE_CLASSES = Object.freeze([
  "AI_PROTOCOL_ERROR",
  "AI_PROVIDER_ERROR",
  "AI_VERIFIER_REQUEST_CHANGES",
  "ENGINEERING_UNRESOLVED",
  "POLICY_BLOCKED",
]);

/**
 * Classify a failure reason string into the maintenance-plane taxonomy.
 * Malformed JSON / missing schema fields are AI_PROTOCOL_ERROR — not ENGINEERING_UNRESOLVED.
 * @param {{ reason?: string|null, action?: string|null, ok?: boolean }} input
 */
export function classifyAiFailure(input) {
  const reason = String(input.reason || "").toLowerCase();
  const action = String(input.action || "").toUpperCase();
  if (action === "BLOCKED_POLICY" || /policy|host p|production|secret expansion/.test(reason)) {
    return "POLICY_BLOCKED";
  }
  if (
    /malformed|json-parse|no-json|schema validation|missing required|wrong candidate|invalid sha|protocol/.test(reason)
  ) {
    return "AI_PROTOCOL_ERROR";
  }
  if (
    /model unavailable|provider|invocation failed|timed out|timeout|cursor-agent exit|exit 143|sigkill|sigterm|api key|network/.test(
      reason,
    )
  ) {
    return "AI_PROVIDER_ERROR";
  }
  if (/request_changes|request changes/.test(reason)) {
    return "AI_VERIFIER_REQUEST_CHANGES";
  }
  if (action === "BLOCKED_UNRESOLVED" || /engineering|unresolved|deterministic/.test(reason)) {
    return "ENGINEERING_UNRESOLVED";
  }
  return "ENGINEERING_UNRESOLVED";
}

/**
 * Map failure class to repair-loop next token (keeps AUTO-2 labels/actions precise).
 * @param {string} failureClass
 */
export function nextFromAiFailureClass(failureClass) {
  switch (String(failureClass || "").toUpperCase()) {
    case "AI_PROTOCOL_ERROR":
      return "AI_PROTOCOL_ERROR";
    case "AI_PROVIDER_ERROR":
      return "AI_PROVIDER_ERROR";
    case "AI_VERIFIER_REQUEST_CHANGES":
      return "EXPERT_RESOLVING";
    case "POLICY_BLOCKED":
      return "BLOCKED_POLICY";
    default:
      return "BLOCKED_UNRESOLVED";
  }
}

/**
 * Extract balanced `{...}` slices from text (depth-aware; string-aware enough for JSON).
 * @param {string} text
 * @returns {string[]}
 */
export function extractJsonObjectCandidates(text) {
  const src = String(text || "");
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < src.length; j++) {
      const ch = src[j];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          out.push(src.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return out;
}

/**
 * @param {string} text
 * @returns {{ ok: true, raw: object, method: string } | { ok: false, error: string, raw: null }}
 */
export function parseStructuredJson(text) {
  const src = String(text || "").trim();
  if (!src) return { ok: false, error: "no-json-object", raw: null };

  // 1) Whole-text JSON
  try {
    const whole = JSON.parse(src);
    if (whole && typeof whole === "object" && !Array.isArray(whole)) {
      return { ok: true, raw: whole, method: "whole-text" };
    }
  } catch {
    /* continue */
  }

  // 2) Fenced ```json blocks (try each, last wins if multiple valid)
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  /** @type {object|null} */
  let lastFenced = null;
  let m;
  while ((m = fenceRe.exec(src)) !== null) {
    const body = String(m[1] || "").trim();
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) lastFenced = parsed;
    } catch {
      // Try balanced extract inside fence
      for (const cand of extractJsonObjectCandidates(body).reverse()) {
        try {
          const parsed = JSON.parse(cand);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            lastFenced = parsed;
            break;
          }
        } catch {
          /* next */
        }
      }
    }
  }
  if (lastFenced) return { ok: true, raw: lastFenced, method: "fenced-json" };

  // 3) Balanced brace candidates (prefer last valid object — models often preamble then JSON)
  const candidates = extractJsonObjectCandidates(src);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true, raw: parsed, method: "balanced-brace" };
      }
    } catch {
      /* next */
    }
  }

  return { ok: false, error: "no-json-object", raw: null };
}

/**
 * Parse then validate. Validation errors stay AI_PROTOCOL_ERROR (not silent repair of meaning).
 * @param {string} text
 * @param {(raw: unknown) => { ok: boolean, errors?: string[], verdict?: object|null, decision?: object|null }} validateFn
 */
export function parseAndValidateStructured(text, validateFn) {
  const parsed = parseStructuredJson(text);
  if (!parsed.ok) {
    return {
      ok: false,
      failureClass: "AI_PROTOCOL_ERROR",
      error: parsed.error,
      raw: null,
      validated: null,
      method: null,
    };
  }
  const validated = validateFn(parsed.raw);
  if (!validated.ok) {
    return {
      ok: false,
      failureClass: "AI_PROTOCOL_ERROR",
      error: `schema-validation-failed:${(validated.errors || []).join(";")}`,
      raw: parsed.raw,
      validated: null,
      method: parsed.method,
    };
  }
  return {
    ok: true,
    failureClass: null,
    error: null,
    raw: parsed.raw,
    validated: validated.verdict || validated.decision || validated,
    method: parsed.method,
  };
}
