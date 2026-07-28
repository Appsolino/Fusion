# Merge hardening — permanent platform invariants

Status: **in progress** (phase 1 shipped: fail-closed contamination / attribution gate)

This document is the contract for the platform hardening work described after the
FUSI-001 / FUSI-003 contaminated merge incident. Cleaning a single task branch is
not sufficient; contaminated branches, oversized merge candidates, empty Vitest
selection, and leaked `mergeActive` state must be blocked by permanent controls.

## Phase 1 (shipped) — fail closed before Code Review / AI merge

| Invariant | Code | Behavior |
|-----------|------|----------|
| Foreign or unattributed commits on task branch | `BLOCKED_BRANCH_CONTAMINATION` | Block Code Review entry; refuse `runAiMerge` before agents/clean-room |
| Raw path set ≠ attributed path set | `BLOCKED_ATTRIBUTION_MISMATCH` | Same fail-closed path; diagnostics list unexpected / missing / renamed |
| Oversized merge candidate vs ledger | `BLOCKED_ATTRIBUTION_MISMATCH` | `evaluateCandidateAttributionMatch` (ready for patch-based merge) |

Attribution mismatch compares **canonical path sets**, not counts:

```text
unexpected = normalize(rawPaths) − normalize(attributedPaths)
missing    = normalize(attributedPaths) − normalize(rawPaths)
```

Equal counts with disjoint members still block.

Implementation:

* `packages/engine/src/merge-contamination-gate.ts`
* `packages/engine/src/branch-attribution.ts` (`rawDiffFiles`, `renamedPaths`)
* Wired in `executor.ts` (`optionalGroupId === "code-review"`)
* Wired in `merger-ai.ts` `runAiMerge` **before** merge/review agents and clean-room install
* Failures set `paused` + `status=failed` with the blocking code; **not** transient-retryable

Until phases 2+ land, auto-merge must not proceed when:

```text
foreign commits > 0
OR raw path set != attributed path set
```

## Remaining phases (recommended order)

1. ~~Fail closed on foreign commits and attribution mismatch~~ (**done**)
2. **Task-owned patch merge candidates**
3. **Base-pinned disposable branches**
4. **Ownership ledger**
5. **Verification manifest replay**
6. **Empty-test-selection gate**
7. **Durable merge leases**
8. **Dashboard workflow-run states**

Patch-only candidates and base-pinned branches provide the largest immediate reduction in merge risk. The ownership ledger then makes that isolation authoritative rather than inferred.

## Acceptance tests (platform hardening task)

### Contaminated branch

Given one task commit + one foreign commit:

* Code Review entry: blocked
* AI merger invoked: no
* Model tokens: no
* Error: `BLOCKED_BRANCH_CONTAMINATION`

### Oversized candidate

Attribution ledger 19 files, candidate 20:

* Merge preflight: blocked
* Unexpected file explicitly reported

### Empty Vitest selection

Verification command matches zero files:

* Merge preflight: blocked
* Vitest not executed
* Error: `BLOCKED_VERIFICATION_SELECTION_EMPTY`

### Exact verification replay

Successful implementation manifest replayed identically in clean room.

### Leased merge

Kill merger mid-run → lease expires → stale run terminal → new `merge_run_id` can start.

### Clean execution

Fresh base-pinned worktree → task-owned patch only → verification replay → merge completes with only task files.

## Security / sandbox note

`ProtectSystem=strict` with `ReadWritePaths=/srv/software-factory` (and fusion lock dir)
remains the OS boundary. This document covers **merge correctness** invariants inside
that tree, not systemd sandboxing.
