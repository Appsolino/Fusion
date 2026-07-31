# Open Decisions — Approval Record

Last updated: 2026-07-31
**Process authority:** `docs/appsolino/OPERATING-MODEL.md`

Status:
```text
Phase 0: APPROVED (historical)
Phase 1: COMPLETE
Phase 2A: PARTIAL / MERGED / USABLE
V1A: COMPLETE (PR #11 → 45ab25100…)
V1A.1: FAIL (historical Host D stability)
V1A.2: PASS WITH OBSERVATIONS (v1a2-0.74.0-beta.5-3bc46bffe)
V1A.3: BLOCKED — non-production provider credential required
a.anas.bz: ACTIVE / AUTHENTICATED
Automated upstream integration: REQUIRED / NOT IMPLEMENTED
Automated Host D release: REQUIRED / NOT IMPLEMENTED
V1B: DEFERRED BY OWNER
Host D production: PROHIBITED
Host P: not reserved / not accessed
Former Phases 3–8 (except required Host D AUTO-D): Future Improvements
Legacy production: DEGRADED / FROZEN
```

---

# Automation-first Host D amendment (2026-07-31) — BINDING

This amendment restores the original fork absorb intent and corrects the 2026-07-30 Personal Project v1 scope reduction that made upstream sync “manual / monthly” and parked release automation as Future Improvements.

## OD-AUTO-PRINCIPLE
**Approved:** Automate routine development completely. Require human approval only when automation detects high risk, or before production activation.

```text
Host D automatic development deployment: YES
Host P automatic production deployment: NO
Production activation: explicit owner approval
```

## OD-AUTO-UPSTREAM
**Approved target architecture:**

```text
Runfusion/Fusion:main
  → scheduled detection
  → automation/upstream-* (git merge --no-ff)
  → risk classification + Correction A/B contract tests
  → sync PR (safe auto-merge | sensitive → one owner approval)
  → Appsolino main
  → automated immutable Host D release → a.anas.bz (rollback on failure)
```

**Rejected as the permanent model:** operator-driven weekly/monthly merge as the only absorb path; permanent exact-tip `upstream-shadow` branch as the absorb process.

**Implementation status:** REQUIRED / NOT IMPLEMENTED (documentation aligned first).

## OD-AUTO-RISK
**Approved:** Automation classifies changes. Safe changes auto-merge when checks pass. Sensitive changes (engine, providers, scheduler/executor, migrations, lockfiles, deploy scripts, workflows, auth, database) still get automated merge/test/build/staging validation; the owner only approves or rejects the result.

## OD-AUTO-CORRECTIONS
**Approved hard stops:** Correction A (packaged execute bits / immutable non-writable) and Correction B (mock zero-based steps / deterministic park / no redispatch loop) must have contract tests. Failure blocks the sync PR automatically.

## OD-AUTO-SECRETS
**Approved:** Do not add PAT / OAuth / deploy-key / GitHub App tokens to workflows to force-push upstream history that modifies `.github/workflows/*`. Do not import upstream workflow files wholesale. Do not place production secrets on Host D.

## OD-AUTO-SCOPE-VS-V1
**Approved:** The 2026-07-30 OD-V1-SCOPE exclusion of “upstream sync” and product-workflow expansion as *launch* work remains valid for **Host P / V1B**. It does **not** permanently forbid implementing Host D AUTO-D. AUTO-D is required for sustainable development on Host D and is authorised as engineering work **without** starting V1B or accessing Host P.

---

# Personal Project v1 amendment (2026-07-30) — BINDING FOR HOST P LAUNCH

This amendment redefines finished and the launch topology. Where earlier text allowed Host D to host production, **this correction wins**. Where this amendment conflicted with automated Host D absorb/release, **OD-AUTO-*** (2026-07-31) wins for Host D development.

## OD-V1-FINISHED
**Finished** means: accepted package built and validated on Host D; exact artifact deployed on Host P; fresh isolated production database on Host P; basic task create/read/update works; backup and restore proven; rebuild instructions in Git; no old data migration; Host D development uses automated absorb/release.

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

