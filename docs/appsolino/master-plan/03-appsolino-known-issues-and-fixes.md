# Appsolino Known Issues and Fixes Register

Last updated: 2026-07-29
Sources: `docs/appsolino/reset/01-issue-fix-register.md`, merge-hardening docs, runtime identity report, verified source modules, host units
Status values: `live` | `live-surgical` | `source-only` | `tested-source-only` | `host-installed` | `historical` | `unresolved`

## Taxonomy legend

- **Root cause**: `proven` | `probable` | `unresolved`
- **Disposition**: `verify-upstream` | `adapt` | `reimplement` | `contribute` | `replace` | `retire`

---

## A. Runtime and permissions

### ISS-ENV-001 — systemd EROFS during dependency installation
- **Symptom**: Worktree/dep install fails with read-only filesystem under `ProtectSystem=strict`.
- **Impact**: Tasks fail after model spend or during prep; operators widen paths ad-hoc.
- **Evidence**: Reset APP-ENV-002; `fusion.service.d/40-automation-rw.conf` documents `ReadWritePaths=/srv/software-factory`.
- **Root cause**: proven — sandbox + incomplete writable paths.
- **Origin**: Appsolino host config interacting with upstream worktree/pnpm behaviour.
- **Modules**: systemd unit/drop-ins; worktree dep prep.
- **Workaround**: Broad `ReadWritePaths` for platform root.
- **Source fix**: Host drop-in live; source `task-worktree-dependency-prep` / installer.
- **Production**: live.
- **Permanent control**: Explicit path contract in provisioning; private pnpm stores under writable roots; never compile on production.
- **Regression**: Env acceptance — dep install in fresh worktree under production unit policy.
- **Priority**: P0
- **Disposition**: adapt host contract into provisioning; verify upstream sandbox docs.

### ISS-ENV-002 — insufficient writable paths / ownership conflicts (root vs fusion)
- **Symptom**: Root-owned files in runtime paths; chmod/link failures; agents escalate constantly.
- **Impact**: Flaky worktrees; shared store corruption risk.
- **Evidence**: APP-ENV-001 wrappers force `User=fusion`; identity report; fusion-developers ACLs.
- **Root cause**: proven mixed ownership history.
- **Permanent control**: Path ownership matrix (`06-provisioning…`); automatic ownership drift alert; umask `0027`.
- **Regression**: Root-owned contamination detector.
- **Priority**: P0
- **Disposition**: reimplement clean layout on rebuild.

### ISS-ENV-003 — shared pnpm store chmod / materialisation failures
- **Symptom**: New worktrees fail linking/chmod against shared store.
- **Impact**: Late deterministic failures; false “code” failures.
- **Evidence**: APP-ENV-004 installer; FUSI-001 logs.
- **Root cause**: proven shared mutable store + multi-uid.
- **Permanent control**: Private store per build/release; `package-import-method=copy` or content-addressed read-mostly store; never shared writable store across root/fusion.
- **Priority**: P0
- **Disposition**: adapt Appsolino private-store strategy.

### ISS-ENV-004 — missing tools discovered only after model use
- **Symptom**: Env gaps found mid-agent.
- **Impact**: Token waste; opaque pauses.
- **Evidence**: APP-ENV-003 `fusion-doctor` + `task-environment-preflight.ts`.
- **Root cause**: proven missing preflight.
- **Permanent control**: Mandatory preflight V3 before first token; fail closed.
- **Priority**: P0
- **Disposition**: adapt + contribute.

### ISS-ENV-005 — source/build on production host
- **Symptom**: Production tied to source checkouts or surgical overlays.
- **Impact**: Irreproducible identity; schema surprises.
- **Evidence**: base unit still references `source/fusion-appsolino/.../bin.js` (overridden by drop-in); surgical live release.
- **Root cause**: proven process history.
- **Permanent control**: Env C forbids compile; only immutable releases.
- **Priority**: P0
- **Disposition**: retire production source-run paths.

---

## B. Release and schema

