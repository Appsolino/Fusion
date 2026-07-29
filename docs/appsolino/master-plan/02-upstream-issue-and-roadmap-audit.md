# Upstream Issue and Roadmap Audit

Last updated: 2026-07-29
Remotes verified: `upstream` → `https://github.com/Runfusion/Fusion.git`, `origin` → `https://github.com/Appsolino/Fusion.git`
Upstream checkout observed: `/srv/software-factory/source/fusion-upstream` at `1861a3353` (detached; may lag remote)
Remote `upstream/main` observed via `ls-remote` (2026-07-29): `b85a5d4531df8fa749d77bf85ea4ab9ab960ce86`

## Verified facts vs inference

- **Fact**: remote Appsolino `main` matched remote upstream `main` on 2026-07-29 (`b85a5d45…`).
- **Fact**: remote Appsolino `appsolino/stable` is distinct (`04054631…`) and contains merged Appsolino PRs #5 and #6.
- **Fact**: local tracking refs in `source/fusion-appsolino` are stale relative to `ls-remote`.
- **Inference**: Appsolino should treat `ls-remote` / GitHub API as upstream truth until local refs are refreshed post-preservation.

## High-overlap open upstream issues

| Issue | Title | Overlap with Appsolino | Plan implication |
| --- | --- | --- | --- |
| [#2476](https://github.com/Runfusion/Fusion/issues/2476) | Execution reuses stale planning-time worktree base — dependency-gated tasks start behind merged deps | Direct: stale base / dependency-gated execution | **Verify upstream**; Appsolino must implement or adopt base-refresh at execution acquisition; regression mandatory |
| [#2211](https://github.com/Runfusion/Fusion/issues/2211) | Worktree management improvements | Direct: worktree scope/lifecycle | Track; avoid duplicate Appsolino worktree managers |
| [#2186](https://github.com/Runfusion/Fusion/issues/2186) | Fresh isolated sandbox per session + symbol-level locking | Isolation / parallelism | Prefer upstream direction; Appsolino keeps bubblewrap host policy |
| [#1399](https://github.com/Runfusion/Fusion/issues/1399) | Replace heartbeat polling with event-driven wakeups | Cost / maintenance LLM spam | Align Phase 7 with upstream; do not invent competing heartbeat product |
| [#2181](https://github.com/Runfusion/Fusion/issues/2181) | Hard budget caps (USD/token) + failure taxonomy | Provider cost control | Contribute/adapt; Appsolino gateway should not fork taxonomy forever |
| [#2180](https://github.com/Runfusion/Fusion/issues/2180) | Deterministic quality-gate pipeline + blind review council | Verification integrity | Overlaps verification manifest goals — prefer contribute |
| [#2480](https://github.com/Runfusion/Fusion/issues/2480) | Memoization + failure budget for mission validation | Deterministic retry / unchanged input | Align with Appsolino fingerprint + retry budget |
| [#2076](https://github.com/Runfusion/Fusion/issues/2076) | Failed tasks lack root-cause / auto-retry/escalation | Recovery UX | Observability + typed failure classes |
| [#2189](https://github.com/Runfusion/Fusion/issues/2189) | Heartbeat-driven self-healing | Self-healing ownership | Risk of overlapping lifecycle authorities — Appsolino must not add a third healer |
| [#2205](https://github.com/Runfusion/Fusion/issues/2205) | Visual agent-activity monitoring | Ops visibility | Complement Appsolino ops dashboard; do not replace durable execution view |

## Upstream architectural signals (verified in-tree)

| Signal | Evidence | Note |
| --- | --- | --- |
| In-memory `mergeActive` set | `packages/engine/src/project-engine.ts` (`mergeActive = new Set`, reconcile timer) | Upstream already documents leak risk and reconcilers; Appsolino must still treat durable merge leases as required |
| Bubblewrap / container / native sandboxes | `docs/sandbox.md`, `packages/engine/src/sandbox/*` | Keep bubblewrap as primary Linux isolation |
| Schema ceiling + `StaleBinarySchemaError` | `packages/core/src/postgres/schema-applier.ts` | Upstream already refuses binary older than DB; Appsolino release-schema-consistency extends multi-surface identity |
| Docker packaging | root `Dockerfile` (node:22-slim builder/runner, app at `/app`, project at `/workspace`) | Useful for disposable workers / CI; not preferred primary host runtime for Appsolino dedicated server |
| Release scripts | `package.json` `build`, `build:full`, `build:exe`, `release` | Packaged exe path exists; Appsolino still needs offline packaged-runtime acceptance beyond source tests |
| Migrations | upstream checkout lags newer migrations present in `fusion-development` (through `0036_chat_session_tags.sql`) | Migration dual-track risk confirmed |

## Appsolino-only / Appsolino-first work (not found as first-class upstream modules)

Verified present in Appsolino/dev trees; **not** found as equivalent modules under inspected upstream engine tree names:

| Appsolino module | Purpose | Upstream posture |
| --- | --- | --- |
| `merge-contamination-gate.ts` | Fail-closed foreign commits / path-set mismatch | Contribute core idea; keep Appsolino markers until merged |
| `merge-candidate-patch.ts` | `base + task-owned patch` candidate | Strong upstream candidate after packaged proof |
| `deterministic-block-disposition.ts` | Non-retryable fingerprint + generation | Contribute |
| `contaminated-branch-recovery.ts` | Automatic clean branch reconstruction | Contribute after soak |
| `execution-branch.ts` | `fusion/<task>/<execution>` provenance | Contribute; aligns with #2211/#2476 |
| `release-schema-consistency.ts` | Multi-authority release/schema gate | Mostly Appsolino ops; slim core may contribute |
| `task-environment-preflight.ts` | Pre-token env readiness | Contribute |
| Host surgical installers / `fusion-update` | Production overlay & release automation | Remain Appsolino-specific; never upstream host paths |

## Recent regression / hotspot files (conflict risk)

Highest merge-conflict likelihood on upstream absorb:

1. `packages/engine/src/executor.ts`
2. `packages/engine/src/scheduler.ts`
3. `packages/engine/src/self-healing.ts`
4. `packages/engine/src/worktree-acquisition.ts`
5. `packages/engine/src/merger-ai.ts` / `project-engine.ts`
6. `packages/core/src/postgres/schema-applier.ts`
7. `packages/core/src/central-core.ts`
8. Dashboard task workflow routes / retry surfaces

## Upstream features Appsolino should **not** reimplement

- Event-driven agent wakeups (#1399) — adopt/track
- Hard token/USD budgets taxonomy (#2181) — adopt/track
- Symbol-level locking / fresh sandbox direction (#2186) — adopt/track
- Broad “god mode” / experimental UI — out of reliability scope

## Packaging / runtime notes

- Upstream Dockerfile pins `pnpm@10.33.0` and Node 22 image; production host currently uses **Node v24.18.0** under `/opt/node-v24.18.0` — treat Node major as a release-manifest field, not an assumption.
- `build:full` / `build:exe` exist; Appsolino incident FUSI-007 shows **source tests ≠ packaged CLI runtime**.
- Upstream `assertBinaryNotOlderThanDatabase` is necessary but **not sufficient** for Appsolino multi-wrapper identity.

## Overlap summary

| Appsolino workstream | Prefer |
| --- | --- |
| Contamination gate / patch candidate / execution branches | Reimplement cleanly on baseline → contribute upstream |
| Deterministic disposition / retry lock | Adapt existing Appsolino source → contribute |
| Release/schema consistency + host activation | Keep Appsolino-specific; slim contribute |
| Environment preflight / worktree deps | Adapt → contribute |
| Surgical installers | Retire after packaged release |
| Managed-source / auto-release automation | Appsolino-specific |
| FUS-010/029 `autoMerge=false` | Keep Appsolino-specific (`ISSUE-RECONCILIATION.md`) |
| `appsolino_0001` marker grants | Keep; absorb carefully with schema-applier |
| Heartbeat/cost/event wakeups | Verify upstream; wrap/adopt rather than fork |
| Upstream foreign-tip reclaim (`82e0ce313` class) | Partial overlap only — does **not** supersede CONTAM path-set gates |

Note: `task-worktree-dependency-prep.ts` is referenced by host installers but was **missing** from upstream, appsolino git tips, and the checked fusion-development tree — treat as host-script/source drift to resolve in Phase 2/4 (do not assume the module is committed).
