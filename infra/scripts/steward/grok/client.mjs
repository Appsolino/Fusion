#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardGrok 2026-08-04:
 * Direct xAI API client — resolve/pin Grok model; structured completions.
 */
import {
  GROK_ALIAS,
  GROK_PROVIDER,
  GROK_REASONING_EFFORT,
  XAI_API_BASE,
} from "./policy.mjs";

/**
 * @param {{ apiKey?: string, fetchImpl?: typeof fetch, baseUrl?: string }} [opts]
 */
export function requireXaiApiKey(opts = {}) {
  const key = opts.apiKey ?? process.env.XAI_API_KEY ?? "";
  if (!key) {
    throw new Error(
      "XAI_API_KEY missing — fail closed (create durable owner-action for secret)",
    );
  }
  return key;
}

/**
 * Resolve exact Grok 4.5 model id from /models. No silent fallback.
 * @param {{ apiKey?: string, fetchImpl?: typeof fetch, alias?: string }} [opts]
 */
export async function resolveGrokModel(opts = {}) {
  const key = requireXaiApiKey(opts);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const base = opts.baseUrl || XAI_API_BASE;
  const alias = opts.alias || GROK_ALIAS;
  const res = await fetchImpl(`${base}/models`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`xAI models list failed: ${res.status} ${t.slice(0, 300)}`);
  }
  const body = await res.json();
  const models = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  const ids = models.map((m) => String(m.id || m.name || "")).filter(Boolean);
  // Prefer exact alias, then prefix matches for versioned ids.
  let resolved =
    ids.find((id) => id === alias) ||
    ids.find((id) => id.startsWith(`${alias}-`)) ||
    ids.find((id) => id.includes("grok-4.5") || id.includes("grok-4-5"));
  if (!resolved) {
    throw new Error(
      `Requested model unavailable: ${alias} (no silent fallback; listed=${ids.slice(0, 12).join(",")})`,
    );
  }
  return {
    configuredProvider: GROK_PROVIDER,
    configuredModel: alias,
    actualProvider: GROK_PROVIDER,
    actualModel: resolved,
    modelFingerprint: resolved,
    reasoningEffort: GROK_REASONING_EFFORT,
    listedCount: ids.length,
  };
}

/**
 * Chat completion with JSON object response.
 * @param {{
 *   apiKey?: string,
 *   model: string,
 *   system: string,
 *   user: string,
 *   fetchImpl?: typeof fetch,
 *   baseUrl?: string,
 * }} input
 */
export async function xaiJsonCompletion(input) {
  const key = requireXaiApiKey(input);
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const base = input.baseUrl || XAI_API_BASE;
  const started = Date.now();
  const res = await fetchImpl(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`xAI chat failed: ${res.status} ${text.slice(0, 400)}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    throw new Error(`xAI chat invalid JSON envelope: ${e.message}`);
  }
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("xAI chat empty content");
  let parsed;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch (e) {
    throw new Error(`xAI structured content parse failed: ${e.message}`);
  }
  if (parsed.actualModel && parsed.actualModel !== input.model) {
    throw new Error(
      `model drift in response: configured=${input.model} actual=${parsed.actualModel}`,
    );
  }
  return {
    parsed,
    requestId: String(body.id || body.request_id || `xai-${started}`),
    usage: body.usage || null,
    elapsedMs: Date.now() - started,
    actualModel: input.model,
  };
}
