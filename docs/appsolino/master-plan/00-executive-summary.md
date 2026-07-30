# Appsolino Fusion Server Master Plan — Executive Summary

Last updated: 2026-07-30
**Process authority:** `docs/appsolino/OPERATING-MODEL.md`
**Architecture / v1 completion:** this master-plan set

Status:
```text
Phase 0: COMPLETE
Phase 1: COMPLETE (0.74.0-beta.5)
Phase 2A: PARTIAL / MERGED / USABLE
Active: Phase V1A then V1B (NOT STARTED)
Host D: development / build / staging ONLY — production prohibited
Host P: production VPS (planned)
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

1. **V1A** — build and validate production candidate on Host D (next).
2. **V1B** — deploy that exact artifact to Host P (after V1A).

Focused Level C checks only. One-day clock requires Host P already accessible.

## What is not a v1 blocker

Managed external PostgreSQL · larger dedicated sizing · automated release controller · reliability re-lands · full observability · seven-day soak · provider failover · multi-agent scaling · autonomous host-admin · upstream sync during launch.

## Legacy production freeze

DB **0036** / surgical binary **0035**: degraded and frozen. Do not migrate old damaged data into v1.

## Governing documents

- Process: `docs/appsolino/OPERATING-MODEL.md`
- Summary: `MASTER-PLAN.md`
- Roadmap: `13-phased-implementation-roadmap.md`
- Decisions: `15-open-decisions.md`
