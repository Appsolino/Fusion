/**
 * Merge / Code Review contamination gate (fail-closed).
 *
 * Permanent platform invariant: a task branch with foreign commits, unattributed
 * commits, or raw-vs-attributed file divergence must not enter Code Review or
 * spend AI merge tokens. See integrations/fusion-platform/docs/merge-hardening.md.
 *
 * Retry policy: these failures are deterministic. Callers must park the task
 * with a blocking diagnostic and must NOT classify them as transient merge retries.
 *
 * Attribution mismatch compares canonical path *sets*, not counts:
 *   unexpected = rawPaths − attributedPaths
 *   missing    = attributedPaths − rawPaths
 */

import { filterFilesToOwnTaskCommits, type AttributionResult } from "./branch-attribution.js";
import { reportBranchAttribution, type BranchAttributionReport } from "./branch-conflicts.js";

export const BLOCKED_BRANCH_CONTAMINATION = "BLOCKED_BRANCH_CONTAMINATION" as const;
export const BLOCKED_ATTRIBUTION_MISMATCH = "BLOCKED_ATTRIBUTION_MISMATCH" as const;

export type MergeContaminationCode =
  | typeof BLOCKED_BRANCH_CONTAMINATION
  | typeof BLOCKED_ATTRIBUTION_MISMATCH;

export interface MergeContaminationGateInput {
  repoDir: string;
  taskId: string;
  /** Task branch ref (e.g. fusion/fusi-001). */
  branch: string;
  /**
   * Immutable recorded base for this execution. Prefer task.baseCommitSha.
   * When omitted, callers should resolve merge-base(integration, branch) first.
   */
  baseSha: string;
  /**
   * When set, resolve merge-base for diagnostics (soft — does not block on drift).
   */
  integrationBranch?: string;
  /**
   * Treat path comparison as case-insensitive (macOS/Windows-style repos).
   * Default false (Linux / typical Fusion hosts).
   */
  caseInsensitivePaths?: boolean;
  /** Optional precomputed attribution (tests). */
  attribution?: AttributionResult;
  /** Optional precomputed report (tests). */
  attributionReport?: BranchAttributionReport;
  /** Inject for unit tests. */
  resolveMergeBase?: (repoDir: string, a: string, b: string) => Promise<string>;
  filterFiles?: typeof filterFilesToOwnTaskCommits;
  reportAttribution?: typeof reportBranchAttribution;
}

export interface MergeContaminationGatePass {
  ok: true;
  code: null;
  attributedFileCount: number;
  rawChangedFileCount: number;
  foreignCommitCount: number;
  unattributedCommitCount: number;
  attributedFiles: string[];
  rawFiles: string[];
  attribution: AttributionResult;
  report: BranchAttributionReport;
}

export interface MergeContaminationGateFail {
  ok: false;
  code: MergeContaminationCode;
  message: string;
  attributedFileCount: number;
  rawChangedFileCount: number;
  foreignCommitCount: number;
  unattributedCommitCount: number;
  foreignCommits: { sha: string; subject: string; attributedTaskId?: string | null }[];
  /** rawPaths − attributedPaths */
  unexpectedFiles?: string[];
  /** attributedPaths − rawPaths */
  missingAttributedFiles?: string[];
  renamedPaths?: { from: string; to: string }[];
  attributedFiles: string[];
  rawFiles?: string[];
  mergeBase?: string;
  recordedBaseSha: string;
  attribution: AttributionResult;
  report: BranchAttributionReport;
}

export type MergeContaminationGateResult = MergeContaminationGatePass | MergeContaminationGateFail;

export class MergeContaminationGateError extends Error {
  readonly name = "MergeContaminationGateError";
  readonly code: MergeContaminationCode;
  readonly retryable = false as const;
  readonly details: MergeContaminationGateFail;

  constructor(details: MergeContaminationGateFail) {
    super(details.message);
    this.code = details.code;
    this.details = details;
  }
}