1. **V1A family** — Build/validate candidate on Host D; V1A.2 pass; V1A.3 real-provider proof when credentials exist.
2. **AUTO-D** — Automated upstream integration + automated Host D release (required; not Host P).
3. **V1B** — Transfer exact artifact to Host P; install; smoke; backup/restore; declare v1 complete.

V1B does not start until the owner explicitly authorises Host P work.

## OD-V1-POSTGRES
**Approved for v1 production:** PostgreSQL on **Host P** with isolated `fusion_production` role/database (localhost, SCRAM, secrets outside Git). Staging DB remains on Host D as `fusion_staging` only. Managed external PostgreSQL is a Future Improvement.

## OD-V1-CONTROLS
Mandatory: known package/version; separate production DB/state on Host P; previous release preserved; backup before risky changes; restore proof; infra/recovery in Git. Secrets outside Git. Legacy degraded production untouched until replacement smoke passes.

## OD-V1-SCOPE (as amended by OD-AUTO-SCOPE-VS-V1)
**Authorised for Host P launch path:** Phase V1A family then V1B only, when owner opens V1B.
**Authorised now on Host D:** AUTO-D implementation; normal feature work; V1A.3 when credentials exist.
**Not authorised:** production on Host D; old data migration; starting V1B / Host P access; Future Improvements as Host P launch blockers.

## OD-V1-VALIDATION
Focused Level C checks per stage in `13-phased-implementation-roadmap.md`. Full ACC catalogues, clean Ubuntu rebuild during launch, seven-day soak, and autonomous host-admin proofs are **not** v1 requirements.

---

# Phase 0 technical review correction (2026-07-29) — historical

1. Full-admin service model: `NoNewPrivileges=no`, `ProtectSystem=off`. Ordinary tasks use bubblewrap; host-admin outside bubblewrap.
2. ACC-ENV-03–08 originally required Fusion service→agent path proofs (engine-child path remains Future / pre-autonomous-admin).
3. Health endpoint OK ≠ schema-compatible; legacy production remains degraded/frozen.
4. Preservation: selective extraction only — no full dirty-tree snapshot requirement (R-15).

**Later:** Phase 1 closed (PR #9). Phase 2A merged PARTIAL (PR #10). Operating model adopted. **Corrected OD-V1-TOPOLOGY and OD-AUTO-* govern active work.**

---

# Phase 0 Decision Approval (2026-07-29) — historical record

Retain for provenance. Where this conflicts with **OD-V1-*** or **OD-AUTO-***, those later amendments win.

## OD-BASELINE
Pinned upstream after packaged-runtime acceptance. Accepted: `0.74.0-beta.5` (`b85a5d453…` + `82feb14b7…`). Ongoing absorb is automated (OD-AUTO-UPSTREAM), not “never update.”

## OD-TOPOLOGY (historical)
Originally large Host B + Host P sizing. **Active launch topology:** Host D = build/staging; Host P = production (see OD-V1-TOPOLOGY).

## OD-IDENTITY
Release identity and PostgreSQL migration history remain authoritative. Keep v1 simple: immutable release dir + symlink + recorded hashes.

## OD-DIRTY-TREES
Dirty trees remain reference-only — not `main`.

## OD-FUSI-007 / OD-PHASE-2 (historical)
Not part of Phase V1 Host P launch. Future Improvements / reliability backlog.

## OD-RELEASE-CONTROLLER
Freeze any legacy production-facing release controller against Host P. **Host D automated release (AUTO-D.2) is authorised and required.** Production activation remains explicit human confirmation (OD-ACTIVATION).

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
V1A: COMPLETE — historical candidate frozen
V1A.2: PASS WITH OBSERVATIONS — corrected Host D candidate active
V1A.3: BLOCKED — provision non-production provider credential, then re-run
AUTO-D: AUTHORISED / REQUIRED / NOT IMPLEMENTED — docs aligned; implement next
V1B: DEFERRED BY OWNER — do not reserve, provision, or access Host P
Not authorised: production identities on Host D
Not authorised: automatic start of V1B
Not authorised: PAT bypass for upstream workflow-file tip mirrors
```
