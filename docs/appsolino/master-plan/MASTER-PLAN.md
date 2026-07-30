# Appsolino Fusion Server — MASTER PLAN (Governing Document)

**Process authority:** `docs/appsolino/OPERATING-MODEL.md` (how work is performed).
**This document:** architecture, production boundaries, and the **Personal Project v1** completion definition — not an enterprise multi-phase reliability programme.

**Status (2026-07-30):**
```text
Phase 0: COMPLETE
Phase 1: COMPLETE (0.74.0-beta.5)
Phase 2A: PARTIAL / MERGED / USABLE (PR #10 → 6caca1ec…)
Active: Phase V1 (V1A then V1B) — NOT STARTED
Host D: development / build / staging ONLY — production prohibited
Host P: production VPS (planned)
Former Phases 3–8: Future Improvements (not v1 blockers)
Legacy production: DEGRADED / FROZEN — untouched until replacement smoke passes
```

**Accepted baseline:** upstream `b85a5d4531df8fa749d77bf85ea4ab9ab960ce86` + patch `a366fab379…` → product `82feb14b7…` (`0.74.0-beta.5`). Closure PR #9 `4c9e98cd…`. Phase 2A PR #10 `6caca1ec…`.

---

## 1. Definition of “finished” (Personal Project v1)

**Finished means:**

> A usable Appsolino Fusion v1 is deployed on Host P, its irreplaceable data can be backed up and restored, the server can be rebuilt from Git, and normal development continues on Host D.

**Finished does not mean:** every future reliability, scaling, observability, or autonomous-agent feature is implemented.

### Personal Project v1 — definition of done

1. Accepted Fusion `0.74.0-beta.5` package built **once on Host D**.
2. That exact artefact validated on Host D staging and frozen (version + SHA-256).
3. Exact same artefact installed on **Host P** (hash match; no rebuild on Host P).
4. Fresh production database on Host P only (no old task/damaged DB migration).
5. Production service/state/config/DB identities exist **only on Host P**.
6. Production starts, restarts, reports expected version; create/read/update one task.
7. Production backup created and restored into a temporary database on Host P.
8. Source, infrastructure, and recovery instructions in GitHub.
9. Previous degraded production system untouched until replacement works.
10. Result labelled **Personal Project v1 complete**.

---

## 2. Hard requirements for v1 (six controls)

| Requirement | Why |
| --- | --- |
| Known package and version | Know what is running |
| Separate production DB/state on Host P | Avoid staging/dev contamination |
| Previous release preserved | Permit rollback |
| Backup before risky changes | Protect data |
| Restore proof | Confirm backup is usable |
| Infrastructure and recovery in Git | Rebuild after server loss |

Secrets stay outside Git. Production credentials and data exist **only on Host P**. Old production remains frozen until replacement smoke passes.

---

## 3. Correct topology (binding)

```text
Host D — Development VPS
├── source and Git worktrees
├── dependency cache
├── builds
├── staging service
├── staging PostgreSQL
├── integration tests
└── production-candidate package creation

Host P — Production VPS
├── no source builds
├── production service
├── production PostgreSQL
├── immutable production releases
├── production state
└── production backups

GitHub
├── source
├── Ansible/configuration
├── deployment scripts
└── recovery instructions

Off-host storage
└── production database backup only
```

**Host D must not** host `fusion-production.service`, `fusion_production` DB/role, or `/etc|srv|opt/.../production/` paths.

**Host P production identities only:**

```text
Service:       fusion-production.service
Database:      fusion_production
Role:          fusion_production
Configuration: /etc/appsolino-fusion/production/
State:         /srv/appsolino-fusion/production/
Releases:      /opt/appsolino-fusion/production/releases/
```

Executable SHA-256 on Host P must match the Host D candidate. Host P performs **no** source builds. Managed external PostgreSQL and larger host sizing remain Future Improvements — not required to redefine this topology.

---

## 4. Active roadmap

| Item | Status |
| --- | --- |
| Phase 0 — Decisions | COMPLETE |
| Phase 1 — Accepted package | COMPLETE |
| Phase 2A — Staging foundation | COMPLETE ENOUGH / USABLE |
| **Phase V1A** — Build/validate candidate on Host D | **Next / NOT STARTED** |
| **Phase V1B** — Deploy exact artifact to Host P | After V1A passes |
| Former Phases 3–8 | Future Improvements (optional) |

Detail: `13-phased-implementation-roadmap.md`. Approvals: `15-open-decisions.md`.

---

## 5. Phase V1 acceptance (focused Level C)

### V1A — Host D (required before V1B)

```text
git tree clean; no upstream pull
package build succeeds
executable version = 0.74.0-beta.5
executable SHA-256 recorded
staging health + DB healthy
create/read/update one test task
restart preserves the task
staging backup + temporary restore
migration-set SHA-256 recorded
release identity frozen (immutable candidate)
no production paths/DB/service on Host D
```

### V1B — Host P (after V1A)

```text
secure copy of exact artifact
SHA-256 matches Host D candidate
install under immutable production release path
production DB identity correct (fusion_production only)
service active; listener correct; health version correct
create/read/update one task; restart preserves task
first production backup + temporary restore; destroy restore DB
previous release remains available
production credentials/data only on Host P
```

Not required for v1: all repository tests; all ACC classes; clean Ubuntu rebuild during launch; seven-day soak; upstream merge; full observability; autonomous agent root path.

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
- Host D is never a production host under this plan.

---

## 8. Document index

| Doc | Role |
| --- | --- |
| `OPERATING-MODEL.md` | Process authority |
| `MASTER-PLAN.md` | This architecture / v1 completion summary |
| `00-executive-summary.md` | Target and status |
| `13-phased-implementation-roadmap.md` | V1A → V1B + Future backlog |
| `15-open-decisions.md` | Approvals; topology amendment |
| `01`–`12`, `14` | Historical detail / reference (not active launch blockers) |
