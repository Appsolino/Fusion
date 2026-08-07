# Full automation — Phase 1 audit & gap matrix

<!-- FNXC:FullAutonomy 2026-08-07-21:18 -->

**Branch:** landed via PR [#155](https://github.com/Appsolino/Fusion/pull/155) (**MERGED** `662a3d5e…`)  
**Scope:** Fusion board task loop (not Appsolino AUTO-1/2/3 maintenance plane)  
**Live status:** [`CURRENT-STATE.md`](CURRENT-STATE.md) only — Host D `enginePaused` soak **not authorised**.

## Authoritative layers (post-cutover)

```text
Scheduler                    admits / candidacy / concurrency / hold-release
      ↓
TaskExecutor.executeWorkflowGraph
      ↓
WorkflowGraphExecutor        sole orchestrator of plan / implement / review / PR nodes
      ↓
SelfHealingManager           startup + periodic reconcile (no independent launch)
      ↓
Merger / PrReconciler        direct merge OR PR entity lifecycle
```

**Invariant:** scheduler admits; graph executor owns the run. Dashboard / overseer / heartbeat / CLI request transitions — must not double-launch.

## Durable vs in-process

| Concern | Durable? | Notes |
| --- | --- | --- |
| Task claim | YES | `task_claims` |
| Checkout | YES | checkout leases |
| Graph routing / `graphRouting` | NO | in-process; restart → startup resume + self-healing |
| CI repair attempt count | YES | PR entity `responseRounds` |
| `lastRepairedHeadOid` anti-spam | PARTIAL | graph `context` today — restart-weak |

## Launch paths (single authority)

- Scheduler dispatch → `executeWorkflowGraph`
- Hold-release sweep (external events, capacity)
- Self-healing requeues (bounded, audited)
- Overseer interventions (request fix — must not bypass claim)
- CLI / dashboard promote / force (operator)

## Lifecycle vs required loop

| Phase | Existing | Gap |
| --- | --- | --- |
| Choose / claim / plan / implement | Scheduler + graph + durable store | Observability “why stuck” |
| Validation / review / repair findings | Verify + review + pr-respond (bounded) | — |
| PR create/update | `pr-create` + idempotent entity | — |
| Wait for CI | PrReconciler + checks rollup | — |
| Repair CI failures | **YES on branch** — routing + `decideCiRepairAction` + CI-log evidence → repair agent (`ci-failure-evidence` / `ci-repair-run`) | Prove on Host D soak |
| Conflict / merge / mission continue | Merger strong direct; PR holds; feature sync | PR-head rebase weaker |
| Restart recovery | Self-healing + PR entity R15 + pending hold outcome in `sourceMetadata` | Soak needs unpaused engine |

## PR #155 slice (landed on branch)

1. `deriveTransitions` → `checks-failed` / `checks-succeeded` hold releases.
2. Auto-merge gate → `outcome:ci-failed` when `autoMerge && checksRollup=failure`.
3. Pure `ci-repair.ts` + dependability tests (budget, same-head anti-spam, transient vs deterministic).
4. `releaseHeldTaskByEvent` persists `workflowExternalEventOutcome`; hold consumes once.
5. Builtin PR IR: `gate --ci-failed--> ci-repair`, `await-review --checks-failed--> ci-repair`.

## Acceptance snapshot

| Criterion | Status |
| --- | --- |
| One authoritative scheduler → graph orchestrator | YES |
| Durable claims + leases | YES (`graphRouting` not durable) |
| CI repair autonomous | **YES on branch** (routing + decisions + log enrichment); soak pending |
| Merge conflict recovery | PARTIAL (direct strong; PR path holds) |
| Soak test | **BLOCKED** — Host D `enginePaused` without owner OK |
| Duplicate-event safety | Mostly YES (PR R15, claims, pending-outcome clear) |
| Restart/recovery tests | Seed matrix on branch (`full-autonomy-restart-dependability.test.ts`) |

## Path to lights-out YES (no further architecture expansion)

1. Get [#155](https://github.com/Appsolino/Fusion/pull/155) green and merged — **DONE**.
2. CI-log → repair-agent enrichment — **DONE** (remain inside `decideCiRepairAction`).
3. Expand restart/recovery tests — **seed done**; extend only if soak finds a hole.
4. Host D soak (~10 tasks) after **owner** unpause — include ≥1 CI repair and ≥1 restart — **BLOCKED** on `enginePaused`.
5. Require zero duplicates/leaks/deadlocks/manual steering + PASS restart / CI repair / continuation.

**Prohibit** further architecture expansion until the soak passes.
