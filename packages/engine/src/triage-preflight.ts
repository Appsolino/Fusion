import type { Task } from "@fusion/core";

export interface CitedConstruct {
  kind: "identifier" | "snippet" | "command";
  raw: string;
  filePath?: string;
  line?: number;
}

export interface GhostBugProbeResult {
  construct: CitedConstruct;
  matched: boolean;
  probeError?: string;
  output?: string;
}

export interface GhostBugDecision {
  decision: "archive" | "pass";
  reason: string;
  findings: GhostBugProbeResult[];
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ProbeExec = (command: string, options?: { cwd?: string; timeoutMs?: number }) => Promise<ExecResult>;

const BUG_FIX_REGEX = /typecheck error|compile error|broken|regression|lint error/i;

/** Fusion CLI/tool identifiers are orchestration helpers, not target-repo constructs. */
const FUSION_TOOL_NAME = /^fn_[a-z][a-z0-9_]*$/i;

/**
 * Bare root documentation / manifest filenames are frequently cited as context,
 * not as missing code symbols. Treating them as greppable identifiers under a
 * hardcoded `packages/` tree produces false ghost-bug archives.
 */
const ROOT_DOC_OR_MANIFEST =
  /^(readme(?:\.\w+)?|package\.json|changelog(?:\.\w+)?|license(?:\.\w+)?|tsconfig(?:\.\w+)?\.json|cargo\.toml|go\.mod|pyproject\.toml|gemfile|composer\.json)$/i;

/** Source-ish relative paths outside the historical Fusion-only `packages/` prefix. */
const REPO_FILE_PATH =
  /(?<![A-Za-z0-9_./-])((?:packages|apps|src|lib|services|server|client|web|api|backend|frontend|docs)\/[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|md|json))(?::(\d+))?/g;

export function isBugFixShape(task: { title: string | null; description: string }): boolean {
  const title = task.title?.trim() ?? "";
  const description = task.description?.trim() ?? "";
  if (!title && !description) return false;
  if (/^\s*fix\b/i.test(title)) return true;
  return BUG_FIX_REGEX.test(`${title}\n${description}`);
}

/**
 * Drop constructs that are not useful as definitive "exists on main" probes.
 * Preserves real identifiers / paths / simple call forms for ghost-bug detection.
 */
export function shouldIgnoreCitedConstruct(construct: CitedConstruct): boolean {
  const raw = construct.raw.trim();
  if (!raw) return true;
  if (construct.kind === "command") return false;
  if (construct.kind === "snippet") {
    // Snippets are already line-bounded; only drop empty leftovers.
    return false;
  }
  if (FUSION_TOOL_NAME.test(raw)) return true;
  if (ROOT_DOC_OR_MANIFEST.test(raw)) return true;
  // Full formatted expressions / object literals are not greppable identifiers.
  if (raw.includes("{") || raw.includes("}") || raw.includes(";") || raw.includes("\n")) return true;
  const open = raw.indexOf("(");
  if (open >= 0) {
    const close = raw.lastIndexOf(")");
    const args = close > open ? raw.slice(open + 1, close) : raw.slice(open + 1);
    // `foo()` / `foo.bar()` stay; `updateMany({ where: ... })` is ignored.
    if (args.length > 0 && /[{}=,]/.test(args)) return true;
  }
  return false;
}

export function extractCitedConstructs(prompt: string): CitedConstruct[] {
  const seen = new Set<string>();
  const constructs: CitedConstruct[] = [];
  const add = (construct: CitedConstruct) => {
    if (shouldIgnoreCitedConstruct(construct)) return;
    if (construct.raw.trim().length === 0) return;
    const key = `${construct.kind}:${construct.raw}:${construct.filePath ?? ""}:${construct.line ?? ""}`;
    if (seen.has(key) || constructs.length >= 20) return;
    seen.add(key);
    constructs.push(construct);
  };

  const identifierRegex = /`([A-Za-z_][A-Za-z0-9_.]*\([^`]*\)|[A-Za-z_][\w.]{2,})`/g;
  for (const match of prompt.matchAll(identifierRegex)) {
    const raw = match[1].trim();
    if (raw.includes("(") || raw.includes(".") || raw.includes("_")) {
      add({ kind: "identifier", raw });
    }
  }

  for (const match of prompt.matchAll(REPO_FILE_PATH)) {
    const filePath = match[1];
    const line = match[2] ? Number.parseInt(match[2], 10) : undefined;
    add({ kind: "identifier", raw: filePath, filePath, line });
  }

  const fenceRegex = /```(?:\w+)?\n([\s\S]*?)```/g;
  for (const match of prompt.matchAll(fenceRegex)) {
    const lines = match[1].split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.includes("(") || line.includes("=") || line.includes("import")) {
        add({ kind: "snippet", raw: line });
      }
    }
  }

  for (const line of prompt.split("\n")) {
    if (/^\s*(?:pnpm|npm|yarn|tsc|node|eslint)\b[^\n]+/m.test(line)) {
      add({ kind: "command", raw: line.trim() });
    }
  }

  return constructs;
}

function buildProbeCommand(construct: CitedConstruct): string {
  if (construct.kind === "command") {
    return construct.raw;
  }

  // Path citations: prove the file exists on HEAD. Do not require the path string
  // to also appear as content inside the file.
  if (construct.filePath) {
    // Quote the full HEAD:path object name so shell metacharacters cannot split it.
    return `git cat-file -e ${JSON.stringify(`HEAD:${construct.filePath}`)} && echo FOUND || true`;
  }

  // Repo-wide search — do not hardcode Fusion's packages/ layout.
  if (construct.kind === "identifier" || construct.kind === "snippet") {
    return `git grep -nF -- ${JSON.stringify(construct.raw)} || true`;
  }

  return construct.raw;
}

export async function probeCitedConstructs(
  constructs: CitedConstruct[],
  opts: { cwd: string; timeoutMs?: number; exec: ProbeExec },
): Promise<GhostBugProbeResult[]> {
  const findings: GhostBugProbeResult[] = [];
  const timeoutMs = opts.timeoutMs ?? 5000;

  for (const construct of constructs) {
    try {
      const command = buildProbeCommand(construct);
      const { stdout, stderr } = await opts.exec(command, { cwd: opts.cwd, timeoutMs });
      if (construct.kind === "command") {
        // FN-4892: command probes are intentionally non-definitive here because
        // ProbeExec does not expose exit codes. Keep fail-open behavior.
        findings.push({
          construct,
          matched: true,
          output: `${stdout}${stderr}`.trim(),
          probeError: "exit_code_unavailable",
        });
        continue;
      }
      const output = `${stdout}${stderr}`.trim();
      findings.push({ construct, matched: output.length > 0, output });
    } catch (error) {
      findings.push({
        construct,
        matched: false,
        probeError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return findings.filter((result) => !result.probeError || result.matched === true || result.matched === false);
}

export async function runGhostBugPreflight(
  task: Pick<Task, "title" | "description">,
  prompt: string,
  opts: { cwd: string; timeoutMs?: number; exec: ProbeExec },
): Promise<GhostBugDecision> {
  if (!isBugFixShape({ title: task.title ?? null, description: task.description ?? "" })) {
    return { decision: "pass", reason: "not_bug_fix_shape", findings: [] };
  }

  const constructs = extractCitedConstructs(prompt);
  if (constructs.length === 0) {
    return { decision: "pass", reason: "no_constructs", findings: [] };
  }

  const findings = await probeCitedConstructs(constructs, opts);
  const definitive = findings.filter((finding) => !finding.probeError);
  if (definitive.length === 0) {
    return { decision: "pass", reason: "no_definitive_probe_signal", findings };
  }

  if (definitive.every((finding) => finding.matched === false)) {
    return {
      decision: "archive",
      reason: "all_cited_constructs_missing_on_main",
      findings,
    };
  }

  return { decision: "pass", reason: "construct_found_or_inconclusive", findings };
}