### ISS-REL-001 — multiple deployment identity authorities disagree
- **Symptom**: Service/CLI/manifest/controller report different SHAs.
- **Evidence**: reset 03; `status.json` `deployedSha=7ad5a33…` vs live `contam-gate-surgical…` / `BUILD_COMPLETE fc485b05…`.
- **Root cause**: proven.
- **Permanent control**: Single activator writes symlink + manifest + controller atomically; readiness fails on disagreement.
- **Priority**: P0
- **Disposition**: reimplement activation authority.

### ISS-REL-002 — production binary older than database schema
- **Symptom**: CLI `StaleBinarySchemaError` (DB 0036, binary 0035) while dashboard health OK.
- **Evidence**: runtime-identity-report-2026-07-28.
- **Root cause**: proven — newer binary migrated DB; production pinned older surgical ceiling.
- **Permanent control**: `release-schema-consistency` + `assertBinaryNotOlderThanDatabase` on service start and CLI; refuse activation if schemaMax < applied.
- **Priority**: P0
- **Disposition**: adapt source gate; deploy via trusted release.

### ISS-REL-003 — full CLI build `backendHandle is only available in backend mode`
- **Symptom**: Packaged CLI fails at runtime after source tests pass.
- **Evidence**: FUSI-007; commit `4553fd05…` on contaminated `fusion/fusi-007`; live bundle still contains guard string per reset grep.
- **Root cause**: proven historical; fix tested-source-only, not live.
- **Modules**: `packages/core/src/central-core.ts`, CLI build-runtime tests.
- **Permanent control**: Packaged-runtime smoke in release pipeline; layerless close guard.
- **Priority**: P0
- **Disposition**: reimplement cleanly from file-level patch (not whole contaminated branch); contribute.

### ISS-REL-004 — source tests pass; packaged `dist/bin.js` unverified
- **Symptom**: False confidence in deployability.
- **Root cause**: proven process gap.
- **Permanent control**: Packaged runtime test stage mandatory before staging install.
- **Priority**: P0
- **Disposition**: reimplement release pipeline.

### ISS-REL-005 — surgical Phase 1 becomes production dependency
- **Symptom**: Cannot full-build/deploy; overlay is the product.
- **Evidence**: live `contam-gate-surgical-20260728T103231Z`.
- **Root cause**: proven.
- **Permanent control**: Explicit retirement gate after packaged Phase 1+2.
- **Priority**: P0
- **Disposition**: retire after acceptance.

### ISS-REL-006 — rollback binary cannot understand migrated DB
- **Symptom**: Rollback bricks CLI/API.
- **Root cause**: proven class (same as ISS-REL-002).
- **Permanent control**: Compatibility window in manifest; rollback only to schema-compatible releases; forward-fix migrations preferred.
- **Priority**: P0
- **Disposition**: reimplement migration policy.

---

## C. Git, branches, worktrees

### ISS-GIT-001 — task branches contain foreign commits
- **Symptom**: ~30 foreign commits; huge raw diffs vs attributed sets.
- **Evidence**: CONTAM-001; FUSI-007 `foreignCommits=30`.
- **Root cause**: proven reusable/contaminated branches + history merge.
- **Permanent control**: Contamination gate; execution-specific branches; patch-only candidates.
- **Priority**: P0
- **Disposition**: adapt Phase 1–3 Appsolino work; contribute.

### ISS-GIT-002 — reusable `fusion/<task-id>` branches without provenance
- **Symptom**: Stale bases; cross-execution contamination.
- **Evidence**: `execution-branch.ts` comments; upstream #2476.
- **Root cause**: proven design gap.
- **Permanent control**: `fusion/<task-id>/<execution-id>` + provenance reuse checks.
- **Priority**: P0
- **Disposition**: adapt + verify-upstream #2476/#2211.

### ISS-GIT-003 — stale task bases / dependency-gated tasks on pre-dependency bases
- **Symptom**: Dependents execute without dependency commits.
- **Evidence**: upstream #2476 (detailed); Appsolino dependency-sync work in dirty tree.
- **Root cause**: proven upstream gap; probable Appsolino exposure.
- **Permanent control**: Base refresh at execution acquisition; stale-base typed block.
- **Priority**: P0
- **Disposition**: verify-upstream; implement if not merged by baseline pin date.

