# Appsolino Fusion Server Master Plan — Executive Summary

Last updated: 2026-07-30
**Process authority:** `docs/appsolino/OPERATING-MODEL.md`
**Architecture / v1 completion:** this master-plan set

Status:
```text
Phase 0: COMPLETE
Phase 1: COMPLETE (0.74.0-beta.5)
Phase 2A: PARTIAL / MERGED / USABLE
Active: Phase V1 — One-day production launch (NOT STARTED)
Former Phases 3–8: Future Improvements (optional)
Legacy production: DEGRADED / FROZEN (untouched until replacement smoke passes)
```

## Definition of finished

**Finished** = usable Appsolino Fusion v1 deployed; irreplaceable data backed up and restore-proven; server rebuildable from Git; normal development can continue.

**Not finished-by** = every future reliability, scaling, observability, or autonomous-agent feature.

## Personal Project v1 — done when

1. Accepted package `0.74.0-beta.5` built once and that exact artefact deployed.
2. Fresh isolated production database (no old Fusion task/DB migration).
3. Separate production service/state/config/DB identities.
4. Start/restart + expected version; create/read/update one task.
5. Backup + temporary restore proof.
6. Source, infra, and recovery instructions in GitHub.
7. Previous degraded production untouched until replacement works.
8. Labelled **Personal Project v1 complete**.

## Initial topology (v1)

One host (Host D initially): build + staging + production with **separate** production identities (`fusion-production.service`, `fusion_production` DB/role, `/etc|srv|opt/.../production/`). GitHub holds source/infra/recovery. Off-host storage holds **production database backups only**.

Dedicated Host P, managed external PostgreSQL, full observability, release controllers, and multi-agent scaling are **Future Improvements** — not v1 blockers.

## Six hard controls

Known package/version · separate production DB/state · previous release preserved · backup before risky changes · restore proof · infra/recovery in Git. Secrets outside Git.

## Accepted baseline

```text
Upstream: b85a5d4531df8fa749d77bf85ea4ab9ab960ce86
Product:  82feb14b732dcd31176338d024b09e68c1646808
Version:  0.74.0-beta.5
Phase 1:  PR #9 → 4c9e98cd…
Phase 2A: PR #10 → 6caca1ec…
```

## Active work

**Phase V1 — One-day production launch** (see `13-phased-implementation-roadmap.md`). Focused Level C smoke only — not the former ACC catalogue or seven-day soak.

## What is not a v1 blocker

Managed external PostgreSQL · separate high-capacity Host B/P · automated release controller · schema lease/activation framework · contamination/patch reconstruction programme · durable execution leases / scheduler redesign · seven-day soak · provider failover · Prometheus/Grafana/Loki/Sentry · multi-agent DAG scaling · autonomous host-admin · complete chaos catalogue · upstream sync during launch.

## Legacy production freeze

DB **0036** / surgical binary **0035**: degraded and frozen. Do not migrate old damaged data into v1. Do not treat long-lived dashboard health as compatibility proof.

## Governing documents

- Process: `docs/appsolino/OPERATING-MODEL.md`
- Summary: `MASTER-PLAN.md`
- Roadmap: `13-phased-implementation-roadmap.md`
- Decisions: `15-open-decisions.md` (includes v1 topology amendment)
