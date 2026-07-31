import { spawn } from "node:child_process";

/*
FNXC:CursorCli 2026-07-31-09:40:
ISS-CLI-005 / G1.3: Cursor CLI planning and execution must invoke the real
`cursor-agent` print-mode contract (`-p --model --workspace --trust`), not the
FN-3396 no-op stub. Stream stdout to the session text callback and fail closed
on non-zero exit so Fusion never claims a successful Cursor turn without CLI
output. Windows keeps shell spawn for `.cmd` shims; Unix stays direct-spawn.
*/

export interface CursorAgentPrintOptions {
  binary: string;
  cwd: string;
  modelId: string;
  prompt: string;
  /** When true, allow write/shell tools (`--force`). Readonly/plan lanes omit it and pass `--mode plan`. */
  allowWrites: boolean;
  timeoutMs: number;
  onText?: (delta: string) => void;
  env?: NodeJS.ProcessEnv;
}

export interface CursorAgentPrintResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function buildCursorAgentPrintArgs(options: {
  modelId: string;
  cwd: string;
  allowWrites: boolean;
  prompt: string;
}): string[] {
  const args = [
    "-p",
    "--output-format",
    "text",
    "--model",
    options.modelId,
    "--workspace",
    options.cwd,
    "--trust",
  ];
  if (options.allowWrites) {
    args.push("--force");
  } else {
    args.push("--mode", "plan");
  }
  args.push(options.prompt);
  return args;
}

export async function runCursorAgentPrint(options: CursorAgentPrintOptions): Promise<CursorAgentPrintResult> {
  const args = buildCursorAgentPrintArgs({
    modelId: options.modelId,
    cwd: options.cwd,
    allowWrites: options.allowWrites,
    prompt: options.prompt,
  });

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    const child = spawn(options.binary, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // best effort
      }
      finish(124);
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stdout += text;
      options.onText?.(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.once("error", (error: Error & { code?: unknown }) => {
      const code = typeof error.code === "string" ? error.code : "spawn";
      stderr = stderr ? `${stderr}\nspawn error: ${code}: ${error.message}` : `spawn error: ${code}: ${error.message}`;
      finish(127);
    });
    child.once("close", (code) => {
      finish(code);
    });
  });
}
