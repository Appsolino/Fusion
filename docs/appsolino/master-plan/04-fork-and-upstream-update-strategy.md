# Fork and Upstream Update Strategy

Last updated: 2026-07-29

## 1. Recommended model: hybrid product fork

| Layer | Purpose |
| --- | --- |
| **Upstream mirror** | Exact `Runfusion/Fusion` history |
| **Appsolino product fork** | Reliability, release identity, host contracts, selected UX |
| **Plugins** | Provider/runtime extras and Appsolino-only integrations |
| **Host automation** | Provisioning, backups, activation — outside the Node package when possible |

**Not chosen as sole strategy:**
- Minimal patch fork alone — Appsolino reliability surface is too large (gates, disposition, release identity).
- Plugin-only — cannot safely intercept executor/merger/scheduler hotspots via plugins alone.
- Unbounded long-lived fork without upstream absorb process — bitrot.

## 2. Branch model

```text
upstream/main
    Exact mirror of Runfusion/Fusion (FF-only; no Appsolino commits).

appsolino/main
    Approved Appsolino product source (rebased/merged via integration branches).

appsolino/stable
    Last accepted product line for staging promotion candidates.

integration/upstream-<version>-<date>
    Temporary absorb branch from pinned upstream commit.

release/<appsolino-version>
    Exact source for an immutable release artefact (tag + manifest).

hotfix/<issue>
    Emergency correction; must merge back to appsolino/main within SLA.
```

Protected: `upstream/main` (mirror bots only), `appsolino/main`, `appsolino/stable`, `release/*` — **no force-push**.

## 3. What to contribute upstream vs keep Appsolino-specific

### Contribute (after packaged proof)

- Contamination gate + canonical path-set attribution
- Patch-only merge candidate construction
- Execution-specific branch provenance
- Deterministic block disposition + retry generation lock
- Contaminated-branch reconstruction
- Environment preflight before tokens
- Process-group cancellation guarantees where missing
- Durable merge lease design (if upstream agrees)

### Remain Appsolino-specific

- Host paths (`/opt/appsolino-fusion`, `/srv/appsolino-fusion`)
- `fusion-env` / `appsolino-fn-current` wrappers
- Release controller / remote backup / DR timers
- Managed-source branding and Appsolino update UX
- Full-admin sudo policy and provisioning playbooks
- Organisation boundary credentials model

### Hybrid

- `release-schema-consistency`: slim portable core upstream; Appsolino wires host paths/manifest fields

## 4. Hotspots for recurring merge conflicts

1. `packages/engine/src/{executor,scheduler,self-healing,worktree-acquisition,merger-ai,project-engine}.ts`
2. `packages/core/src/postgres/schema-applier.ts` + migrations
3. `packages/core/src/central-core.ts`
4. Dashboard task workflow / retry routes
5. Sandbox backends

**Mitigation:** keep Appsolino changes in **new modules** + thin call-site hooks; avoid editing 20k-line files when a helper module works (Appsolino Phase 2 pattern).

## 5. Absorbing new upstream versions

```text
fetch upstream
→ select pinned upstream commit (record SHA + version tag if any)
→ create integration/upstream-<ver>-<date> from appsolino/main
→ merge --no-ff upstream pin (or rebase Appsolino commits onto pin — choose one policy and stick to it)
→ generate change + conflict report (file list, migration delta, test delta)
→ resolve by subsystem (engine, core/schema, dashboard, plugins, host docs)
→ run upstream test:gate / test:full as applicable
→ run Appsolino reliability suite (contamination, disposition, schema gate, packaged smoke)
→ build packaged release
→ stage with isolated database
→ migration + rollback compatibility tests
→ soak-test
→ promote exact immutable artefact to production
→ update divergence register + retire superseded local patches
```

**Policy recommendation:** merge upstream into integration branch (`--no-ff`) for auditability; do not rewrite `upstream/main`.

## 6. Database migrations when both sides add migrations

| Rule | Detail |
| --- | --- |
| Numbering | Never renumber upstream migrations |
| Appsolino migrations | Use reserved high range or clearly named Appsolino suffix **only if upstream cannot accept** — prefer contributing |
| Dual apply order | Upstream numeric order first; Appsolino-only after latest upstream in that absorb |
| Manifest | `migration-set-hash` + `schemaMax` required |
| Conflict | If upstream reuses a number Appsolino invented locally, **Appsolino must rename/rebaseline on integration branch** before release |
| Production | Migrations run only under exclusive lease after pre-backup |

Current fact: `fusion-development` has through `0036_chat_session_tags.sql` while older upstream checkout lags — absorb must reconcile migration sets explicitly.

## 7. Replacing a local patch with an upstream fix