### ISS-GIT-004 — raw branch diff ≠ task attribution; equal counts mask disjoint sets
- **Symptom**: False “same size” merges.
- **Evidence**: CONTAM-002; merge-hardening.md canonical set algebra.
- **Root cause**: proven.
- **Permanent control**: Canonical path-set comparison (not counts).
- **Priority**: P0
- **Disposition**: adapt live Phase 1; ensure in clean source.

### ISS-GIT-005 — whole task-branch history used as merge source
- **Symptom**: Foreign history squash-merged.
- **Evidence**: Phase 2 design; FUSI-001 incident class 165/19 files.
- **Root cause**: proven.
- **Permanent control**: `recorded base + task-owned patch`.
- **Production**: source-only (not live).
- **Priority**: P0
- **Disposition**: reimplement on clean baseline from preserved hashes.

### ISS-GIT-006 — orphaned / wrongly bound worktrees
- **Symptom**: Wrong toplevel/branch; missing worktree while mergeActive.
- **Evidence**: self-healing missing-worktree sweeps; executor workspace verification comments.
- **Root cause**: proven class in upstream+Appsolino.
- **Permanent control**: Provenance bind; lease + cleanup; alert on worktree leak.
- **Priority**: P1
- **Disposition**: harden native.

---

## D. Workflow and recovery

