# Full autonomy — architecture & operations

<!-- FNXC:FullAutonomy 2026-08-07-21:14 -->

Companion to [FULL-AUTONOMY-AUDIT.md](./FULL-AUTONOMY-AUDIT.md). Host D remains **`enginePaused=true`** until owner authorises Soak R2. Soak #1 failed (SOAK-DEFECT-001); remediation [#159](https://github.com/Appsolino/Fusion/pull/159) is on Host D `auto3-0.75.1-cb506f2095f4`.

## Architecture

```text
control plane (dashboard / webhooks / overseer requests)
      ↓
authoritative scheduler / WorkflowGraphExecutor
      ↓
durable claims + self-healing reconciliation
      ↓
isolated worktree execution (plan → implement → validate → review)
      ↓
PR entity path (pr-create → await-review → gate / ci-repair → pr-merge)
      ↓
GitHub checks (PrReconciler) → merge when policy allows
      ↓
mission continuation (feature sync + next eligible task)
```

**Single authority:** only the scheduler/graph may start work. Overseer, heartbeat, CI watcher, and dashboard emit events or request transitions — they must not independently launch duplicate execution.

## Recovery behavior

| Failure | Automatic behavior |
| --- | --- |
| Process / VPS restart | Self-healing startup reconcile + held/runnable workflow continuations |
| Stale claim / dead worker | Self-healing reclaim + requeue (bounded) |
| Workspace/worktree leak | Self-healing orphan worktree sweeps |
| Review rejection | `pr-respond` bounded rework → await-review |
| CI failure (autoMerge) | `outcome:ci-failed` / `checks-failed` → `ci-repair` (budgeted) → await-review |
| CI repair exhausted | `ci-repair-exhausted` manual hold (visible, not silent) |
| Merge conflict | await-rebase / direct-merge AI path (PR path weaker) |
| Duplicate webhook / event | Idempotent PR entity + pending-outcome clear-once |
| Retry budget exhausted | Terminal/blocked with actionable reason on the task |

## Operations

**Why is task X stuck?**  
Board column + workflow pin node + status/error + run-audit (`task:hold-release-event`, `auto-merge-gate-ci-failed`, `ci-repair-exhausted`) + PR entity `checksRollup` / `reviewDecision`.

**Current attempt?**  
PR entity `responseRounds`; task recovery/retry counters; workflow work-item attempt.

**Safe retry?**  
Manual release of `ci-repair-exhausted` / `await-review-hold` / `failed` holds; operator promote with care. Do not force-push protected branches.

**Cancel?**  
User pause / move to todo (hard cancel semantics) / close PR.

**Leaked resources?**  
Self-healing audits for orphaned worktrees and phantom leases; do not walk the whole OS temp tree.

**Startup reconciliation?**  
`SelfHealingManager` on engine boot before normal dispatch; Host D must not stay paused if unattended progress is required.

## Known remaining gaps before lights-out YES

1. CI log fetch → repair-agent prompt enrichment.
2. End-to-end soak under unpaused Host D (owner authorisation required) — **gate for lights-out YES**.
3. Extend restart matrix only if soak exposes a missing recovery path (no architecture expansion until soak PASS).
