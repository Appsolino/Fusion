#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto3Handoff 2026-08-01-08:10:
 * Guard: AUTO-2 finalize/approve-sensitive YAML must remain parseable. An
 * unindented heredoc inside run:| strips workflow_dispatch registration.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function assertYamlParses(rel) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  // Reject unindented lines after a run:| heredoc starter that would terminate YAML scalars.
  assert.doesNotMatch(text, /python3 - <<'PY'\n[A-Za-z]/, "unindented heredoc body breaks YAML run blocks");
  const py = spawnSync("python3", ["-c", "import sys,yaml; yaml.safe_load(sys.stdin.read()); print('ok')"], {
    input: text,
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr || py.stdout);
  assert.match(py.stdout, /ok/);
}

describe("AUTO-2 workflow YAML parse guard", () => {
  it("finalize.yml parses and keeps workflow_dispatch", () => {
    assertYamlParses(".github/workflows/upstream-auto2-finalize.yml");
    const text = readFileSync(join(ROOT, ".github/workflows/upstream-auto2-finalize.yml"), "utf8");
    assert.match(text, /workflow_dispatch:/);
    assert.match(text, /name:\s*Upstream AUTO-2 Finalize/);
  });
  it("approve-sensitive.yml parses and keeps workflow_dispatch", () => {
    assertYamlParses(".github/workflows/upstream-auto2-approve-sensitive.yml");
    const text = readFileSync(join(ROOT, ".github/workflows/upstream-auto2-approve-sensitive.yml"), "utf8");
    assert.match(text, /workflow_dispatch:/);
  });
});
