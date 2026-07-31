> **Status: Historical/reference**
> This document does not override `MASTER-PLAN.md`, `OPERATING-MODEL.md` or `CURRENT-STATE.md`.

# Target Reliability Architecture

Last updated: 2026-07-29

## 1. Target control model

```text
one workflow coordinator
+ disposable specialised workers
+ durable execution records
+ fenced stage leases
+ immutable checkpoints
+ task-owned patches
+ replayable verification manifests
+ typed bounded recovery
+ atomic releases
```

**Implementation locus:** incrementally **inside Fusion** (Appsolino fork), contributing generic pieces upstream.
**Not** a separate outer control plane in Phases 0–7.
**Not** Temporal/Restate unless Phase 5 acceptance fails (`08-…` reconsider later).

## 2. Current control-path analysis (verified / inferred)

| Component | Authoritative state today | Duplicated ownership | In-memory-only | Durable | Restart | Timeout | Retry | Cancel | Side effects | Known failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Workflow graph / IR | DB task + workflow IR pin | Executor + scheduler interpret | Some runtime caches | Yes (DB) | Resume from task status | Varies | Revision budgets exist | Partial | Agent prompts | Skip/taint paths complex |
| Scheduler | DB queue + events | Overlaps self-healing | Timers | Mostly | Re-claims | — | Can redispatch blocked tasks | — | Status transitions | ISS-WF-002 |
| Executor | Task steps + worktree meta | Owns stage execution | Session handles | Partial | Risk revisit | Agent timeouts | Tool-failure retries | Partial | Git, FS, model | Contamination entry; large file |
| Reviewer | Review stage results | Gate vs AI review | — | Partial | — | Token spend | — | — | Model | Pre-token gap fixed surgically |
| Merger / AI merge | Merge queue + results | project-engine + merger-ai + self-heal | **`mergeActive` Set** | Partial | Leak risk | Merge timeouts | Auto-merge retries | — | Git merge | ISS-WF-005; history merge |
| Self-healing | Sweeps + recovery counters | Broad authority | Reconcile timers | Partial | Aggressive | — | Recovery retries | Clears meta | Status moves | Over-heal |
| Worktree manager | Paths + branch names | acquisition + executor | Reservations | Meta in DB | Orphans | — | Re-acquire | Dispose hooks | Disk/git | #2476 stale base |
| Persistence | Postgres | Schema applier gates | — | Yes | — | — | — | — | Migrations | 0035/0036 split |
| Providers | Plugin runtimes | Per plugin | Sessions | — | — | Provider timeouts | Opaque | — | Tokens $$ | ISS-MDL-* |
| Dashboard / CLI | API + wrappers | Multiple entrypoints | — | — | — | — | Retry UI | — | Identity | Wrapper vs schema |
| Plugins / missions | Extensible | Autopilot overlaps | — | Varies | — | Heartbeats | Validation loops | — | Model | #2480 |
| Session liveness | Process-local registry | Overlaps self-heal triple-proof | `activeSessionRegistry`, `executingTaskLock` | No cross-process | Lost on crash | — | — | Blocks reclaim | Multi-process blind (**inference**) |
| Merge occupancy | Process-local | Self-heal callbacks | `mergeActive` + `mergeQueue` | Partial DB merge status | Leak / wrong occupancy | Merge timeouts | Auto-merge retries | Blocks enqueue | ISS-WF-005 |

## 3. Durable execution record (target)

Required fields:

- `taskId`, `executionId`, `generation`
- `stage`, `completedStages[]`, `stageCheckpoints{}`
- branch/worktree provenance (base SHA, branch name, paths)
- verification manifest reference
- agent-session identity
- lease (`owner`, `expiresAt`, `fencingToken`)
- failure classification + fingerprint
- `recoveryGeneration`
- terminal outcome

## 4. Legal lifecycle (simplified)

```text
created → claimed → stage(n) → checkpointed → …
  ↘ blocked_deterministic (terminal until generation↑)
  ↘ blocked_retryable (budget/backoff)
  ↘ cancelled
  ↘ succeeded
  ↘ failed_terminal
```

Illegal without generation change:
`paused → todo → in_progress → same fingerprint → paused` loop.

## 5. Failure behaviour matrix (target)

| Failure | Behaviour |
| --- | --- |
| Process crash | Lease expires; another worker may claim next incomplete stage; checkpoints preserved |
| Service restart | Same |
| Server restart | Same + worktree reconcile |
| Model timeout | Kill process group; classify provider/timeout; budgeted retry |
| Provider rate limit | Backoff; do not burn identical prompt indefinitely |
| Provider outage | Mark provider stage outage; failover if configured; not “code failed” |
| Worktree missing | Reconstruct from provenance or terminal `BLOCKED_WORKTREE_MISSING` |
| Branch contaminated | Auto recover once per generation or deterministic block |
| Stale base / dep merged | Refresh or `BLOCKED_STALE_BASE` (#2476) |
| Verification timeout | Kill process group; fail manifest |
| Zero discovered tests | Fail closed when policy requires tests |
| Review rejection | Typed revise with budget |
| Merge conflict | Deterministic block or bounded AI merge with fingerprint |
| Integration advance | Candidate rebuild from new recorded base policy |
| Schema mismatch | Refuse claims; alert P0 |
| Disk full | Terminal infra block; no token spend |
| Package install failure | Env preflight failure; deterministic |
| Task cancellation | Cancel lease + process group; terminal cancelled |
| Operator pause | Durable pause; resume requires explicit action |

## 6. Retry contract

Every automatic retry requires:

1. retry budget remaining
2. cause fingerprint
3. recovery generation
4. changed condition (or explicit operator override)
5. backoff
6. terminal disposition when exhausted

## 7. Git / worktree master plan

**Source of truth:** recorded integration base + task-owned patch (+ ownership ledger).
Branches/worktrees are implementation surfaces.

Required:

- `executionId`; recorded `baseSha`; task-owned paths; ownership ledger
- branch `fusion/<task-id>/<execution-id>`
- execution-specific worktree
- patch generation (`git diff --binary -M`)
- contamination detection; automatic reconstruction
- merge candidate = base + patch; verify; cleanup; evidence archive

Reuse only with validated provenance (task, execution, base, ownership).
**No AI reviewer/merger tokens before deterministic Git preflight.**

## 8. Verification contract

Persist: executable, args, cwd, env fingerprint, expected test-file min, expected test min, timeout, exit code, output ref, source stage, result hash.

Replay same successful manifest in implementation, Code Review, and merge candidate verification.

Timeouts terminate **process groups**, not only Promises (extend sandbox guarantees to all agent/verify spawns).

## 9. How this eliminates observed loops

| Observed loop | Control |
| --- | --- |
| Deterministic contamination redispatched | disposition + generation lock |
| Manual Retry same failure | Retry API checks generation |
| mergeActive leak blocks forever | durable lease replaces Set-as-authority |
| AI continues after timeout | process group kill + lease cancel |
| Self-heal invents progress | healers cannot skip gates or clear fingerprints without generation↑ |