### ISS-WF-001 — multiple components control lifecycle transitions
- **Symptom**: Scheduler, executor, workflow graph, merger, self-healing overlap.
- **Evidence**: Large `self-healing.ts` / `scheduler.ts` / `executor.ts`; upstream heartbeat vs scheduler (#1399).
- **Root cause**: proven architectural debt.
- **Permanent control**: One coordinator authority; others propose events only.
- **Priority**: P0
- **Disposition**: incremental harden native (Phase 5).

### ISS-WF-002 — deterministic failures repeatedly redispatched
- **Symptom**: `paused → todo → same failure → paused`.
- **Evidence**: FUSI-006 disposition modules; task logs.
- **Root cause**: proven.
- **Permanent control**: Fingerprint + generation + retry budget + terminal disposition.
- **Production**: source-only.
- **Priority**: P0
- **Disposition**: adapt + contribute.

### ISS-WF-003 — Retry UI/API repeats unchanged failure
- **Evidence**: RETRY-001 `taskRecovery.ts` + docs.
- **Root cause**: proven.
- **Permanent control**: Retry lock until recovery generation changes.
- **Priority**: P0
- **Disposition**: adapt.

### ISS-WF-004 — completed stages revisited after recovery
- **Root cause**: probable without durable checkpoints.
- **Permanent control**: Immutable stage checkpoints; resume from next incomplete stage.
- **Priority**: P1
- **Disposition**: reimplement in execution record.

### ISS-WF-005 — `mergeActive` process-local leak after timeout
- **Evidence**: upstream `project-engine.ts` comments; self-healing reconcilers.
- **Root cause**: proven upstream in-memory design.
- **Permanent control**: Durable merge lease in DB; in-memory cache only.
- **Priority**: P1
- **Disposition**: harden native; contribute.

### ISS-WF-006 — AI work continues after orchestration timeout
- **Root cause**: probable incomplete process-group cancellation on some paths.
- **Evidence**: sandbox native tests kill process groups; not all agent paths proven.
- **Permanent control**: Timeout kills process group; lease expiry cancels workers.
- **Priority**: P1
- **Disposition**: harden; packaged chaos tests.

### ISS-WF-007 — self-healing compensates for invalid upstream state
- **Root cause**: probable over-broad healers.
- **Permanent control**: Prevent invalid state at gates; healers only for crash/lease expiry classes.
- **Priority**: P1
- **Disposition**: harden; do not expand healer scope.

---

## E. Verification

### ISS-VER-001 — review vs merge reconstruct different verification commands
- **Symptom**: Executor runs deterministic verification only when `settings.testCommand`/`buildCommand` are set; merger may `inferDefaultTestCommand` and file-scope changed paths.
- **Evidence**: Engine audit of `runExecutorDeterministicVerification` vs `merger-workspace-test-commands.ts` / merger inference path.
- **Root cause**: proven — command construction differs without a shared persisted manifest.
- **Permanent control**: Persist and replay exact verification manifest across implement / review / merge.
- **Priority**: P0
- **Disposition**: reimplement Phase 6.

### ISS-VER-002 — clean room reports no tests despite tests existing
- **Evidence**: merge-hardening remaining phases “empty-test-selection gate”.
- **Root cause**: proven class historically.
- **Permanent control**: Expected test-file/test minimums; fail closed on zero discovery when policy requires tests.
- **Priority**: P0
- **Disposition**: reimplement.

### ISS-VER-003 — missing expected test-count validation
- **Priority**: P1
- **Disposition**: reimplement with manifest.

### ISS-VER-004 — source-level tests without production-shaped packaged-runtime tests
- **Priority**: P0
- **Disposition**: release pipeline (ISS-REL-004).

### ISS-VER-005 — heavy mocks on important runtime paths
- **Root cause**: probable in dashboard/engine tests.
- **Permanent control**: Packaged/integration tests for gates; mock budget in CI for critical paths.
- **Priority**: P2
- **Disposition**: harden test policy.

---

## F. Models and cost

### ISS-MDL-001 — one provider/quota issue interrupts all work
- **Permanent control**: Multi-provider routing + classified outages vs task failures.
- **Priority**: P1
- **Disposition**: wrap native providers (Phase 7).

### ISS-MDL-002 — retries spend tokens on unchanged input
- **Permanent control**: Fingerprint gate before token stages; memoization (#2480 alignment).
- **Priority**: P0
- **Disposition**: adapt disposition + gateway.

### ISS-MDL-003 — maintenance heartbeats use unnecessary model calls
- **Evidence**: upstream #1399.
- **Priority**: P1
- **Disposition**: verify-upstream; adopt event-driven wakeups.

### ISS-MDL-004 — no central provider routing / cost control
- **Evidence**: upstream #2181.
- **Priority**: P1
- **Disposition**: wrap + adopt upstream budgets.

### ISS-MDL-005 — provider outage misclassified as implementation failure
- **Permanent control**: Failure taxonomy; provider stage vs code stage.
- **Priority**: P1
- **Disposition**: reimplement classification.

---

## G. Observability and operations

### ISS-OPS-001 — operators reconstruct state from journal logs
- **Permanent control**: Single durable execution view (metrics + task execution record).
- **Priority**: P0
- **Disposition**: observability plan.

### ISS-OPS-002 — insufficient release/schema identity visibility
- **Evidence**: identity split; controller FAILED_NEEDS_OPERATOR.
- **Priority**: P0
- **Disposition**: readiness endpoint + alerts.

### ISS-OPS-003 — insufficient alerts for deterministic loops / restore testing
- **Evidence**: backup timers exist (`fusion-remote-backup`, `fusion-dr-restore-drill`) but production identity still drifted.
- **Priority**: P1
- **Disposition**: harden alerts + mandatory restore drills.

---

## H. Mapping prior Appsolino fixes → clean-baseline decision

| Fix / lesson | Decision |
| --- | --- |
| systemd write-path correction | **reuse** into provisioning templates |
| environment preflight V3 | **adapt** from `task-environment-preflight.ts` + `fusion-doctor` |
| dependency preparation / private store | **adapt** installer semantics into source+provisioning |
| Phase 1 contamination gate | **reimplement** on clean baseline from surgical+source; retire surgical |
| canonical path-set comparison | **reuse** logic; contribute |
| pre-token review gate | **reuse**/adapt wiring in executor |
| pre-token merge gate | **adapt** with Phase 2 |
| Phase 2 patch-only candidate | **reimplement** from hashed files (not dirty whole-tree commit) |
| automatic branch recovery | **adapt** `contaminated-branch-recovery.ts` |
| execution-specific branches | **adapt** `execution-branch.ts` |
| deterministic failure disposition | **adapt** |
| Retry UI/API lock | **adapt** |
| release/schema consistency gate | **adapt**; wire into service start |
| activation tooling | **reimplement** single authority (`fusion-release` lineage) |
| CentralCore/backendHandle correction | **reimplement** from `4553fd05` file set only |
| Focused unit tests | **reuse** as starting suite; add packaged-runtime proofs |

**Do not** cherry-pick contaminated branches wholesale.
