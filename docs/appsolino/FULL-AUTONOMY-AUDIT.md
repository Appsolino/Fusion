# Full automation — Phase 1 audit & gap matrix

<!-- FNXC:FullAutonomy 2026-08-07-21:04 -->

**Branch:** `feat/full-autonomy` @ main tip including #153  
**Scope:** Fusion board task loop (not Appsolino AUTO-1/2/3 maintenance plane)  
**Host D:** `enginePaused=true` — live soak **not authorised**; platform work + fake-clock tests only.

## Authoritative control plane (existing)

```text
Scheduler (packages/engine/src/scheduler.ts)
      ↓ candidacy / concurrency / hold-release
WorkflowGraphExecutor + Executor
      ↓ plan / implement / review nodes
SelfHealingManager (startup + periodic reconcile)
      ↓ claims, worktrees, stranded states
Merger / PrReconciler / pr-nodes
      ↓ direct merge OR PR entity lifecycle
Mission feature sync
      ↓ continuation after complete
```

**Invariant already intended:** scheduler + graph own dispatch; dashboard/overseer/heartbeat request transitions; self-healing reconciles — must not independently double-launch.

## Lifecycle coverage vs required loop

| Phase | Existing | Gap |
| --- | --- | --- |
| Choose / claim / plan / implement | Scheduler + graph + durable store | Harden observability “why stuck” surfaces |
| Deterministic validation | Executor verify / merger verify | — |
| Review + repair findings | Workflow review + pr-respond rework (bounded) | — |
| PR create/update | `pr-create` + idempotent entity | — |
| Wait for CI | PrReconciler polls checksRollup | **Was no checks-failed release event** |
| Repair CI failures | Overseer `failed-check` → targeted fix (partial) | **No productized bounded CI repair route** |
| Branch drift / conflict | Merger AI (direct); PR conflict holds | PR-head rebase/repair weaker than direct |
| Merge when policy allows | auto-merge gate + pr-merge / merger | Failed CI previously collapsed to `auto-off` forever |
| Mission continuation | mission-feature-sync + scheduler | Duplicate-completion tests exist in places |
| Restart recovery | Self-healing startup + PR entity R15 | Need soak under unpaused engine |

## Launch paths (must stay single-authority)

- Scheduler dispatch → executor / graph
- Hold-release sweep (external events, capacity)
- Self-healing requeues (bounded, audited)
- Overseer interventions (request fix — must not bypass claim)
- CLI/dashboard promote/force (operator)

## This PR slice (first implementation)

1. `deriveTransitions` emits `checks-failed` / `checks-succeeded` → `github:pr-checks-*` hold releases.
2. Auto-merge gate routes `outcome:ci-failed` when `autoMerge && checksRollup=failure`.
3. Pure `ci-repair.ts` decision/classifier + dependability tests (budget, same-head anti-spam, transient vs deterministic).

**Not yet in this slice:** default workflow IR edges from `ci-failed` → repair agent node; live Host D soak; full Phase 19 matrix.

## Acceptance snapshot (honest)

| Criterion | Status |
| --- | --- |
| One authoritative scheduler | YES (architecture) |
| Durable claims / self-healing | YES (mature) |
| CI repair autonomous | **PARTIAL** — routing + decisions landed; agent dispatch IR wiring remains |
| Merge conflict recovery | PARTIAL (strong direct-merge; PR path holds) |
| Soak test | **BLOCKED** until Host D engine unpause authorised |
| Duplicate events | Mostly YES (PR entity R15, claims) |

## Next authorised work

1. Wire builtin PR workflow IR: `auto-merge-gate --ci-failed--> ci-repair → await-checks`.
2. Persist `ciRepairAttempts` / `lastRepairedHeadOid` on PR entity or task metadata.
3. Expand dependability suite (restart points, workspace leak).
4. Request Host D unpause for soak — **do not self-authorise**.
