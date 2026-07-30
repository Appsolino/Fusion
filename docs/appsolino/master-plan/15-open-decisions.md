# Open Decisions — Approval Record

Last updated: 2026-07-30
**Process authority:** `docs/appsolino/OPERATING-MODEL.md`

Status:
```text
Phase 0: APPROVED (historical)
Phase 1: COMPLETE
Phase 2A: PARTIAL / MERGED / USABLE
Active: Phase V1A then V1B (NOT STARTED)
Host D production: PROHIBITED
Host P production: PLANNED
Former Phases 3–8: Future Improvements
Legacy production: DEGRADED / FROZEN
```

---

# Personal Project v1 amendment (2026-07-30) — BINDING FOR ACTIVE WORK

This amendment redefines finished and the launch topology. Where earlier text allowed Host D to host production, **this correction wins**.

## OD-V1-FINISHED
**Finished** means: accepted package built and validated on Host D; exact artifact deployed on Host P; fresh isolated production database on Host P; basic task create/read/update works; backup and restore proven; rebuild instructions in Git; no old data migration.

It does **not** mean the former multi-phase reliability programme is complete.

## OD-V1-TOPOLOGY (corrected)
**Approved:**

```text
Host D — development / build / staging only
Host P — production only
```

Host D **must not** host `fusion-production.service`, `fusion_production` database/role, or `/etc|srv|opt/appsolino-fusion/production/` paths.

Host P holds production identities only:

```text
fusion-production.service
fusion_production (role + database)
/etc/appsolino-fusion/production/
/srv/appsolino-fusion/production/
/opt/appsolino-fusion/production/releases/
```

Host P performs **no** source builds. Executable SHA-256 on Host P must match the Host D candidate. Production credentials and data exist only on Host P.

**Supersedes:** any earlier OD-V1 wording that Host D may run initial production.

## OD-V1-STAGES
**Approved ordered stages:**

1. **V1A** — Build and validate production candidate on Host D; freeze release identity.
2. **V1B** — Transfer exact artifact to Host P; install; smoke; backup/restore; declare v1 complete.

V1B does not start until V1A passes. One-day end-to-end completion requires Host P already accessible.

## OD-V1-POSTGRES
**Approved for v1 production:** PostgreSQL on **Host P** with isolated `fusion_production` role/database (localhost, SCRAM, secrets outside Git). Staging DB remains on Host D as `fusion_staging` only. Managed external PostgreSQL is a Future Improvement.

## OD-V1-CONTROLS
Mandatory: known package/version; separate production DB/state on Host P; previous release preserved; backup before risky changes; restore proof; infra/recovery in Git. Secrets outside Git. Legacy degraded production untouched until replacement smoke passes.

## OD-V1-SCOPE
**Authorised:** Phase V1A then V1B only.
**Not authorised as v1 work:** production on Host D; product behaviour changes; upstream sync; old data migration; Future Improvements as launch blockers; starting implementation from a docs-only commit.

## OD-V1-VALIDATION
Focused Level C checks per stage in `13-phased-implementation-roadmap.md`. Full ACC catalogues, clean Ubuntu rebuild during launch, seven-day soak, and autonomous host-admin proofs are **not** v1 requirements.

---

# Phase 0 technical review correction (2026-07-29) — historical

1. Full-admin service model: `NoNewPrivileges=no`, `ProtectSystem=off`. Ordinary tasks use bubblewrap; host-admin outside bubblewrap.
2. ACC-ENV-03–08 originally required Fusion service→agent path proofs (engine-child path remains Future / pre-autonomous-admin).
3. Health endpoint OK ≠ schema-compatible; legacy production remains degraded/frozen.
4. Preservation: selective extraction only — no full dirty-tree snapshot requirement (R-15).

**Later:** Phase 1 closed (PR #9). Phase 2A merged PARTIAL (PR #10). Operating model adopted. **Corrected OD-V1-TOPOLOGY above governs active work.**

---

# Phase 0 Decision Approval (2026-07-29) — historical record

Retain for provenance. Where this conflicts with **OD-V1-***, the v1 amendment (as corrected) wins for launch.

## OD-BASELINE
Pinned upstream after packaged-runtime acceptance. Accepted: `0.74.0-beta.5` (`b85a5d453…` + `82feb14b7…`).

## OD-TOPOLOGY (historical)
Originally large Host B + Host P sizing. **Active launch topology:** Host D = build/staging; Host P = production (see OD-V1-TOPOLOGY).

## OD-IDENTITY
Release identity and PostgreSQL migration history remain authoritative. Keep v1 simple: immutable release dir + symlink + recorded hashes.

## OD-DIRTY-TREES
Dirty trees remain reference-only — not `appsolino/main`.

## OD-FUSI-007 / OD-PHASE-2 (historical)
Not part of Phase V1. Future Improvements.

## OD-RELEASE-CONTROLLER
Freeze existing release controller. Do not resume against production. V1 uses build-once on Host D and install-exact on Host P.

## OD-POSTGRES (historical)
Managed external PostgreSQL was Phase 0 target. **V1 production DB is on Host P locally** (OD-V1-POSTGRES). Managed external remains Future Improvement.

## OD-ACTIVATION
Production activation requires explicit human confirmation. Unchanged.

---

## Production posture until replacement (mandatory)

```text
Legacy DB schema: 0036
Legacy surgical binary ceiling: 0035
```

Degraded and frozen. Do not migrate old damaged data into Personal Project v1.

---

## Implementation authorisation (current)

```text
Authorised next: Phase V1A (Host D build/validate) when explicitly started
Then: Phase V1B (Host P deploy) after V1A passes and Host P is ready
Not authorised: production identities on Host D
Not authorised: automatic start of V1A/V1B from this docs commit
```