1. On integration branch, identify overlapping behaviour (tests should express the contract).
2. Remove Appsolino duplicate module/hook behind feature flag or delete in same commit that adopts upstream.
3. Keep regression tests green against upstream implementation.
4. Record retirement in divergence register (`expectedRetirementCondition` met).
5. Never leave two gates that can disagree.

## 8. Rejecting or deferring incompatible upstream changes

| Mechanism | Use when |
| --- | --- |
| Pin older upstream SHA | Upstream breaks reliability contract and fix ETA unknown |
| Integration branch parked | Conflicts too large; document blockers |
| Compatibility shim | Temporary; time-boxed with register entry |
| Product veto | Upstream changes require Temporal-like rewrite or remove worktree model Appsolino depends on |

Veto requires entry in `15-open-decisions.md` / risk register — not silent drift.

## 9. Divergence register (initial)

| ID | Path / area | Reason | Upstream link | Retirement condition | Tests | Conflict history |
| --- | --- | --- | --- | --- | --- | --- |
| DIV-001 | `merge-contamination-gate.ts` | Fail-closed foreign commits | n/a (contribute) | Upstream merges equivalent gate | `merge-contamination-gate.test.ts` | N/A yet |
| DIV-002 | `merge-candidate-patch.ts` | Patch-only candidates | n/a | Upstream adopts | `merge-candidate-patch.test.ts` | N/A |
| DIV-003 | `execution-branch.ts` | Execution provenance branches | #2211 #2476 | Upstream provenance reuse | execution-branch tests | Expected high vs worktree-acquisition |
| DIV-004 | `deterministic-block-disposition.ts` | Non-retryable loops | #2480 | Upstream fingerprint budgets | disposition tests | Scheduler hooks |
| DIV-005 | `contaminated-branch-recovery.ts` | Auto reconstruct | n/a | Upstream recovery | recovery tests | Executor |
| DIV-006 | `release-schema-consistency.ts` | Multi-surface identity | schema-applier | Slim core upstream | consistency tests | Host-specific paths |
| DIV-007 | `task-environment-preflight.ts` | Pre-token env | n/a | Upstream preflight | preflight tests | Executor |
| DIV-008 | `central-core.ts` close guard | Packaged CLI close | FUSI-007 | Upstream fix or contribute | `central-core-close`, `build-runtime` | Medium |
| DIV-009 | Host `fusion-update` / wrappers | Ops automation | n/a | Never — stay host-side | ops drills | N/A |
| DIV-010 | Managed-source UI/modules | Appsolino product | PR #5 | Product decision | dashboard tests | Low–medium |
| DIV-011 | Surgical release overlay | Temporary production pin | n/a | Packaged Phase1+2 live | packaged acceptance | Retire |
| DIV-012 | Custom migrations beyond upstream | Schema features | FN-8562 lineage etc. | Contribute or rebase numbers | pg gate | High on absorb |
| DIV-013 | FUS-010 / FUS-029 `autoMerge=false` safety | Appsolino-specific merge safety | ISSUE-RECONCILIATION | Keep Appsolino-specific unless upstream adopts | auto-merge safety tests | Medium (task-merge / retry routes) |
| DIV-014 | `appsolino_0001_runtime_marker_grants.sql` | Runtime privilege grants | n/a | Keep; never renumber into upstream sequence | pg gate | Medium |
| DIV-015 | `managed-source.ts` + update UI | Host-controlled releases vs npm auto-update | orthogonal to upstream `autoUpdateAndRestart` | Keep Appsolino-specific | dashboard/managed-source tests | Medium |
| DIV-016 | Ghost-bug archival / triage-preflight | Appsolino PR #1 lineage | unknown upstream parity | Verify on absorb; keep until proven | triage tests | Medium (`project-engine` / triage) |

### Three source layers (must not be conflated)

| Layer | Contents |
| --- | --- |
| (a) Mirrored `main` | Exact upstream (`b85a5d453…` observed 2026-07-29) |
| (b) `appsolino/stable` | Durable fork deltas: managed-source, FUS-010/029, `appsolino_0001`, ghost-bug, auth/CI/ops docs (~90 commits behind upstream tip on local compare) |
| (c) Surgical / `fusion-development` | CONTAM Phase 1–3 modules + release-schema gate — **not** on upstream or `appsolino/stable` tips |

Upstream `recovery/foreign-only-contamination.ts` is **not** equivalent to Appsolino fail-closed path-set / patch-candidate gates.

Maintain this table in-repo under `docs/appsolino/divergence-register.md` once implementation starts (not created in this planning-only pass beyond this section).

## 10. GitHub protection and push policy

- Active source + release branches pushed to GitHub (accepted).
- Require PR + green Appsolino reliability checks for `appsolino/main`.
- Release tags immutable; artefacts hashed in manifest.
- Mirror job may update `upstream/main` only via FF from Runfusion.
