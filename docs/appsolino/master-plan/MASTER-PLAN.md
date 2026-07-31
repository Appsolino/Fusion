# Appsolino Fusion Server — MASTER PLAN (Governing Document)

**Process authority:** `docs/appsolino/OPERATING-MODEL.md` (how work is performed).
**This document:** architecture, production boundaries, Personal Project v1 completion, and the **automation-first** Host D development model.

**Status (2026-07-31):**
```text
Phase 0: COMPLETE
Phase 1: COMPLETE (0.74.0-beta.5)
Phase 2A: PARTIAL / MERGED / USABLE (PR #10 → 6caca1ec…)
V1A: COMPLETE (PR #11 → 45ab25100…)
V1A.1: FAIL — historical Host D stability gate (see docs/appsolino/v1/V1A-DEV-STABILITY.md)
V1A.2: PASS WITH OBSERVATIONS — corrected candidate v1a2-0.74.0-beta.5-3bc46bffe
V1A.3: BLOCKED — non-production provider credential required
a.anas.bz: ACTIVE / AUTHENTICATED
PR #15: MERGED (mission timing rule)
PR #16 / #18: MERGED (upstream shadow attempt; first run failed — superseded)
Automated upstream integration: REQUIRED / NOT IMPLEMENTED
Automated Host D release: REQUIRED / NOT IMPLEMENTED
V1B: DEFERRED BY OWNER (pending Host D automation + explicit approval)
Host D: development / build / staging ONLY — production prohibited
Host P: not reserved / not accessed
Former Phases 3–8 (except Host D automation now required): Future Improvements
Legacy production: DEGRADED / FROZEN — untouched until replacement smoke passes
```

**Accepted baseline:** upstream pin `b85a5d4531df8fa749d77bf85ea4ab9ab960ce86` + patch `a366fab379…` → product `82feb14b7…` (`0.74.0-beta.5`). Closure PR #9 `4c9e98cd…`. Phase 2A PR #10 `6caca1ec…`. V1A PR #11. Corrected Host D candidate after PR #12/#13: `v1a2-0.74.0-beta.5-3bc46bffe`.

**Governing development principle (2026-07-31):**

> Automate routine development completely. Require human approval only when automation detects high risk, or before production activation.

---

## 1. Definition of “finished” (Personal Project v1)

**Finished means:**

> A usable Appsolino Fusion v1 is deployed on Host P, its irreplaceable data can be backed up and restored, the server can be rebuilt from Git, and normal development continues on Host D with automated upstream absorb and automated Host D releases.

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
10. Host D development path uses automated upstream integration and automated immutable releases to `a.anas.bz` (production remains human-gated).
11. Result labelled **Personal Project v1 complete**.

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
├── automated immutable development releases
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
├── automated upstream integration workflows
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

**Deployment gates:**

```text
Host D automatic development deployment: YES (required; not yet implemented)
Host P automatic production deployment: NO
Production activation: explicit owner approval
```

---

## 4. Automation-first Host D architecture (binding)

```text
Runfusion/Fusion:main
        │
        │ scheduled detection
        ▼
Automated integration branch (automation/upstream-*)
        │
        ├── merge --no-ff upstream
        ├── risk classification
        ├── preserve Appsolino corrections (A/B contract tests)
        ├── focused tests + disposable migration proof when needed
        ├── build immutable package
        └── temporary staging candidate validation
        │
        ▼
Automated synchronization PR
        │
        ├── safe + checks pass → auto-merge
        └── sensitive → hold for one owner approval (owner does not redo the work)
        │
        ▼
Appsolino/Fusion:main
        │
        │ automatic Host D release workflow
        ▼
New immutable development release → a.anas.bz
        │
        ├── install beside previous release
        ├── health / migration / smoke
        └── automatic rollback on failure
```

Exact tip mirroring onto a permanent `upstream-shadow` branch is **not** the absorb process. Git remote-tracking of upstream inside the workflow is sufficient for detection. Details: `04-fork-and-upstream-update-strategy.md`, `OPERATING-MODEL.md` §3, `upstream/UPSTREAM-MONITORING.md`.

---

## 5. Active roadmap

| Item | Status |
| --- | --- |
| Phase 0 — Decisions | COMPLETE |
| Phase 1 — Accepted package | COMPLETE |
| Phase 2A — Staging foundation | COMPLETE ENOUGH / USABLE |
| **Phase V1A** — Build/validate candidate on Host D | **COMPLETE** (PR #11) |
| **Phase V1A.1** — Extended Host D stability | **FAIL** (historical; record in `V1A-DEV-STABILITY.md`) |
| **Phase V1A.2** — Corrected Host D retest | **PASS WITH OBSERVATIONS** |
| **Phase V1A.3** — Real-provider proof | **BLOCKED** (credentials) |
| **Automated upstream integration** | **REQUIRED / NOT IMPLEMENTED** |
| **Automated Host D release** | **REQUIRED / NOT IMPLEMENTED** |
| **Phase V1B** — Deploy exact artifact to Host P | **DEFERRED BY OWNER** |
| Former Phases 3–8 (except Host D automation above) | Future Improvements (optional) |

Detail: `13-phased-implementation-roadmap.md`. Approvals: `15-open-decisions.md`.

---

## 6. Phase V1 acceptance (focused Level C)

### V1A — Host D (required before V1B)

```text
git tree clean; no uncontrolled upstream pull
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

### V1A.2 / V1A.3 — Host D development readiness

```text
V1A.2: PASS WITH OBSERVATIONS (corrected mock/lifecycle + install bits)
V1A.3: real provider repository edit — BLOCKED until non-production credential exists
```

### V1B — Host P (after V1A family + owner approval)

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

Not required for v1: all repository tests; all ACC classes; clean Ubuntu rebuild during launch; seven-day soak; full observability; autonomous agent root path.

---

## 7. Production posture (legacy, until replacement)

```text
Database schema: 0036
Production surgical binary: 0035
```

Degraded/frozen surgical host remains untouched. Health OK ≠ schema-compatible. No migration of old damaged data into v1.

---

## 8. Explicit non-claims

- Not zero failures.
- Not a multi-week reliability programme as a v1 gate.
- Source tests ≠ packaged proof.
- Future Improvements backlog does not reopen the Host P launch gate.
- Host D is never a production host under this plan.
- Temporary “manual monthly upstream sync” wording from the 2026-07-30 Personal Project v1 amendment is **superseded** for Host D development; it was a staging-repair scope reduction, not the permanent absorb model.

---

## 9. Document index

| Doc | Role |
| --- | --- |
| `OPERATING-MODEL.md` | Process authority (automation-first) |
| `MASTER-PLAN.md` | This architecture / v1 completion summary |
| `00-executive-summary.md` | Target and status |
| `04-fork-and-upstream-update-strategy.md` | Automated absorb + branch model |
| `13-phased-implementation-roadmap.md` | V1A → automation → V1B + Future backlog |
| `15-open-decisions.md` | Approvals; topology; automation amendment |
| `upstream/UPSTREAM-MONITORING.md` | Detection vs full integration (implementation status) |
| `01`–`03`, `05`–`12`, `14` | Historical detail / reference |
