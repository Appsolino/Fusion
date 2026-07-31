# Fork and Upstream Update Strategy

Last updated: 2026-07-31

## Governing principle

> Automate routine development completely. Require human approval only when automation detects high risk, or before production activation.

Appsolino **rejects** an unbounded long-lived fork without an upstream absorb process — that causes bitrot. Temporary “manual / approximately monthly” sync (Personal Project v1 staging-repair amendment) is **superseded** for Host D development. The permanent model is automated integration with risk-based approval.

```text
Runfusion/Fusion:main
        │  scheduled detection
        ▼
automation/upstream-* (merge --no-ff)
        │  tests + package + staging candidate
        ▼
Automated sync PR (safe auto-merge | sensitive → one owner approval)
        │
        ▼
Appsolino main → automated immutable Host D release → a.anas.bz
```

Production on Host P remains human-gated. Host P is never part of this automation until V1B is explicitly authorised.

---

## 1. Recommended model: hybrid product fork

| Layer | Purpose |
| --- | --- |
| **Upstream remote** | Exact `Runfusion/Fusion` history (fetched in automation; no permanent Appsolino mirror branch required) |
| **Appsolino product fork (`main`)** | Reliability, release identity, host contracts, selected UX, Corrections A/B |
| **Plugins** | Provider/runtime extras and Appsolino-only integrations |
| **Host automation** | Provisioning, backups, Host D release activation — outside the Node package when possible |

**Not chosen as sole strategy:**
- Minimal patch fork alone — Appsolino reliability surface is too large.
- Plugin-only — cannot safely intercept executor/merger/scheduler hotspots via plugins alone.
- Unbounded long-lived fork without upstream absorb — bitrot.
- Permanent exact-tip `upstream-shadow` branch — unnecessary; Actions cannot push upstream history that modifies `.github/workflows/*` with the default token, and a mirror branch is not an absorb process.

## 2. Branch model

```text
main
    Approved Appsolino development source.

automation/upstream-sync
    Durable single active integration branch (preferred),
    OR dated automation/upstream-YYYY-MM-DD-<sha> created automatically.
    Only one upstream synchronization workflow may run at a time.

feature / fix / docs / ops branches
    Normal Appsolino changes (worktrees; primary checkout stays on main).

tags / immutable release IDs
    Tested packages (Host D development releases and production candidates).
```

**Not required as permanent lines** unless implementation proves a specific need:

```text
upstream-shadow
appsolino/stable
release/*
```

Protected: `main` — no force-push. Automation may update only its `automation/upstream-*` branch and open/update one sync PR.

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
- Corrections A/B packaging and mock/executor parks (until upstream adopts)

### Hybrid

- `release-schema-consistency`: slim portable core upstream; Appsolino wires host paths/manifest fields

## 4. Hotspots for recurring merge conflicts

1. `packages/engine/src/{executor,scheduler,self-healing,worktree-acquisition,merger-ai,project-engine}.ts`
2. `packages/core/src/postgres/schema-applier.ts` + migrations
3. `packages/core/src/central-core.ts`
4. Dashboard task workflow / retry routes
5. Sandbox backends
6. `.github/workflows` (never import upstream workflow files into Appsolino automation blindly)

**Mitigation:** keep Appsolino changes in **new modules** + thin call-site hooks; avoid editing 20k-line files when a helper module works.

## 5. Automated absorb process (target)

```text
detect new Runfusion/Fusion main tip (every 6–24h)
→ if unchanged: report and stop
→ open/update single automation/upstream-* branch from Appsolino main
→ git merge --no-ff upstream/main   (do not rebase Appsolino history)
→ classify risk (safe vs sensitive)
→ preserve Appsolino patches; run Correction A/B contract tests
→ if migrations added: disposable staging DB apply + ceiling verify (always sensitive)
→ focused tests + immutable package + temporary staging candidate
→ open/update one synchronization PR with full report
→ safe + green → auto-merge
→ sensitive → wait for one owner approval (automation already did the work)
→ on merge to main: automated Host D build/install beside previous release
→ health / migration / smoke; rollback automatically on failure
```

**Policy:** merge upstream into the integration branch (`--no-ff`) for auditability. Do not rewrite remote upstream history. Do not add a PAT/OAuth/deploy-key/App token solely to force-push exact upstream tips that contain workflow-file changes.

