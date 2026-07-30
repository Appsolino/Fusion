# Appsolino Fusion Server — MASTER PLAN (Governing Document)

**Process authority:** `docs/appsolino/OPERATING-MODEL.md` (how work is performed).  
**This document:** architecture, production boundaries, and the **Personal Project v1** completion definition — not an enterprise multi-phase reliability programme.

**Status (2026-07-30):**
```text
Phase 0: COMPLETE
Phase 1: COMPLETE (0.74.0-beta.5)
Phase 2A: PARTIAL / MERGED / USABLE (PR #10 → 6caca1ec…)
Active phase: Phase V1 — One-day production launch (NOT STARTED)
Former Phases 3–8: Future Improvements backlog (not v1 blockers)
Production (legacy): DEGRADED / FROZEN — untouched until replacement smoke passes
```

**Accepted baseline:** upstream `b85a5d4531df8fa749d77bf85ea4ab9ab960ce86` + patch `a366fab379…` → product `82feb14b7…` (`0.74.0-beta.5`). Closure PR #9 `4c9e98cd…`. Phase 2A PR #10 `6caca1ec…`.

---

## 1. Definition of “finished” (Personal Project v1)

**Finished means:**

> A usable Appsolino Fusion v1 is deployed, its irreplaceable data can be backed up and restored, the server can be rebuilt from Git, and normal development can continue.

**Finished does not mean:** every future reliability, scaling, observability, or autonomous-agent feature is implemented.

### Personal Project v1 — definition of done

1. Accepted Fusion `0.74.0-beta.5` package built once.  
2. That exact tested package deployed.  
3. Fresh production database created (no old task/damaged DB migration).  
4. Separate production service, state, config, and database identities.  
5. Service starts, restarts, and reports expected version.  
6. A task can be created, read, and updated.  
7. Database backup created and restored into a temporary database.  
8. Source, infrastructure, and recovery instructions in GitHub.  
9. Previous degraded production system untouched until replacement works.  
10. Result labelled **Personal Project v1 complete**.

---

## 2. Hard requirements for v1 (six controls)

| Requirement | Why |
| --- | --- |
| Known package and version | Know what is running |
| Separate production DB/state | Avoid staging contamination |
| Previous release preserved | Permit rollback |
| Backup before risky changes | Protect data |
| Restore proof | Confirm backup is usable |
| Infrastructure and recovery in Git | Rebuild after server loss |

Secrets stay outside Git. Old production remains frozen until replacement smoke passes.

---

## 3. Initial v1 topology

```text
One server (Host D initially)
├── build workspace
├── staging service + staging database
├── production service + production database
└── local temporary backups

GitHub
├── source
├── Ansible/configuration
├── deployment scripts
└── recovery instructions

Off-host storage
└── production database backup only
```

**Initial production choice:** Host D may run build, staging, and initial production with **separate identities**:

```text
Service:       fusion-production.service
Database:      fusion_production
Role:          fusion_production
Configuration: /etc/appsolino-fusion/production/
State:         /srv/appsolino-fusion/production/
Releases:      /opt/appsolino-fusion/production/releases/
```

A dedicated Host P and managed external PostgreSQL are **optional future improvements**, not launch blockers. If a separate production host is already provisioned and accessible, the same process may run there; procuring a new host during the one-day window is avoidable risk.

---

## 4. Active roadmap

| Item | Status |
| --- | --- |
| Phase 0 — Decisions | COMPLETE |
| Phase 1 — Accepted package | COMPLETE |
| Phase 2A — Staging foundation | COMPLETE ENOUGH / USABLE |
| **Phase V1 — One-day production launch** | **Active / NOT STARTED** |
| Former Phases 3–8 | Future Improvements (optional) |

Detail: `13-phased-implementation-roadmap.md`. Approvals/amendments: `15-open-decisions.md`.

---

## 5. Phase V1 focused acceptance (Level C production-candidate)

Required:

```text
git diff --check
relevant configuration syntax
current main is clean
package build succeeds
package version = 0.74.0-beta.5
executable hash recorded
production DB identity correct
service active
listener correct
health version correct
create/read/update one task
restart preserves task
backup succeeds
temporary restore succeeds
previous release remains available
```

Not required for v1: all repository tests; all ACC classes; clean Ubuntu rebuild during launch; seven-day soak; upstream merge; staging reconstruction; full observability; autonomous agent root path.

---

## 6. Production posture (legacy, until replacement)

```text
Database schema: 0036
Production surgical binary: 0035
```

Degraded/frozen surgical host remains untouched. Health OK ≠ schema-compatible. No migration of old damaged data into v1.

---

## 7. Explicit non-claims

- Not zero failures.  
- Not a multi-week reliability programme as a v1 gate.  
- Source tests ≠ packaged proof.  
- Future Improvements backlog does not reopen the v1 completion gate.

---

## 8. Document index

| Doc | Role |
| --- | --- |
| `OPERATING-MODEL.md` | Process authority |
| `MASTER-PLAN.md` | This architecture / v1 completion summary |
| `00-executive-summary.md` | Target and status |
| `13-phased-implementation-roadmap.md` | Active Phase V1 + Future backlog |
| `15-open-decisions.md` | Approvals; v1 topology amendment |
| `01`–`12`, `14` | Historical detail / reference (not active launch blockers) |
