#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS1A 2026-08-04:
 * Optional Cursor engine stub — fails closed when S1A_ENGINE=cursor without API key.
 * Never silently falls back to the deterministic engine.
 */
import { PINNED_MODEL, PINNED_PROVIDER } from "./policy.mjs";

/**
 * @param {import("./evidence-pack.mjs").EvidencePack} _evidencePack
 * @param {object} [_opts]
 * @returns {never}
 */
export async function runCursorEngine(_evidencePack, _opts = {}) {
  const key =
    process.env.S1A_CURSOR_API_KEY ||
    process.env.CURSOR_API_KEY ||
    process.env.CURSOR_AGENT_API_KEY ||
    "";

  if (!key) {
    throw new Error(
      "S1A_ENGINE=cursor requires S1A_CURSOR_API_KEY (or CURSOR_API_KEY); refusing silent fallback to " +
        `${PINNED_PROVIDER}/${PINNED_MODEL}`,
    );
  }

  // Live Cursor wiring is intentionally out of scope for S1A deterministic proof.
  throw new Error(
    "S1A cursor engine is not implemented in this package; set S1A_ENGINE=deterministic (default) " +
      "or omit S1A_ENGINE. No silent fallback.",
  );
}