/** Normalize to repo-relative POSIX path; drop empties/duplicates at call site via Set. */
export function normalizeRepoRelativePath(path: string, caseInsensitive = false): string {
  let p = path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  while (p.startsWith("./")) p = p.slice(2);
  p = p.replace(/\/{2,}/g, "/");
  if (p.startsWith("/")) p = p.replace(/^\/+/, "");
  if (caseInsensitive) p = p.toLowerCase();
  return p;
}

export function diffNormalizedPathSets(
  rawPaths: readonly string[],
  attributedPaths: readonly string[],
  opts?: { caseInsensitive?: boolean },
): {
  unexpectedRawFiles: string[];
  missingAttributedFiles: string[];
  equal: boolean;
} {
  const caseInsensitive = opts?.caseInsensitive === true;
  const raw = new Set(
    rawPaths.map((p) => normalizeRepoRelativePath(p, caseInsensitive)).filter(Boolean),
  );
  const attributed = new Set(
    attributedPaths.map((p) => normalizeRepoRelativePath(p, caseInsensitive)).filter(Boolean),
  );
  const unexpectedRawFiles = [...raw].filter((p) => !attributed.has(p)).sort((a, b) => a.localeCompare(b));
  const missingAttributedFiles = [...attributed].filter((p) => !raw.has(p)).sort((a, b) => a.localeCompare(b));
  return {
    unexpectedRawFiles,
    missingAttributedFiles,
    equal: unexpectedRawFiles.length === 0 && missingAttributedFiles.length === 0,
  };
}