### Risk classification

| Class | Examples | Behaviour |
| --- | --- | --- |
| **Safe** | docs, tests only, harmless UI text, non-runtime assets | focused checks → auto-merge PR → auto Host D release |
| **Sensitive** | `packages/engine`, provider resolution, scheduler/executor, migrations, lockfile/`package.json`, deployment scripts, `.github/workflows`, auth, database code | automation still merges/tests/builds/validates → PR waits for one owner approval |

### Appsolino correction preservation (hard stop)

Automation must fail the sync PR closed when these contract tests fail:

**Correction A:** packaged executable permissions preserved; `initdb`/`postgres` executable; immutable release remains non-writable.

**Correction B:** mock steps remain zero-based; deterministic execute failures park; no todo/in-progress redispatch loop; transient retry behaviour remains intact.

### Failure reporting (required fields)

```text
source SHA · upstream SHA · risk classification · files changed
tests run · tests skipped · build result · release ID
staging result · rollback result · duration · blocking reason
```

A failed sync remains on its PR/integration branch. It must not repeatedly create duplicate PRs or loop indefinitely.

### Timing expectations (once operational)

| Event | Expected automation time |
| --- | ---: |
| Detect upstream change | Within 6–24 hours |
| Small upstream synchronization | 15–45 minutes |
| Runtime or migration synchronization | 30–90 minutes |
| Build and update Host D | 20–45 minutes |
| Safe change to updated `a.anas.bz` | Usually 30–90 minutes |
| Sensitive change | Same automated work, then waits for owner approval |

Large backlogs (hundreds of commits behind) are one-time convergence jobs: automation performs most work; engine/migration deltas likely classify as sensitive → one owner review, not hours of manual commands.

## 6. Database migrations when both sides add migrations

| Rule | Detail |
| --- | --- |
| Numbering | Never renumber upstream migrations |
| Appsolino migrations | Prefer contributing; local Appsolino-only after latest upstream in that absorb |
| Dual apply order | Upstream numeric order first |
| Manifest | `migration-set-hash` + `schemaMax` required |
| Conflict | If upstream reuses a number Appsolino invented locally, **Appsolino must rename/rebaseline on integration branch** before release |
| Automation | New migration → disposable staging DB apply → restart → verify ceiling → **always sensitive** |
| Production | Migrations run only under exclusive lease after pre-backup (Host P; human-gated) |

## 7. Replacing a local patch with an upstream fix

1. On integration branch, identify overlapping behaviour (tests should express the contract).
2. Remove Appsolino duplicate module/hook behind feature flag or delete in same commit that adopts upstream.
3. Keep regression tests green against upstream implementation.
4. Record retirement in divergence register.
5. Never leave two gates that can disagree.

## 8. Rejecting or deferring incompatible upstream changes

| Mechanism | Use when |
| --- | --- |
| Pin older upstream SHA | Upstream breaks reliability contract and fix ETA unknown |
| Integration branch parked | Conflicts too large; document blockers in the sync PR |
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
| DIV-017 | Correction A install execute bits | Packaged runtime binaries must stay executable | n/a | Upstream packaging parity or keep Appsolino install script | Host D install checks | High on absorb |
| DIV-018 | Correction B mock step indexes / park | Zero-based steps; deterministic failure park | n/a | Upstream adopts | executor/mock unit tests | High on absorb |

### Three source layers (must not be conflated)

| Layer | Contents |
| --- | --- |
| (a) Upstream tip | Exact Runfusion/Fusion `main` (fetched; not force-mirrored onto Appsolino) |
| (b) Appsolino `main` | Durable fork deltas + Corrections A/B + ops docs |
| (c) Surgical / legacy production overlay | Historical CONTAM / surgical pins — **not** the Host D development line |

Maintain this table in-repo under `docs/appsolino/divergence-register.md` once the absorb automation lands (this section remains the planning source until then).

## 10. GitHub protection and push policy

- Active source pushed to GitHub (accepted).
- Require PR + green checks for `main` (safe upstream sync PRs may auto-merge when classification and gates allow).
- Release tags / release IDs immutable; artefacts hashed in manifest.
- Do **not** embed long-lived PATs in workflows to bypass Actions restrictions on pushing foreign `.github/workflows` history.
- Host D release automation uses Host D runners/secrets for install only — never Host P production secrets on Host D.
