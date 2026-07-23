import { describe, expect, it, vi } from "vitest";

import {
  buildGhostBugProbeCommandForTest,
  extractCitedConstructs,
  isBugFixShape,
  runGhostBugPreflight,
  shouldIgnoreCitedConstruct,
} from "../triage-preflight.js";

describe("triage-preflight", () => {
  it("isBugFixShape matrix", () => {
    expect(isBugFixShape({ title: "fix: broken typecheck", description: "x" })).toBe(true);
    expect(isBugFixShape({ title: "chore", description: "compile error appears" })).toBe(true);
    expect(isBugFixShape({ title: "refactor", description: "cleanup" })).toBe(false);
    expect(isBugFixShape({ title: null, description: "" })).toBe(false);
  });

  it("extracts constructs and dedupes", () => {
    const prompt = [
      "Use `secrets_sync.handle()` and `foo_bar` in packages/core/src/secrets-sync.ts:12",
      "```ts",
      "const value = loadConfig()",
      "const a = b",
      "```",
      "pnpm --filter @fusion/core test",
      "pnpm --filter @fusion/core test",
    ].join("\n");

    const constructs = extractCitedConstructs(prompt);
    expect(constructs.some((c) => c.kind === "identifier" && c.raw === "secrets_sync.handle()")).toBe(true);
    expect(constructs.some((c) => c.filePath === "packages/core/src/secrets-sync.ts" && c.line === 12)).toBe(true);
    expect(constructs.some((c) => c.kind === "snippet" && c.raw.includes("loadConfig"))).toBe(true);
    expect(constructs.filter((c) => c.kind === "command")).toHaveLength(1);
  });

  it("ignores root docs, fusion tools, and complex expressions", () => {
    expect(shouldIgnoreCitedConstruct({ kind: "identifier", raw: "README.md" })).toBe(true);
    expect(shouldIgnoreCitedConstruct({ kind: "identifier", raw: "package.json" })).toBe(true);
    expect(shouldIgnoreCitedConstruct({ kind: "identifier", raw: "fn_task_document_write" })).toBe(true);
    expect(shouldIgnoreCitedConstruct({ kind: "identifier", raw: "fn_task_create" })).toBe(true);
    expect(
      shouldIgnoreCitedConstruct({
        kind: "identifier",
        raw: "updateMany({ where: { id, userId, updatedAt: expectedUpdatedAt } })",
      }),
    ).toBe(true);
    expect(
      shouldIgnoreCitedConstruct({
        kind: "snippet",
        raw: "await db.updateMany({ where: { id } })",
      }),
    ).toBe(true);
    expect(shouldIgnoreCitedConstruct({ kind: "identifier", raw: "patchWorkItemAtomic" })).toBe(false);
    expect(shouldIgnoreCitedConstruct({ kind: "identifier", raw: "secrets_sync.handle()" })).toBe(false);
  });

  it("extracts non-packages app paths and drops false-negative constructs", () => {
    const prompt = [
      "Inspect apps/api/src/productivity/mutations.ts and `README.md`.",
      "Do not call `fn_task_create` or `fn_task_document_write`.",
      "Confirm `updateMany({ where: { id, userId, updatedAt: expectedUpdatedAt } })`.",
      "Keep `work_item_cas` behavior.",
    ].join("\n");

    const constructs = extractCitedConstructs(prompt);
    expect(constructs.some((c) => c.filePath === "apps/api/src/productivity/mutations.ts")).toBe(true);
    expect(constructs.some((c) => c.raw === "work_item_cas")).toBe(true);
    expect(constructs.some((c) => c.raw === "README.md")).toBe(false);
    expect(constructs.some((c) => c.raw === "fn_task_create")).toBe(false);
    expect(constructs.some((c) => c.raw.includes("updateMany("))).toBe(false);
  });

  it("passes when the prompt only cites ignored contextual constructs", async () => {
    const exec = vi.fn();
    const decision = await runGhostBugPreflight(
      { title: "fix: flaky CAS", description: "regression" },
      [
        "See `README.md` and `package.json`.",
        "Helpers: `fn_task_create`, `fn_task_document_write`.",
        "```ts",
        "await updateMany({ where: { id, userId } });",
        "```",
      ].join("\n"),
      { cwd: process.cwd(), exec },
    );
    expect(decision.decision).toBe("pass");
    expect(decision.reason).toBe("no_constructs");
    expect(exec).not.toHaveBeenCalled();
  });

  it("caps extracted constructs at 20", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `\`value_${i}.x\``).join("\n");
    expect(extractCitedConstructs(lines)).toHaveLength(20);
  });

  it("archives when all definitive probes are missing", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const decision = await runGhostBugPreflight(
      { title: "fix: typecheck error", description: "desc" },
      "`foo_bar`",
      { cwd: process.cwd(), exec },
    );
    expect(decision.decision).toBe("archive");
  });

  it("passes when at least one construct matches", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "hit", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });
    const decision = await runGhostBugPreflight(
      { title: "fix: compile error", description: "desc" },
      "`foo_bar`\n`bar_baz`",
      { cwd: process.cwd(), exec },
    );
    expect(decision.decision).toBe("pass");
  });

  it("fails open when all probes throw", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("boom"));
    const decision = await runGhostBugPreflight(
      { title: "fix: regression", description: "desc" },
      "`foo_bar`",
      { cwd: process.cwd(), exec },
    );
    expect(decision.decision).toBe("pass");
  });

  it("passes non bug-shape tasks", async () => {
    const exec = vi.fn();
    const decision = await runGhostBugPreflight(
      { title: "docs", description: "desc" },
      "`foo_bar`",
      { cwd: process.cwd(), exec },
    );
    expect(decision.decision).toBe("pass");
    expect(exec).not.toHaveBeenCalled();
  });

  it("keeps command probes non-definitive (matched with exit_code_unavailable)", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const decision = await runGhostBugPreflight(
      { title: "fix: typecheck error", description: "desc" },
      "pnpm --filter @fusion/core typecheck",
      { cwd: process.cwd(), exec },
    );
    // Sole command probe is non-definitive → no archive from definitive misses.
    expect(decision.decision).toBe("pass");
    expect(decision.reason).toBe("no_definitive_probe_signal");
    expect(decision.findings[0]?.probeError).toBe("exit_code_unavailable");
  });

  it("probes file paths with git cat-file and identifiers repo-wide", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "FOUND", stderr: "" });
    const decision = await runGhostBugPreflight(
      { title: "fix: flaky WorkItem CAS", description: "regression" },
      "See apps/api/src/productivity/mutations.ts and `work_item_cas`.",
      { cwd: process.cwd(), exec },
    );
    expect(decision.decision).toBe("pass");
    expect(exec).toHaveBeenCalled();
    const commands = exec.mock.calls.map((call) => String(call[0]));
    expect(commands.some((cmd) => cmd.includes("git cat-file -e") && cmd.includes("HEAD:apps/api/src/productivity/mutations.ts"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes("git grep -nF --") && cmd.includes("work_item_cas") && !cmd.includes(" packages/"))).toBe(true);
  });

  it("shell-quotes path and identifier probes so metacharacters cannot inject", () => {
    const pathCmd = buildGhostBugProbeCommandForTest({
      kind: "identifier",
      raw: 'apps/api/src/foo"; rm -rf /tmp/x; echo ".ts',
      filePath: 'apps/api/src/foo"; rm -rf /tmp/x; echo ".ts',
    });
    expect(pathCmd.startsWith("git cat-file -e ")).toBe(true);
    expect(pathCmd).toContain(JSON.stringify('HEAD:apps/api/src/foo"; rm -rf /tmp/x; echo ".ts'));
    expect(pathCmd).not.toMatch(/cat-file -e HEAD:/);

    const idCmd = buildGhostBugProbeCommandForTest({
      kind: "identifier",
      raw: 'foo"; curl evil',
    });
    expect(idCmd).toBe(`git grep -nF -- ${JSON.stringify('foo"; curl evil')} || true`);
  });
});
