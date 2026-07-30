# Appsolino Fusion Server Master Plan — Executive Summary

Last updated: 2026-07-30
**Process authority:** `docs/appsolino/OPERATING-MODEL.md`
**Architecture / v1 completion:** this master-plan set

Status:
```text
Phase 0: COMPLETE
Phase 1: COMPLETE (0.74.0-beta.5)
Phase 2A: PARTIAL / MERGED / USABLE
V1A: COMPLETE (PR #11 → 45ab25100…)
V1A.1: FAIL (Host D stability — see V1A-DEV-STABILITY.md)
V1B: DEFERRED BY OWNER
Host D: development / build / staging ONLY — production prohibited
Host P: not reserved / not accessed
Former Phases 3–8: Future Improvements (optional)
Legacy production: DEGRADED / FROZEN
```

## Definition of finished

**Finished** = usable Fusion v1 on **Host P**; irreplaceable data backed up and restore-proven; rebuildable from Git; normal development continues on **Host D**.

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
9. Labelled **Personal Project v1 complete**.

## Topology (binding)

```text
Host D — Development VPS: source, cache, builds, staging, candidate packages
Host P — Production VPS: no builds; production service/DB/state/releases/backups
```

Host D must **not** create production service, production DB, or production state paths.
Host P executable SHA-256 must match the Host D candidate.

## Six hard controls

Known package/version · separate production DB/state on Host P · previous release preserved · backup before risky changes · restore proof · infra/recovery in Git. Secrets outside Git; production credentials only on Host P.

## Accepted baseline

```text
Upstream: b85a5d4531df8fa749d77bf85ea4ab9ab960ce86
Product:  82feb14b732dcd31176338d024b09e68c1646808
Version:  0.74.0-beta.5
Phase 1:  PR #9 → 4c9e98cd…
Phase 2A: PR #10 → 6caca1ec…
```

## Active work

1. **V1A** — COMPLETE. Candidate `v1a-0.74.0-beta.5-f54d53082` frozen on Host D.
2. **V1A.1** — FAIL. Real Fusion path proven; execute/mock step defect and install runtime-bit defect block development-ready. See `docs/appsolino/v1/V1A-DEV-STABILITY.md`.
3. **V1B** — DEFERRED BY OWNER. Do not reserve or access Host P until Host D is reliable and the owner explicitly authorises production.

Do not rebuild the candidate unless a corrected package is intentionally cut after defect fixes.

## What is not a v1 blocker

Managed external PostgreSQL · larger dedicated sizing · automated release controller · reliability re-lands · full observability · seven-day soak · provider failover · multi-agent scaling · autonomous host-admin · upstream sync during launch.

## Legacy production freeze

DB **0036** / surgical binary **0035**: degraded and frozen. Do not migrate old damaged data into v1.

## Governing documents

- Process: `docs/appsolino/OPERATING-MODEL.md`
- Summary: `MASTER-PLAN.md`
- Roadmap: `13-phased-implementation-roadmap.md`
- Decisions: `15-open-decisions.md`
