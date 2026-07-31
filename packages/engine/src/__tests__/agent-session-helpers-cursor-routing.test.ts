import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fusionCore from "@fusion/core";
import { createResolvedAgentSession } from "../agent-session-helpers.js";
import { MOCK_PROVIDER_ID } from "../providers/mock-provider.js";

const mockCreateFnAgent = vi.hoisted(() => vi.fn());

vi.mock("../pi.js", () => ({
  createFnAgent: mockCreateFnAgent,
  promptWithFallback: vi.fn().mockResolvedValue(undefined),
  describeModel: vi.fn().mockReturnValue("pi/default"),
  wrapToolsWithActionGate: vi.fn((tools) => tools),
  wrapToolsWithPermanentAgentGating: vi.fn((tools) => tools),
  wrapToolsWithRtkRewrite: vi.fn((tools) => tools),
}));

/*
FNXC:CursorCli 2026-07-31-09:40:
ISS-CLI-005 regression: cursor-cli selections must use the Cursor runtime and must never
require native pi ModelRegistry membership (the KB-001 failure mode).
*/
function makeCursorPluginRunnerStub(options?: { includeCursor?: boolean; includeOther?: boolean }) {
  const createSession = vi.fn().mockResolvedValue({
    session: { model: "composer-2.5", messages: [], dispose: vi.fn() },
  });
  const cursorRegistration = {
    pluginId: "fusion-plugin-cursor-runtime",
    runtime: {
      metadata: { runtimeId: "cursor", name: "Cursor Runtime" },
      factory: vi.fn().mockResolvedValue({
        id: "cursor",
        name: "Cursor Runtime",
        createSession,
        promptWithFallback: vi.fn(),
        describeModel: vi.fn(() => "cursor-cli/composer-2.5"),
      }),
    },
  };
  const otherRegistration = {
    pluginId: "other-runtime",
    runtime: {
      metadata: { runtimeId: "other", name: "Other Runtime" },
      factory: vi.fn().mockResolvedValue({
        id: "other",
        name: "Other Runtime",
        createSession,
        promptWithFallback: vi.fn(),
        describeModel: vi.fn(() => "other/model"),
      }),
    },
  };
  const getRuntimeById = vi.fn((runtimeId: string) => {
    if (runtimeId === "cursor" && options?.includeCursor !== false) return cursorRegistration;
    if (runtimeId === "other" && options?.includeOther) return otherRegistration;
    return undefined;
  });
  return {
    pluginRunner: {
      getRuntimeById,
      createRuntimeContext: vi.fn().mockResolvedValue({
        pluginId: "fusion-plugin-cursor-runtime",
        taskStore: {},
        settings: {},
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        emitEvent: vi.fn(),
      }),
    },
    getRuntimeById,
    createSession,
  };
}

function sessionOptions(overrides: Record<string, unknown> = {}) {
  return {
    sessionPurpose: "executor" as const,
    cwd: "/tmp/project",
    systemPrompt: "system",
    ...overrides,
  };
}