async function defaultResolveMergeBase(repoDir: string, a: string, b: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync("git", ["merge-base", a, b], {
    cwd: repoDir,
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

function resolveRawFiles(attribution: AttributionResult): {
  files: string[];
  incomplete: boolean;
} {
  if (Array.isArray(attribution.rawDiffFiles)) {
    return {
      files: attribution.rawDiffFiles.map((p) => p.trim()).filter(Boolean),
      incomplete: false,
    };
  }
  if (attribution.rawDiffFileCount === 0 && attribution.files.length === 0) {
    return { files: [], incomplete: false };
  }
  // Fail closed: a count without a path list cannot prove set equality.
  return { files: [], incomplete: true };
}

/**
 * Evaluate whether a task branch is clean enough for Code Review / AI merge.
 * Does not throw — callers decide park vs log. Use {@link assertMergeContaminationClear}
 * at merge entry to fail closed.
 */
export async function evaluateMergeContaminationGate(
  input: MergeContaminationGateInput,
): Promise<MergeContaminationGateResult> {
  const filter = input.filterFiles ?? filterFilesToOwnTaskCommits;
  const reportFn = input.reportAttribution ?? reportBranchAttribution;
  const resolveMergeBase = input.resolveMergeBase ?? defaultResolveMergeBase;
  const caseInsensitive = input.caseInsensitivePaths === true;

  const attribution =
    input.attribution
    ?? await filter({
      worktreePath: input.repoDir,
      baseRef: input.baseSha,
      taskId: input.taskId,
    });

  const report =
    input.attributionReport
    ?? await reportFn(input.repoDir, input.branch, input.baseSha, input.taskId);

  const foreignFromAttribution = attribution.foreignCommits;
  const foreignFromReport = report.foreign;
  const unattributed = report.unattributed;
  const foreignCommitCount = Math.max(foreignFromAttribution.length, foreignFromReport.length);
  const unattributedCommitCount = unattributed.length;
  const attributedFiles = attribution.files;
  const rawResolved = resolveRawFiles(attribution);
  const rawFiles = rawResolved.files;
  const rawChangedFileCount = attribution.rawDiffFileCount || rawFiles.length;
  const attributedFileCount = attributedFiles.length;
  const renamedPaths = attribution.renamedPaths ?? [];

  let mergeBase: string | undefined;
  if (input.integrationBranch) {
    try {
      mergeBase = await resolveMergeBase(input.repoDir, input.branch, input.integrationBranch);
    } catch {
      mergeBase = undefined;
    }
  }

  const foreignDetails = foreignFromAttribution.length > 0
    ? foreignFromAttribution.map((c) => ({
      sha: c.sha,
      subject: c.subject,
      attributedTaskId: c.attributedTaskId,
    }))
    : foreignFromReport.map((c) => ({
      sha: c.sha,
      subject: c.subject,
      attributedTaskId: c.foreignTaskId,
    }));

  if (foreignCommitCount > 0 || unattributedCommitCount > 0) {
    const preview = [
      ...foreignDetails.slice(0, 5).map((c) => `${c.sha.slice(0, 12)}(${c.attributedTaskId ?? "unattributed"})`),
      ...unattributed.slice(0, 3).map((c) => `${c.sha.slice(0, 12)}(unattributed)`),
    ].join(", ");
    return {
      ok: false,
      code: BLOCKED_BRANCH_CONTAMINATION,
      message:
        `${BLOCKED_BRANCH_CONTAMINATION}: task ${input.taskId} branch ${input.branch} has `
        + `foreignCommits=${foreignCommitCount} unattributedCommits=${unattributedCommitCount} `
        + `since base ${input.baseSha.slice(0, 12)}`
        + (preview ? ` [${preview}]` : "")
        + `. Code Review and AI merge are refused until the branch is rebuilt from a clean base-pinned worktree.`,
      attributedFileCount,
      rawChangedFileCount,
      foreignCommitCount,
      unattributedCommitCount,
      foreignCommits: foreignDetails,
      attributedFiles,
      rawFiles,
      renamedPaths,
      mergeBase,
      recordedBaseSha: input.baseSha,
      attribution,
      report,
    };
  }

  if (rawResolved.incomplete) {
    return {
      ok: false,
      code: BLOCKED_ATTRIBUTION_MISMATCH,
      message:
        `${BLOCKED_ATTRIBUTION_MISMATCH}: task ${input.taskId} attribution result lacks rawDiffFiles `
        + `(rawDiffFileCount=${attribution.rawDiffFileCount}) — cannot prove path-set equality; refusing merge.`,
      attributedFileCount,
      rawChangedFileCount,
      foreignCommitCount: 0,
      unattributedCommitCount: 0,
      foreignCommits: [],
      unexpectedFiles: [],
      missingAttributedFiles: attributedFiles.slice(),
      renamedPaths,
      attributedFiles,
      rawFiles: [],
      mergeBase,
      recordedBaseSha: input.baseSha,
      attribution,
      report,
    };
  }

  const pathDiff = diffNormalizedPathSets(rawFiles, attributedFiles, { caseInsensitive });
  if (!pathDiff.equal) {
    const unexpectedPreview = pathDiff.unexpectedRawFiles.slice(0, 10).join(", ");
    const missingPreview = pathDiff.missingAttributedFiles.slice(0, 10).join(", ");
    const renamePreview = renamedPaths
      .slice(0, 5)
      .map((r) => `${r.from}→${r.to}`)
      .join(", ");
    return {
      ok: false,
      code: BLOCKED_ATTRIBUTION_MISMATCH,
      message:
        `${BLOCKED_ATTRIBUTION_MISMATCH}: task ${input.taskId} raw/attributed path sets diverge `
        + `(raw=${rawChangedFileCount} attributed=${attributedFileCount}, base ${input.baseSha.slice(0, 12)})`
        + (unexpectedPreview ? `; unexpected raw files=[${unexpectedPreview}]` : "")
        + (missingPreview ? `; missing attributed files=[${missingPreview}]` : "")
        + (renamePreview ? `; renamed paths=[${renamePreview}]` : "")
        + `. Merge candidate must equal the attribution ledger.`,
      attributedFileCount,
      rawChangedFileCount,
      foreignCommitCount: 0,
      unattributedCommitCount: 0,
      foreignCommits: [],
      unexpectedFiles: pathDiff.unexpectedRawFiles,
      missingAttributedFiles: pathDiff.missingAttributedFiles,
      renamedPaths,
      attributedFiles,
      rawFiles,
      mergeBase,
      recordedBaseSha: input.baseSha,
      attribution,
      report,
    };
  }

  return {
    ok: true,
    code: null,
    attributedFileCount,
    rawChangedFileCount,
    foreignCommitCount: 0,
    unattributedCommitCount: 0,
    attributedFiles,
    rawFiles,
    attribution,
    report,
  };
}

/**
 * Fail-closed assert for merge / Code Review entry. Throws {@link MergeContaminationGateError}.
 */
export async function assertMergeContaminationClear(
  input: MergeContaminationGateInput,
): Promise<MergeContaminationGatePass> {
  const result = await evaluateMergeContaminationGate(input);
  if (!result.ok) {
    throw new MergeContaminationGateError(result);
  }
  return result;
}

/**
 * Compare a merge-candidate changed-file set to the attribution ledger.
 * Used after applying a task-owned patch (or inspecting a squash index) before AI tokens.
 */
export function evaluateCandidateAttributionMatch(opts: {
  taskId: string;
  attributedFiles: string[];
  candidateFiles: string[];
  caseInsensitivePaths?: boolean;
  renamedPaths?: { from: string; to: string }[];
}): MergeContaminationGateResult | { ok: true; unexpectedFiles: string[]; missingFiles: string[] } {
  const pathDiff = diffNormalizedPathSets(opts.candidateFiles, opts.attributedFiles, {
    caseInsensitive: opts.caseInsensitivePaths === true,
  });
  if (pathDiff.equal) {
    return { ok: true, unexpectedFiles: [], missingFiles: [] };
  }
  const emptyAttribution: AttributionResult = {
    files: opts.attributedFiles,
    foreignCommits: [],
    ownCommitCount: 0,
    rawDiffFileCount: opts.candidateFiles.length,
    rawDiffFiles: opts.candidateFiles,
    renamedPaths: opts.renamedPaths,
    commitAttributions: [],
  };
  const emptyReport: BranchAttributionReport = {
    ownTrailed: 0,
    ownUntrailed: [],
    foreign: [],
    unattributed: [],
  };
  const unexpectedPreview = pathDiff.unexpectedRawFiles.slice(0, 10).join(", ");
  const missingPreview = pathDiff.missingAttributedFiles.slice(0, 10).join(", ");
  const renamePreview = (opts.renamedPaths ?? [])
    .slice(0, 5)
    .map((r) => `${r.from}→${r.to}`)
    .join(", ");
  return {
    ok: false,
    code: BLOCKED_ATTRIBUTION_MISMATCH,
    message:
      `${BLOCKED_ATTRIBUTION_MISMATCH}: task ${opts.taskId} merge candidate path set diverges from attribution ledger`
      + ` (candidate=${opts.candidateFiles.length} attributed=${opts.attributedFiles.length})`
      + (unexpectedPreview ? `; unexpected raw files=[${unexpectedPreview}]` : "")
      + (missingPreview ? `; missing attributed files=[${missingPreview}]` : "")
      + (renamePreview ? `; renamed paths=[${renamePreview}]` : ""),
    attributedFileCount: opts.attributedFiles.length,
    rawChangedFileCount: opts.candidateFiles.length,
    foreignCommitCount: 0,
    unattributedCommitCount: 0,
    foreignCommits: [],
    unexpectedFiles: pathDiff.unexpectedRawFiles,
    missingAttributedFiles: pathDiff.missingAttributedFiles,
    renamedPaths: opts.renamedPaths,
    attributedFiles: opts.attributedFiles,
    rawFiles: opts.candidateFiles,
    recordedBaseSha: "",
    attribution: emptyAttribution,
    report: emptyReport,
  };
}
