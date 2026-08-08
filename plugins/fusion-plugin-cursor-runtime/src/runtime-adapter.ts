import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCursorAgentPrint } from "./agent-print.js";
import { discoverCursorModels } from "./process-manager.js";
import { probeCursorBinary } from "./probe.js";

/*
FNXC:CursorCli 2026-07-31-09:40:
ISS-CLI-005: Cursor CLI models are discovered for `/api/models` but must never
require native pi ModelRegistry membership. This adapter owns planning/execution
turns via `cursor-agent -p`, validates the requested model against live discovery,
and fails closed when the binary/auth/model is unavailable — never falling through
to DeepSeek, another provider, or a silent no-op success.
*/

const CURSOR_CLI_PROVIDER_ID = "cursor-cli";
const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60 * 1000;

export interface CursorRuntimeAdapterDeps {
  /** Optional absolute/configured `cursor-agent` path (otherwise probe PATH + FUSION_HOME settings). */
  binaryPath?: string;
  /** Injectable probe for tests. */
  probeBinary?: typeof probeCursorBinary;
  /** Injectable discovery for tests. */
  discoverModels?: typeof discoverCursorModels;
  /** Injectable print runner for tests. */
  runPrint?: typeof runCursorAgentPrint;
  /** Override agent timeout (tests). */
  timeoutMs?: number;
}

export interface CursorSession {
  model: string;
  systemPrompt?: string;
  messages: Array<{ role: string; content: string }>;
  cwd: string;
  binaryPath: string;
  allowWrites: boolean;
  lastModelDescription: string;
  callbacks: {
    onText?: (delta: string) => void;
    onThinking?: (delta: string) => void;
    onToolStart?: (name: string, args?: Record<string, unknown>) => void;
    onToolEnd?: (name: string, isError: boolean, result?: unknown) => void;
  };
  dispose: () => void;
}

