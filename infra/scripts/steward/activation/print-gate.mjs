#!/usr/bin/env node
/* eslint-env node */
/**
 * Print one activation gate as JSON for shell workflows (Node 22-safe; no node -e ESM).
 * Usage: node print-gate.mjs s1aAutoHandoff
 */
import { summarizeActivation } from "./resolve-activation.mjs";

const gate = String(process.argv[2] || "s1aAutoHandoff");
const s = summarizeActivation();
const on = Boolean(s.effective?.[gate]);
process.stdout.write(
  JSON.stringify({ kill: s.killSwitch, gate, on: on && !s.killSwitch }) + "\n",
);
