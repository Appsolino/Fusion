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
| Wait for CI | PrReconciler polls checksRollup | checks-failed/succeeded releases + hold outcome routing |
| Repair CI failures | Gate `ci-failed` → `ci-repair` (pr-respond mode) | CI log fetch / agent prompt enrichment still thin |
| Branch drift / conflict | Merger AI (direct); PR conflict holds | PR-head rebase/repair weaker than direct |
| Merge when policy allows | auto-merge gate + pr-merge / merger | — |
| Mission continuation | mission-feature-sync + scheduler | Duplicate-completion tests exist in places |
| Restart recovery | Self-healing startup + PR entity R15 + pending hold outcome in sourceMetadata | Need soak under unpaused engine |

## Launch paths (must stay single-authority)

- Scheduler dispatch → executor / graph
- Hold-release sweep (external events, capacity)
- Self-healing requeues (bounded, audited)
- Overseer interventions (request fix — must not bypass claim)
- CLI/dashboard promote/force (operator)

## This PR slice

1. `deriveTransitions` emits `checks-failed` / `checks-succeeded` → `github:pr-checks-*` hold releases.
2. Auto-merge gate routes `outcome:ci-failed` when `autoMerge && checksRollup=failure`.
3. Pure `ci-repair.ts` decision/classifier + dependability tests (budget, same-head anti-spam, transient vs deterministic).
4. `releaseHeldTaskByEvent` persists `workflowExternalEventOutcome` and seeds a runnable continuation at the hold pin.
5. Hold handler consumes that outcome so `outcome:approved` / `outcome:checks-failed` edges traverse.
6. Builtin PR IR: `gate --ci-failed--> ci-repair`, `await-review --checks-failed--> ci-repair`, exhausted manual hold.

## Acceptance snapshot (honest)

| Criterion | Status |
| --- | --- |
| One authoritative scheduler | YES (architecture) |
| Durable claims / self-healing | YES (mature) |
| CI repair autonomous | **PARTIAL** — routing + decisions + IR + hold outcome plumbing; CI log→agent enrichment remains |
| Merge conflict recovery | PARTIAL (strong direct-merge; PR path holds) |
| Soak test | **BLOCKED** until Host D engine unpause authorised |
| Duplicate events | Mostly YES (PR entity R15, claims, pending-outcome clear) |

## Next authorised work

1. Enrich `ci-repair` agent prompt with failed-check log excerpts (still bounded by decideCiRepairAction).
2. Expand dependability suite (restart points, workspace leak).
3. Request Host D unpause for soak — **do not self-authorise**.