function stripCursorCliModelPrefix(modelId: string | undefined): string | undefined {
  const normalized = modelId?.trim();
  if (!normalized) return normalized;
  const prefix = `${CURSOR_CLI_PROVIDER_ID}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

function readConfiguredCursorBinaryPathFromFusionHome(): string | undefined {
  const home = process.env.FUSION_HOME || process.env.HOME;
  if (!home) return undefined;
  try {
    const raw = readFileSync(join(home, ".fusion", "settings.json"), "utf8");
    const parsed = JSON.parse(raw) as { cursorCliBinaryPath?: unknown };
    return typeof parsed.cursorCliBinaryPath === "string" && parsed.cursorCliBinaryPath.trim()
      ? parsed.cursorCliBinaryPath.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function compactDiagnostic(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export class CursorRuntimeAdapter {
  readonly id = "cursor";
  readonly name = "Cursor Runtime";

  private readonly configuredBinaryPath?: string;
  private readonly probeBinary: typeof probeCursorBinary;
  private readonly discoverModels: typeof discoverCursorModels;
  private readonly runPrint: typeof runCursorAgentPrint;
  private readonly timeoutMs: number;

  constructor(deps: CursorRuntimeAdapterDeps = {}) {
    this.configuredBinaryPath = deps.binaryPath?.trim() || undefined;
    this.probeBinary = deps.probeBinary ?? probeCursorBinary;
    this.discoverModels = deps.discoverModels ?? discoverCursorModels;
    this.runPrint = deps.runPrint ?? runCursorAgentPrint;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  }

  private resolveBinaryPathHint(): string | undefined {
    return this.configuredBinaryPath || readConfiguredCursorBinaryPathFromFusionHome();
  }

  /*
  FNXC:SoakR2PlanningSettlement 2026-08-08-05:12:
  Triage requires a finite fallback-dispatch settlement boundary after promptWithFallback
  (see TriageProcessor planningAttempt handoff). Cursor CLI turns are fully awaited inside
  runCursorAgentPrint — there is no deferred onFallbackModelUsed lifecycle — so expose the
  same explicit no-op boundary DefaultPiRuntime provides. Omitting it made every successful
  Host D Soak R2 plan fail closed into todo→replan livelock (SOAK-R2-DEFECT-001A).
  */
  async createSession(options: {
    cwd?: string;
    systemPrompt?: string;
    defaultModelId?: string;
    defaultProvider?: string;
    tools?: "coding" | "readonly";
    runtimeContext?: { toolMode?: "coding" | "readonly" };
    onText?: (delta: string) => void;
    onThinking?: (delta: string) => void;
    onToolStart?: (name: string, args?: Record<string, unknown>) => void;
    onToolEnd?: (name: string, isError: boolean, result?: unknown) => void;
    beforeSpawnSession?: () => Promise<void> | void;
  }): Promise<{
    session: CursorSession;
    sessionFile?: undefined;
    settleFallbackDispatch: () => Promise<void>;
  }> {
    await options.beforeSpawnSession?.();

    const modelId = stripCursorCliModelPrefix(options.defaultModelId);
    if (!modelId) {
      throw new Error(
        "Cursor CLI session requires an explicit model id (e.g. composer-2.5). "
        + "Select a discovered cursor-cli model from /api/models.",
      );
    }

    const probe = await this.probeBinary({ binaryPath: this.resolveBinaryPathHint() });
    if (!probe.available || !probe.authenticated) {
      throw new Error(
        `Cursor CLI is not ready for planning/execution (${probe.reason ?? "unauthenticated or unavailable"}). `
        + "Authenticate cursor-agent under the same HOME as the Fusion service and confirm /api/providers/cursor-cli/status.",
      );
    }

    const binary = probe.binaryPath ?? probe.binaryName;
    if (!binary) {
      throw new Error("Cursor CLI probe succeeded without a binary path.");
    }

    const discovery = await this.discoverModels(binary);
    if (!discovery.models.includes(modelId)) {
      throw new Error(
        `Configured Cursor CLI model "${modelId}" was not returned by authenticated discovery `
        + `(source=${discovery.source}${discovery.reason ? `, reason=${discovery.reason}` : ""}). `
        + "Choose a model listed under provider=cursor-cli in /api/models.",
      );
    }

    const allowWrites = (options.tools ?? options.runtimeContext?.toolMode ?? "coding") !== "readonly";
    const cwd = options.cwd?.trim() || process.cwd();
    const session: CursorSession = {
      model: modelId,
      systemPrompt: options.systemPrompt,
      messages: [],
      cwd,
      binaryPath: binary,
      allowWrites,
      lastModelDescription: `${CURSOR_CLI_PROVIDER_ID}/${modelId}`,
      callbacks: {
        onText: options.onText,
        onThinking: options.onThinking,
        onToolStart: options.onToolStart,
        onToolEnd: options.onToolEnd,
      },
      dispose: () => undefined,
    };
    return {
      session,
      sessionFile: undefined,
      settleFallbackDispatch: async () => undefined,
    };
  }

  async promptWithFallback(
    session: CursorSession,
    prompt: string,
    _options?: unknown,
  ): Promise<void> {
    const system = session.systemPrompt?.trim();
    const user = prompt?.trim() ?? "";
    const combined = system
      ? `System instructions:\n${system}\n\nUser request:\n${user}`
      : user;
    if (!combined) {
      throw new Error("Cursor CLI prompt is empty.");
    }

    session.messages.push({ role: "user", content: user });

    const result = await this.runPrint({
      binary: session.binaryPath,
      cwd: session.cwd,
      modelId: session.model,
      prompt: combined,
      allowWrites: session.allowWrites,
      timeoutMs: this.timeoutMs,
      onText: (delta) => session.callbacks.onText?.(delta),
    });

    if (result.timedOut) {
      throw new Error(
        `Cursor CLI agent timed out after ${this.timeoutMs}ms for model ${CURSOR_CLI_PROVIDER_ID}/${session.model}.`,
      );
    }
    if (result.code !== 0) {
      const detail = compactDiagnostic(result.stderr || result.stdout || `exit ${result.code}`);
      throw new Error(
        `Cursor CLI agent failed (exit ${result.code}) for model ${CURSOR_CLI_PROVIDER_ID}/${session.model}: ${detail}`,
      );
    }

    const assistant = result.stdout.trim();
    if (assistant) {
      session.messages.push({ role: "assistant", content: assistant });
    }
  }

  describeModel(session: { model?: string; lastModelDescription?: string }): string {
    return session.lastModelDescription
      || `${CURSOR_CLI_PROVIDER_ID}/${session.model ?? "unknown"}`;
  }
}
