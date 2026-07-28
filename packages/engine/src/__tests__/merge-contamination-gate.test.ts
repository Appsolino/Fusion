import { describe, expect, it } from "vitest";
import {
  BLOCKED_ATTRIBUTION_MISMATCH,
  BLOCKED_BRANCH_CONTAMINATION,
  assertMergeContaminationClear,
  diffNormalizedPathSets,
  evaluateCandidateAttributionMatch,
  evaluateMergeContaminationGate,
  MergeContaminationGateError,
  normalizeRepoRelativePath,
} from "../merge-contamination-gate.js";
import type { AttributionResult } from "../branch-attribution.js";
import type { BranchAttributionReport } from "../branch-conflicts.js";

function cleanAttribution(files: string[], rawFiles?: string[]): AttributionResult {
  const raw = rawFiles ?? files;
  return {
    files,
    foreignCommits: [],
    ownCommitCount: files.length > 0 ? 1 : 0,
    ownCommitShas: files.length > 0 ? ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] : [],
    rawDiffFileCount: raw.length,
    rawDiffFiles: raw,
    commitAttributions: [],
  };
}

function cleanReport(): BranchAttributionReport {
  return { ownTrailed: 1, ownUntrailed: [], foreign: [], unattributed: [] };
}

describe("merge-contamination-gate", () => {
  it("normalizes path separators and ./ prefixes", () => {
    expect(normalizeRepoRelativePath(".\\packages\\a.ts")).toBe("packages/a.ts");
    expect(normalizeRepoRelativePath("./packages/a.ts")).toBe("packages/a.ts");
  });

  it("diffNormalizedPathSets catches equal-count disjoint sets", () => {
    const diff = diffNormalizedPathSets(["a.ts", "b.ts"], ["a.ts", "c.ts"]);
    expect(diff.equal).toBe(false);
    expect(diff.unexpectedRawFiles).toEqual(["b.ts"]);
    expect(diff.missingAttributedFiles).toEqual(["c.ts"]);
  });

  it("passes when foreign=0 and raw path set equals attributed", async () => {
    const files = ["packages/dashboard/app/App.tsx", "docs/guide.md"];
    const result = await evaluateMergeContaminationGate({
      repoDir: "/tmp/unused",
      taskId: "FUSI-001",
      branch: "fusion/fusi-001",
      baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      attribution: cleanAttribution(files),
      attributionReport: cleanReport(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attributedFileCount).toBe(2);
      expect(result.rawChangedFileCount).toBe(2);
    }
  });

  it("blocks when counts match but path sets differ", async () => {
    const result = await evaluateMergeContaminationGate({
      repoDir: "/tmp/unused",
      taskId: "FUSI-001",
      branch: "fusion/fusi-001",
      baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      attribution: cleanAttribution(
        ["owned/a.ts", "owned/b.ts"],
        ["owned/a.ts", "foreign/x.ts"],
      ),
      attributionReport: cleanReport(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(BLOCKED_ATTRIBUTION_MISMATCH);
      expect(result.unexpectedFiles).toEqual(["foreign/x.ts"]);
      expect(result.missingAttributedFiles).toEqual(["owned/b.ts"]);
      expect(result.message).toContain("unexpected raw files=[foreign/x.ts]");
      expect(result.message).toContain("missing attributed files=[owned/b.ts]");
    }
  });

  it("blocks Code Review / merge on foreign commits (contaminated branch test)", async () => {
    const attribution: AttributionResult = {
      files: ["a.ts"],
      foreignCommits: [
        { sha: "ffffffffffffffffffffffffffffffffffffffff", subject: "feat(OTHER-1): leak", attributedTaskId: "OTHER-1" },
      ],
      ownCommitCount: 1,
      rawDiffFileCount: 5,
      rawDiffFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
      commitAttributions: [],
    };
    const result = await evaluateMergeContaminationGate({
      repoDir: "/tmp/unused",
      taskId: "FUSI-001",
      branch: "fusion/fusi-001",
      baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      attribution,
      attributionReport: {
        ownTrailed: 1,
        ownUntrailed: [],
        foreign: [{ sha: "ffffffffffffffffffffffffffffffffffffffff", subject: "feat(OTHER-1): leak", foreignTaskId: "OTHER-1" }],
        unattributed: [],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(BLOCKED_BRANCH_CONTAMINATION);
      expect(result.message).toContain(BLOCKED_BRANCH_CONTAMINATION);
      expect(result.foreignCommitCount).toBe(1);
    }
  });

  it("blocks on unattributed commits", async () => {
    const result = await evaluateMergeContaminationGate({
      repoDir: "/tmp/unused",
      taskId: "FUSI-001",
      branch: "fusion/fusi-001",
      baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      attribution: cleanAttribution(["a.ts"]),
      attributionReport: {
        ownTrailed: 0,
        ownUntrailed: [],
        foreign: [],
        unattributed: [{ sha: "cccccccccccccccccccccccccccccccccccccccc", subject: "wip without id" }],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(BLOCKED_BRANCH_CONTAMINATION);
      expect(result.unattributedCommitCount).toBe(1);
    }
  });

  it("blocks on raw != attributed file counts with set diagnostics", async () => {
    const attributed = Array.from({ length: 19 }, (_, i) => `owned/${i}.ts`);
    const raw = [
      ...attributed.slice(0, 18),
      ...Array.from({ length: 147 }, (_, i) => `foreign/${i}.ts`),
    ];
    const result = await evaluateMergeContaminationGate({
      repoDir: "/tmp/unused",
      taskId: "FUSI-001",
      branch: "fusion/fusi-001",
      baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      attribution: {
        files: attributed,
        foreignCommits: [],
        ownCommitCount: 1,
        rawDiffFileCount: raw.length,
        rawDiffFiles: raw,
        commitAttributions: [],
      },
      attributionReport: cleanReport(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(BLOCKED_ATTRIBUTION_MISMATCH);
      expect(result.rawChangedFileCount).toBe(165);
      expect(result.attributedFileCount).toBe(19);
      expect(result.unexpectedFiles?.length).toBe(147);
      expect(result.missingAttributedFiles).toEqual(["owned/18.ts"]);
    }
  });

  it("oversized candidate test: reports unexpected files", () => {
    const attributed = Array.from({ length: 19 }, (_, i) => `owned/${i}.ts`);
    const candidate = [...attributed, "unexpected/extra.ts"];
    const result = evaluateCandidateAttributionMatch({
      taskId: "FUSI-001",
      attributedFiles: attributed,
      candidateFiles: candidate,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "unexpectedFiles" in result) {
      expect(result.code).toBe(BLOCKED_ATTRIBUTION_MISMATCH);
      expect(result.unexpectedFiles).toEqual(["unexpected/extra.ts"]);
      expect(result.message).toContain("unexpected raw files=[unexpected/extra.ts]");
    }
  });

  it("reports renamed paths in attribution mismatch diagnostics", async () => {
    const result = await evaluateMergeContaminationGate({
      repoDir: "/tmp/unused",
      taskId: "FUSI-001",
      branch: "fusion/fusi-001",
      baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      attribution: {
        files: ["new-name.ts"],
        foreignCommits: [],
        ownCommitCount: 1,
        rawDiffFileCount: 2,
        rawDiffFiles: ["old-name.ts", "new-name.ts"],
        renamedPaths: [{ from: "old-name.ts", to: "new-name.ts" }],
        commitAttributions: [],
      },
      attributionReport: cleanReport(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(BLOCKED_ATTRIBUTION_MISMATCH);
      expect(result.message).toContain("renamed paths=[old-name.ts→new-name.ts]");
      expect(result.renamedPaths).toEqual([{ from: "old-name.ts", to: "new-name.ts" }]);
    }
  });

  it("assertMergeContaminationClear throws non-retryable gate error", async () => {
    await expect(
      assertMergeContaminationClear({
        repoDir: "/tmp/unused",
        taskId: "FUSI-001",
        branch: "fusion/fusi-001",
        baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        attribution: {
          files: [],
          foreignCommits: [{ sha: "dddddddddddddddddddddddddddddddddddddddd", subject: "x", attributedTaskId: "X-1" }],
          ownCommitCount: 0,
          rawDiffFileCount: 1,
          rawDiffFiles: ["x.ts"],
          commitAttributions: [],
        },
        attributionReport: cleanReport(),
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(MergeContaminationGateError);
      if (err instanceof MergeContaminationGateError) {
        expect(err.retryable).toBe(false);
        expect(err.code).toBe(BLOCKED_BRANCH_CONTAMINATION);
      }
      return true;
    });
  });
});
