import { describe, expect, it, vi } from "vitest";
import { buildCursorAgentPrintArgs } from "../agent-print.js";
import { CursorRuntimeAdapter } from "../runtime-adapter.js";

describe("buildCursorAgentPrintArgs", () => {
  it("includes force for write-capable turns", () => {
    expect(buildCursorAgentPrintArgs({
      modelId: "composer-2.5",
      cwd: "/tmp/ws",
      allowWrites: true,
      prompt: "do work",
    })).toEqual([
      "-p",
      "--output-format",
      "text",
      "--model",
      "composer-2.5",
      "--workspace",
      "/tmp/ws",
      "--trust",
      "--force",
      "do work",
    ]);
  });

  it("uses plan mode for readonly turns", () => {
    expect(buildCursorAgentPrintArgs({
      modelId: "composer-2.5",
      cwd: "/tmp/ws",
      allowWrites: false,
      prompt: "plan only",
    })).toContain("--mode");
  });
});

describe("CursorRuntimeAdapter", () => {
  it("creates a session after validating a discovered model", async () => {
    const adapter = new CursorRuntimeAdapter({
      probeBinary: vi.fn().mockResolvedValue({
        available: true,
        authenticated: true,
        binaryPath: "/bin/cursor-agent",
        binaryName: "/bin/cursor-agent",
      }),
      discoverModels: vi.fn().mockResolvedValue({
        models: ["composer-2.5", "auto"],
        source: "models-text",
        fallbackUsed: false,
      }),
    });

    const result = await adapter.createSession({
      cwd: "/tmp/project",
      systemPrompt: "sys",
      defaultModelId: "cursor-cli/composer-2.5",
      tools: "coding",
    });
    expect(result.session.model).toBe("composer-2.5");
    expect(result.session.lastModelDescription).toBe("cursor-cli/composer-2.5");
    expect(result.session.allowWrites).toBe(true);
    // FNXC:SoakR2PlanningSettlement 2026-08-08-05:12: triage requires this boundary.
    expect(typeof result.settleFallbackDispatch).toBe("function");
    await expect(result.settleFallbackDispatch()).resolves.toBeUndefined();
  });

  it("rejects unknown cursor-cli models before execution", async () => {
    const adapter = new CursorRuntimeAdapter({
      probeBinary: vi.fn().mockResolvedValue({
        available: true,
        authenticated: true,
        binaryPath: "/bin/cursor-agent",
        binaryName: "/bin/cursor-agent",
      }),
      discoverModels: vi.fn().mockResolvedValue({
        models: ["composer-2.5"],
        source: "models-text",
        fallbackUsed: false,
      }),
    });

    await expect(adapter.createSession({
      cwd: "/tmp/project",
      defaultModelId: "not-a-real-model",
    })).rejects.toThrow(/was not returned by authenticated discovery/);
  });

  it("rejects unauthenticated Cursor CLI before execution", async () => {
    const adapter = new CursorRuntimeAdapter({
      probeBinary: vi.fn().mockResolvedValue({
        available: true,
        authenticated: false,
        reason: "cursor-agent reports not authenticated",
      }),
    });

    await expect(adapter.createSession({
      cwd: "/tmp/project",
      defaultModelId: "composer-2.5",
    })).rejects.toThrow(/not ready/);
  });

  it("promptWithFallback invokes print-mode runner and records assistant text", async () => {
    const runPrint = vi.fn().mockResolvedValue({
      code: 0,
      stdout: "done",
      stderr: "",
      timedOut: false,
    });
    const adapter = new CursorRuntimeAdapter({
      probeBinary: vi.fn().mockResolvedValue({
        available: true,
        authenticated: true,
        binaryPath: "/bin/cursor-agent",
        binaryName: "/bin/cursor-agent",
      }),
      discoverModels: vi.fn().mockResolvedValue({
        models: ["composer-2.5"],
        source: "models-text",
        fallbackUsed: false,
      }),
      runPrint,
    });
    const onText = vi.fn();
    const { session } = await adapter.createSession({
      cwd: "/tmp/project",
      systemPrompt: "sys",
      defaultModelId: "composer-2.5",
      onText,
    });
    await adapter.promptWithFallback(session, "hello");
    expect(runPrint).toHaveBeenCalledWith(expect.objectContaining({
      binary: "/bin/cursor-agent",
      modelId: "composer-2.5",
      allowWrites: true,
    }));
    expect(session.messages.some((m) => m.role === "assistant" && m.content === "done")).toBe(true);
  });

  it("promptWithFallback fails closed on non-zero Cursor exit", async () => {
    const adapter = new CursorRuntimeAdapter({
      probeBinary: vi.fn().mockResolvedValue({
        available: true,
        authenticated: true,
        binaryPath: "/bin/cursor-agent",
        binaryName: "/bin/cursor-agent",
      }),
      discoverModels: vi.fn().mockResolvedValue({
        models: ["composer-2.5"],
        source: "models-text",
        fallbackUsed: false,
      }),
      runPrint: vi.fn().mockResolvedValue({
        code: 2,
        stdout: "",
        stderr: "boom",
        timedOut: false,
      }),
    });
    const { session } = await adapter.createSession({
      cwd: "/tmp/project",
      defaultModelId: "composer-2.5",
    });
    await expect(adapter.promptWithFallback(session, "hello")).rejects.toThrow(/Cursor CLI agent failed/);
  });

  it("describeModel formats cursor-cli prefix", () => {
    const adapter = new CursorRuntimeAdapter();
    expect(adapter.describeModel({ model: "composer-2.5", lastModelDescription: "cursor-cli/composer-2.5" }))
      .toBe("cursor-cli/composer-2.5");
  });
});
