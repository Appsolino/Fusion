# Appsolino Fusion Server — MASTER PLAN (Governing Document)

**Status:** Phase 0 decisions **APPROVED** (2026-07-29) — see `15-open-decisions.md`.
**Implementation:** Phase 1 clean-baseline work authorised **only after** that approval record is committed and reviewed. No production activation. No Appsolino reliability re-land until Phase 1 exit gate.
**Date:** 2026-07-29
**Reliability contract:** Every task either completes successfully or reaches one durable, actionable terminal state without losing completed work, duplicating execution, corrupting another task, merging unrelated changes, or repeating the same deterministic failure indefinitely.

This document consolidates `docs/appsolino/master-plan/00`–`15`. Detailed evidence and matrices live in those files; this file is the governing summary.

---

## 1. Purpose

Rebuild Appsolino Fusion from a **clean upstream baseline**, operate it on a **dedicated destroyable server**, and run **immutable packaged releases** with recoverability under a **full-admin trust model** inside the host and **narrow credentials** outside it.

---

## 2. Non-negotiables (accepted)

1. Dedicated Fusion server; no unrelated production apps.
2. Host may be destroyed and rebuilt.
3. `fusion ALL=(ALL) NOPASSWD: ALL` — no interactive sudo blocking.
4. Daily DB backups off-host; append-only / non-deletable by Fusion credentials.
5. Active source and release branches pushed to GitHub.
6. Do not preserve old tasks/worktrees/DB/logs; **do** preserve issue knowledge and regression tests.
7. Production runs clean source-built releases — not permanent surgical overlays.
8. Never install upstream directly into production.
9. Phase 0 decisions recorded in `15-open-decisions.md`; Phase 1 only after that record is committed and reviewed.

---

## 2b. Production posture until replacement (approved)

```text
Database schema: 0036
Production surgical binary: 0035
```

Healthy dashboard ≠ compatible release. Until replacement: **no** new tasks, **no** resume paused tasks, **no** CLI opens against the incompatible DB, **no** migrations, **no** partial activations, **no** trusting the long-lived dashboard as safety proof. Production is **available but degraded and frozen**.

---

## 3. Current verified situation (facts)

- Production healthy on surgical release `contam-gate-surgical-20260728T103231Z` (base `fc485b05…`), Phase 1 contamination gate live.
- Production DB is **embedded Postgres** under production HOME (not system PostgreSQL).
- Release-controller `status.json` disagrees (`deployedSha=7ad5a33…`, `FAILED_NEEDS_OPERATOR`).
- Runtime identity report: DB schema **0036** vs surgical binary **0035** — CLI opens fail; long-lived dashboard may still serve.
- Three source layers: mirrored `main`, `appsolino/stable` durable patches, surgical/`fusion-development` hardening (CONTAM modules not on stable tip).
- Phase 2 / recovery / disposition / schema-consistency / Retry lock: **source-only** in `fusion-development` (often uncommitted).
- FUSI-007 packaged fix on contaminated branch `4553fd05…`.
- Upstream issues highly overlapping: #2476 stale bases, #1399 event wakeups, #2211 worktrees, #2181 budgets.
- Current machine ~6 vCPU / 11 GiB / 96 GB — not a Tier 2 multi-agent+build host. Staging unit crash-loops (`CHDIR`); weekly DR drill failing on ownership.

Evidence: `docs/appsolino/reset/*`, runtime identity report under `fusion-reliability-hardening`.

---

## 4. Target architecture

| Layer | Choice |
| --- | --- |
| OS | Ubuntu 24.04 LTS |
| Service | systemd Fusion user service |
| Task isolation | bubblewrap |
| DB (prod) | **Managed external PostgreSQL** (approved); separate staging DB same major/class |
| Topology | **Host B** (16 vCPU / 64 GB / 500 GB) build+staging; **Host P** (8–16 vCPU / 32–64 GB / 500 GB) production |
| Releases | `/opt/appsolino-fusion/releases/<id>` + `current`; manifest authoritative |
| State | `/srv/appsolino-fusion/...` |
| Fork | `upstream/main` mirror → `appsolino/main` (clean; not dirty trees) → integration → `release/*` |
| Orchestration | Harden native coordinator (not Temporal/Restate in Phases 0–7) |
| Observability | OTel + Prometheus + Grafana + Loki + Sentry |
| Providers | Keep plugins; wrap gateway in Phase 7 |
| Prod activate | Human confirmation required initially (OD-ACTIVATION) |

---

## 5. Reliability architecture (target)

One workflow coordinator; disposable workers; durable execution records (`taskId`+`executionId`+generation); fenced stage leases; immutable checkpoints; task-owned patches; replayable verification manifests; typed bounded recovery; atomic releases.

