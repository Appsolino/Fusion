# Open Decisions — Approval Record

Last updated: 2026-07-30  
**Process authority:** `docs/appsolino/OPERATING-MODEL.md`

Status:
```text
Phase 0: APPROVED (historical)
Phase 1: COMPLETE
Phase 2A: PARTIAL / MERGED / USABLE
Active authorisation: Phase V1 — One-day production launch
Former Phases 3–8: Future Improvements (not authorised as v1 blockers)
Legacy production: DEGRADED / FROZEN
```

---

# Personal Project v1 amendment (2026-07-30) — BINDING FOR ACTIVE WORK

This amendment **redefines finished** and **supersedes**, for Personal Project v1 launch only, earlier Phase 0 choices that made dedicated Host P, managed external PostgreSQL, full observability, seven-day soak, and Phases 3–8 into launch prerequisites.

## OD-V1-FINISHED
**Finished** means: accepted package deployed; fresh isolated production database; basic task create/read/update works; backup and restore proven; rebuild instructions in Git; no old data migration.

It does **not** mean the former multi-phase reliability programme is complete.

## OD-V1-TOPOLOGY
**Approved for v1:** Host D may run build, staging, and **initial production** with separate production identities:

```text
Service:       fusion-production.service
Database/role: fusion_production
Config:        /etc/appsolino-fusion/production/
State:         /srv/appsolino-fusion/production/
Releases:      /opt/appsolino-fusion/production/releases/
```

Dedicated Host P remains an optional Future Improvement. If a separate production host is already ready, the same process may be used there. Procuring a new host during the one-day window is avoidable risk.

**Supersedes for v1 launch:** OD-TOPOLOGY requirement that Host P exist before production.

## OD-V1-POSTGRES
**Approved for v1:** Local PostgreSQL on the launch host with isolated `fusion_production` role/database (localhost, SCRAM, secrets outside Git). Managed external PostgreSQL is a Future Improvement.

**Supersedes for v1 launch:** OD-POSTGRES as a launch blocker.

## OD-V1-CONTROLS
Mandatory for v1: known package/version; separate production DB/state; previous release preserved; backup before risky changes; restore proof; infra/recovery in Git. Secrets outside Git. Legacy degraded production untouched until replacement smoke passes.

## OD-V1-SCOPE
**Authorised:** Phase V1 one-day production launch only (see `13-phased-implementation-roadmap.md`).  
**Not authorised as v1 work:** product behaviour changes; upstream sync; old data migration; Future Improvements backlog items; expanding into ACC/soak/observability programmes.

## OD-V1-VALIDATION
Phase V1 uses focused Level C production-candidate checks listed in the roadmap. Full ACC catalogues, clean Ubuntu rebuild during launch, seven-day soak, and autonomous host-admin proofs are **not** v1 requirements.

---

# Phase 0 technical review correction (2026-07-29) — historical

Review of `fb284e9de…` / clean re-land on `origin/main` ancestry requested changes. Corrections applied on branch `docs/phase-0-governance-v2`:

1. Full-admin service model: `NoNewPrivileges=no`, `ProtectSystem=off`. Ordinary tasks use bubblewrap; host-admin mode outside bubblewrap.  
2. ACC-ENV-03–08 originally required Fusion service→agent path proofs (engine-child path remains a Future / pre-autonomous-admin gate).  
3. Health endpoint OK ≠ schema-compatible; legacy production remains degraded/frozen.  
4. Preservation: selective extraction only — no full dirty-tree snapshot requirement (R-15).

**Later:** Phase 1 closed (PR #9 / `4c9e98cd…`). Phase 2A merged PARTIAL (PR #10 / `6caca1ec…`). Operating model adopted. **v1 amendment above now governs active completion work.**

---

# Phase 0 Decision Approval (2026-07-29) — historical record

Date: 2026-07-29  
Retain for provenance. Where this conflicts with **OD-V1-***, the v1 amendment wins for launch.

## OD-BASELINE
Pinned upstream after packaged-runtime acceptance. Phase 1 accepted: `b85a5d453…` + `a366fab379…` / product `82feb14b7…`, version `0.74.0-beta.5`. Do not treat moving `upstream/main` as the baseline.

## OD-TOPOLOGY (historical)
Originally: Host B (build+staging) + Host P (production), large sizing. **For v1 launch, see OD-V1-TOPOLOGY.**

## OD-IDENTITY
Release identity and PostgreSQL migration history remain authoritative for what is running. Keep identities simple for v1 (immutable release dir + symlink + recorded hashes); full manifest/controller frameworks are Future Improvements.

## OD-DIRTY-TREES
Dirty trees remain reference-only — not `appsolino/main`.

## OD-FUSI-007 / OD-PHASE-2 (historical)
Re-land from clean baseline / invariants — not contaminated history. **Not part of Phase V1.** Future Improvements.

## OD-RELEASE-CONTROLLER
Freeze existing release controller. Do not resume against production. Full replacement activator is Future Improvements; v1 uses simple immutable install + human-operated start.

## OD-POSTGRES (historical)
Managed external PostgreSQL was the Phase 0 target. **For v1 launch, see OD-V1-POSTGRES.**

## OD-ACTIVATION
Production activation requires explicit human confirmation. Staging may be more autonomous under gates. Unchanged for v1.

---

## Production posture until replacement (mandatory)

```text
Legacy DB schema: 0036
Legacy surgical binary ceiling: 0035
```

Available but **degraded and frozen**. No new/resumed tasks on the incompatible pair; no CLI opens that write against the split; no migrations on the legacy system; no trusting long-lived dashboard health as compatibility proof. **Do not migrate old damaged data into Personal Project v1.**

---

## Implementation authorisation (current)

```text
Authorised: Phase V1 one-day production launch (docs locked; implementation is a separate mission)
Not authorised: automatic start of Phase V1 from this docs commit
Not authorised: Future Improvements as launch blockers
Not authorised: product code / infra code changes in this docs mission
```