describe("createResolvedAgentSession Cursor CLI runtime routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCreateFnAgent.mockReset().mockResolvedValue({
      session: { model: "pi/default", messages: [], dispose: vi.fn() },
    });
  });

  it.each(["composer-2.5", "cursor-cli/composer-2.5"])(
    "routes primary cursor-cli model %s through Cursor runtime instead of pi registry",
    async (defaultModelId) => {
      const { pluginRunner, getRuntimeById, createSession } = makeCursorPluginRunnerStub();
      const audit = { database: vi.fn().mockResolvedValue(undefined) };

      const result = await createResolvedAgentSession(sessionOptions({
        pluginRunner: pluginRunner as never,
        runAuditor: audit as never,
        defaultProvider: "cursor-cli",
        defaultModelId,
      }));

      expect(result.runtimeId).toBe("cursor");
      expect(getRuntimeById).toHaveBeenCalledWith("cursor");
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
        defaultProvider: "cursor-cli",
        defaultModelId: "composer-2.5",
      }));
      expect(mockCreateFnAgent).not.toHaveBeenCalled();
      expect(audit.database).toHaveBeenCalledWith(expect.objectContaining({
        type: "session:runtime-resolved",
        target: "cursor",
        metadata: expect.objectContaining({
          reason: "cursor-cli-runtime",
          provider: "cursor-cli",
          modelId: "composer-2.5",
        }),
      }));
    },
  );

  it("routes planning purpose cursor-cli selections through Cursor runtime", async () => {
    const { pluginRunner, createSession } = makeCursorPluginRunnerStub();
    const result = await createResolvedAgentSession(sessionOptions({
      sessionPurpose: "triage",
      pluginRunner: pluginRunner as never,
      defaultProvider: "cursor-cli",
      defaultModelId: "composer-2.5",
    }));
    expect(result.runtimeId).toBe("cursor");
    expect(createSession).toHaveBeenCalled();
    expect(mockCreateFnAgent).not.toHaveBeenCalled();
  });

  it("promotes a cursor-cli fallback pair into the Cursor session", async () => {
    const { pluginRunner, createSession } = makeCursorPluginRunnerStub();

    const result = await createResolvedAgentSession(sessionOptions({
      pluginRunner: pluginRunner as never,
      defaultProvider: undefined,
      defaultModelId: undefined,
      fallbackProvider: "cursor-cli",
      fallbackModelId: "cursor-cli/composer-2.5",
      fallbackThinkingLevel: "high",
    }));

    expect(result.runtimeId).toBe("cursor");
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      defaultProvider: "cursor-cli",
      defaultModelId: "composer-2.5",
      defaultThinkingLevel: "high",
      fallbackProvider: undefined,
      fallbackModelId: undefined,
      fallbackThinkingLevel: undefined,
    }));
  });

  it.each([
    ["an absent runtime registration", makeCursorPluginRunnerStub({ includeCursor: false }).pluginRunner],
    ["no pluginRunner", undefined],
  ])("reports Cursor plugin remediation for %s without pi registry error", async (_label, pluginRunner) => {
    const promise = createResolvedAgentSession(sessionOptions({
      pluginRunner: pluginRunner as never,
      defaultProvider: "cursor-cli",
      defaultModelId: "composer-2.5",
    }));

    await expect(promise).rejects.toThrow(/Cursor runtime plugin/);
    await expect(promise).rejects.not.toThrow(/not found in the pi model registry/);
  });

  it("uses mock without Cursor lookup in test mode or when mock is primary", async () => {
    const testModeRunner = makeCursorPluginRunnerStub();
    const testModeResult = await createResolvedAgentSession(sessionOptions({
      pluginRunner: testModeRunner.pluginRunner as never,
      settings: { testMode: true } as never,
      defaultProvider: "cursor-cli",
      defaultModelId: "composer-2.5",
    }));
    expect(testModeResult.runtimeId).toBe(MOCK_PROVIDER_ID);
    expect(testModeRunner.getRuntimeById).not.toHaveBeenCalled();

    const mockRunner = makeCursorPluginRunnerStub();
    const mockResult = await createResolvedAgentSession(sessionOptions({
      pluginRunner: mockRunner.pluginRunner as never,
      defaultProvider: MOCK_PROVIDER_ID,
      defaultModelId: "scripted",
      fallbackProvider: "cursor-cli",
      fallbackModelId: "composer-2.5",
    }));
    expect(mockResult.runtimeId).toBe(MOCK_PROVIDER_ID);
    expect(mockRunner.getRuntimeById).not.toHaveBeenCalled();
  });

  it("does not select DeepSeek when cursor-cli is configured", async () => {
    const { pluginRunner, createSession } = makeCursorPluginRunnerStub();
    await createResolvedAgentSession(sessionOptions({
      pluginRunner: pluginRunner as never,
      defaultProvider: "cursor-cli",
      defaultModelId: "composer-2.5",
      fallbackProvider: undefined,
      fallbackModelId: undefined,
      settings: {
        defaultProvider: "deepseek",
        defaultModelId: "deepseek-chat",
        fallbackProvider: "deepseek",
      } as never,
    }));
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      defaultProvider: "cursor-cli",
      defaultModelId: "composer-2.5",
      fallbackProvider: undefined,
    }));
    expect(mockCreateFnAgent).not.toHaveBeenCalled();
  });

  it("keeps native pi providers on pi when cursor is not selected", async () => {
    vi.spyOn(fusionCore, "isGrokApiKeyFusionVisible").mockReturnValue(true);
    const { pluginRunner, getRuntimeById } = makeCursorPluginRunnerStub();
    await createResolvedAgentSession(sessionOptions({
      pluginRunner: pluginRunner as never,
      defaultProvider: "openai-codex",
      defaultModelId: "gpt-5.4",
    }));
    expect(getRuntimeById).not.toHaveBeenCalledWith("cursor");
    expect(mockCreateFnAgent).toHaveBeenCalled();
  });
});