Git truth: **recorded base + task-owned patch**. Branch format: `fusion/<task-id>/<execution-id>`. No AI review/merge tokens before deterministic Git preflight.

Retries require budget, fingerprint, generation, changed condition, backoff, terminal disposition.

---

## 6. Release law

```text
pin → test → package → packaged-runtime proof → stage → migrate test → approve
→ pause claims → pre-backup → migrate under lease → atomic activate → readiness → resume
```

Readiness fails on schema/identity/manifest disagreement. Rollback only to schema-compatible artefacts.

---

## 7. Fork law

```text
upstream/main (mirror)
appsolino/main (product)
integration/upstream-<ver>-<date>
release/<appsolino-version>
hotfix/<issue>
```

Absorb via integration branches; never renumber upstream migrations; retire local patches when upstream supersedes; protect main/release from force-push.

---

## 8. Full-admin vs external boundary

Inside host: agents may install packages, manage systemd, firewall, Docker/bwrap, repairs, staging activates.
Production activate/migrate: automated gates; human confirm until `OD-ACTIVATE-AUTH` says otherwise.
Outside: no unrelated servers/repos/cloud/registrar/DBs; backups not deletable by Fusion creds.

---

## 9. Issue programme (condensed)

Must permanently control: EROFS/writable paths; ownership; pnpm stores; preflight; no prod builds; identity authorities; schema gates; packaged runtime proof; surgical retirement; contamination; attribution sets; patch-only merge; execution branches; stale bases; lifecycle authority; deterministic disposition; Retry lock; merge leases; verification manifests; provider failover; ops view + alerts; backup restore drills.

Full register: `03-appsolino-known-issues-and-fixes.md`.

---

## 10. Phases and gates

| Phase | Gate |
| --- | --- |
| 0 Decisions | `OD-*` approved |
| 1 Clean baseline | Packaged smoke on pin |
| 2 Infra | Rebuild + backup dry-run |
| 3 Release integrity | ACC-REL 100% |
| 4 Git safety | ACC-GIT 100%; surgical retired |
| 5 Workflow | ACC-EXE/REC; soak |
| 6 Verification | ACC-VER |
| 7 Providers/ops | ACC-PRV/OPS |
| 8 Scale | Tier concurrency report |

Stop if packaged runtime red, or if an external workflow engine is selected mid-flight, or if upstream coordinator rewrite invalidates lease work.

---

## 11. Acceptance

Catalogue in `12-reliability-acceptance-and-chaos-tests.md`. P0 classes must be green before production promote of the clean baseline.

---

## 12. Phase 0 decisions (APPROVED)

See `15-open-decisions.md` Phase 0 Decision Approval (2026-07-29). Exact baseline SHA is deferred to Phase 1 packaged-smoke evaluation. Dirty trees are reference-only. Release controller frozen. Managed Postgres. Human confirm for prod activate/migrate.

---

## 13. Explicit non-claims

- Not zero failures.
- Sizing is Appsolino ops guidance, not Fusion official requirements.
- Source tests ≠ packaged proof.
- Focused unit tests ≠ production soak.

---

## 14. Document index

| Doc | Content |
| --- | --- |
| `00-executive-summary.md` | Target, decisions, risks |
| `01-strategic-questions-and-decisions.md` | Q&A matrix |
| `02-upstream-issue-and-roadmap-audit.md` | Upstream overlap |
| `03-appsolino-known-issues-and-fixes.md` | Issue taxonomy |
| `04-fork-and-upstream-update-strategy.md` | Fork/absorb |
| `05-server-architecture-and-specifications.md` | Topology/sizing/FS |
| `06-provisioning-permissions-and-runtime.md` | Ansible/sudo/systemd |
| `07-backup-disaster-recovery-and-rebuild.md` | DR |
| `08-component-keep-wrap-replace-matrix.md` | Tool decisions |
| `09-target-reliability-architecture.md` | Lifecycle/Git/verify |
| `10-release-build-migration-and-deployment.md` | Release law |
| `11-observability-and-operations.md` | Metrics/alerts |
| `12-reliability-acceptance-and-chaos-tests.md` | ACC catalogue |
| `13-phased-implementation-roadmap.md` | Phases |
| `14-risk-register.md` | Risks |
| `15-open-decisions.md` | User approvals |
| `MASTER-PLAN.md` | This governing summary |

---

## 15. Planning integrity statement

This master plan was produced **read-only** with respect to Fusion runtime: no build, deployment, migration, service restart, task-state change, or production modification was performed as part of authoring these documents. Documentation files under `docs/appsolino/master-plan/` were created only.
