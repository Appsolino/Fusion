> **Status: Historical/reference**
> This document does not override `MASTER-PLAN.md`, `OPERATING-MODEL.md` or `CURRENT-STATE.md`.


**Live status:** [`docs/appsolino/CURRENT-STATE.md`](../CURRENT-STATE.md) — do not treat numbers below as authoritative.

# Appsolino Fusion Server Master Plan — Executive Summary

Last updated: 2026-07-31
**Process authority:** `docs/appsolino/OPERATING-MODEL.md`
**Architecture / v1 completion:** this master-plan set

Status:
```text
Phase 0: COMPLETE
Phase 1: COMPLETE (0.74.0-beta.5)
Phase 2A: PARTIAL / MERGED / USABLE
V1A: COMPLETE (PR #11 → 45ab25100…)
V1A.1: FAIL (historical — see V1A-DEV-STABILITY.md)
V1A.2: PASS WITH OBSERVATIONS (candidate v1a2-0.74.0-beta.5-3bc46bffe)
V1A.3: BLOCKED — non-production provider credential required
a.anas.bz: ACTIVE / AUTHENTICATED
Automated upstream integration: REQUIRED / NOT IMPLEMENTED
Automated Host D release: REQUIRED / NOT IMPLEMENTED
V1B: DEFERRED BY OWNER
Host D: development / build / staging ONLY — production prohibited
Host P: not reserved / not accessed
Former Phases 3–8 (except required Host D automation): Future Improvements
Legacy production: DEGRADED / FROZEN
```

## Governing principle

> Automate routine development completely. Require human approval only when automation detects high risk, or before production activation.

```text
Host D automatic development deployment: YES (required; not yet implemented)
Host P automatic production deployment: NO
Production activation: explicit owner approval
```

## Definition of finished

**Finished** = usable Fusion v1 on **Host P**; irreplaceable data backed up and restore-proven; rebuildable from Git; normal development continues on **Host D** with automated upstream absorb and automated immutable Host D releases.

**Not finished-by** = every future reliability, scaling, observability, or autonomous-agent feature.

## Personal Project v1 — done when

1. Package `0.74.0-beta.5` built **once on Host D**, validated on staging, frozen (version + SHA-256).
2. Exact same artefact transferred to Host P (hash match; **no rebuild** on Host P).
3. Fresh production database on Host P only (no old data migration).
4. Production service/state/config/DB identities **only on Host P**.
5. Start/restart + expected version; create/read/update one task on Host P.
6. Production backup + temporary restore proof on Host P.
7. Source, infra, and recovery instructions in GitHub.
8. Legacy degraded production untouched until replacement works.
9. Host D uses automated upstream integration + automated staging release path.
10. Labelled **Personal Project v1 complete**.

## Topology (binding)

```text
Host D — Development VPS: source, cache, builds, staging, automated immutable releases, candidate packages
Host P — Production VPS: no builds; production service/DB/state/releases/backups
```

Host D must **not** create production service, production DB, or production state paths.
Host P executable SHA-256 must match the Host D candidate.

## Six hard controls

Known package/version · separate production DB/state on Host P · previous release preserved · backup before risky changes · restore proof · infra/recovery in Git. Secrets outside Git; production credentials only on Host P.

## Accepted baseline

```text
Upstream pin: b85a5d4531df8fa749d77bf85ea4ab9ab960ce86
Product:      82feb14b732dcd31176338d024b09e68c1646808
Version:      0.74.0-beta.5
Phase 1:      PR #9 → 4c9e98cd…
Phase 2A:     PR #10 → 6caca1ec…
V1A.2 release: v1a2-0.74.0-beta.5-3bc46bffe
```

## Active work

1. **V1A / V1A.2** — Host D candidate path proven; corrected candidate frozen. See `docs/appsolino/v1/V1A-DEV-STABILITY.md`.
2. **V1A.3** — BLOCKED until a non-production real-provider credential exists on Host D (`testMode`/mock is not valid evidence).
3. **Automated upstream integration + automated Host D release** — **REQUIRED / NOT IMPLEMENTED**. Align docs first; then implement. Do not treat “manual monthly sync” as the permanent model.
4. **V1B** — DEFERRED BY OWNER. Do not reserve or access Host P until Host D automation is in place and the owner explicitly authorises production.

Do not rebuild the V1A.2 candidate unless a demonstrated runtime defect requires a separate correction mission.

## What is not a Host P launch blocker

Managed external PostgreSQL · larger dedicated sizing · full observability · seven-day soak · provider failover · multi-agent scaling · autonomous host-admin. (Automated Host D upstream absorb and Host D release **are** required for normal development; they are not optional Future Improvements.)

## Legacy production freeze

DB **0036** / surgical binary **0035**: degraded and frozen. Do not migrate old damaged data into v1.

## Governing documents

- Process: `docs/appsolino/OPERATING-MODEL.md`
- Summary: `MASTER-PLAN.md`
- Fork/absorb: `04-fork-and-upstream-update-strategy.md`
- Roadmap: `13-phased-implementation-roadmap.md`
- Decisions: `15-open-decisions.md`
- Upstream monitoring: `docs/appsolino/upstream/UPSTREAM-MONITORING.md`
