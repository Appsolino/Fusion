# Phased Implementation Roadmap

Last updated: 2026-07-30
**Process authority:** `docs/appsolino/OPERATING-MODEL.md`

**Stop rule:** V1A.2 corrected Host D retest is **PASS WITH OBSERVATIONS**. **V1B remains deferred by owner** until production is explicitly authorised. Host D is development/build/staging only — **production on Host D is prohibited**. Former Phases 3–8 are Future Improvements. Legacy production remains **DEGRADED / FROZEN**.

---

## Completed

### Phase 0 — Strategic decisions
- **Status:** COMPLETE / APPROVED (2026-07-29). Record: `15-open-decisions.md`.

### Phase 1 — Accepted package
- **Status:** COMPLETE / ACCEPTED (2026-07-29). Baseline `0.74.0-beta.5`. Closure PR #9 → `4c9e98cd…`.

### Phase 2A — Staging foundation
- **Status:** COMPLETE ENOUGH / USABLE (2026-07-30). PR #10 → `6caca1ec…`. Staging on Host D works.

---

## Active phase: Phase V1 (two ordered stages)

### Topology (binding)

```text
Host D — Development VPS
├── source and Git worktrees
├── dependency cache
├── builds
├── staging service + staging PostgreSQL
├── integration tests
└── production-candidate package creation
    (NO production service / DB / state)

Host P — Production VPS
├── no source builds
├── fusion-production.service
├── fusion_production role + database
├── /etc/appsolino-fusion/production/
├── /srv/appsolino-fusion/production/
├── /opt/appsolino-fusion/production/releases/
└── production backups
```

Executable SHA-256 on Host P must match Host D. Production credentials/data exist only on Host P.

---

### Phase V1A — Build and validate production candidate on Host D

- **Status:** **COMPLETE** (2026-07-30). PR #11 → `45ab25100…`. Record: `docs/appsolino/v1/V1A-CANDIDATE.md`. Release `v1a-0.74.0-beta.5-f54d53082`.
- **Objective:** Build once from current `main`, validate on staging, freeze immutable candidate.
- **Forbidden:** upstream pull; product behaviour changes; creating any production paths/DB/service on Host D; old-data migration. Do **not** rebuild this frozen candidate unless a real defect requires a new candidate.

### Phase V1A.1 — Extended Host D stability / real workflow validation

- **Status:** **FAIL / historical** (2026-07-30). Record: `docs/appsolino/v1/V1A-DEV-STABILITY.md` (original section).
- **Objective:** Prove Fusion service → coordinator → agent/child → repository path under realistic disposable tasks before spending on Host P.
- **Outcome:** Real path proven under `testMode`/mock; execute fails with step-index error and redispatch loop; immutable install stripped runtime execute bits (restart hang). Corrections A/B required.

### Phase V1A.2 — Corrected Host D stability retest

- **Status:** **PASS WITH OBSERVATIONS** (2026-07-30). Record: `docs/appsolino/v1/V1A-DEV-STABILITY.md` (V1A.2 section). Candidate `v1a2-0.74.0-beta.5-3bc46bffe` after PR #12 + PR #13.
- **Objective:** Merge Corrections A/B, build one corrected candidate, rerun affected Host D stability checks.
- **Outcome:** Mock tasks complete without step-index/redispatch defects; concurrency isolated; restart preserves done tasks; runtime execute bits preserved. Observations: mock does not materialize descriptive file writes; immutable-helper chmod EPERM noise is non-blocking. **V1B remains DEFERRED BY OWNER.**

#### Procedure

```text
Current Appsolino main
  → Build package once on Host D
  → Record version and SHA-256
  → Install exact package into staging
  → Focused staging tests
  → Declare package a production candidate (freeze identity)
```

#### V1A acceptance

```text
Git tree clean; no upstream pull
package build succeeds
executable reports 0.74.0-beta.5
executable SHA-256 recorded
staging health succeeds; staging DB healthy
create/read/update one test task
restart preserves the task
backup and temporary restore work
migration-set SHA-256 recorded
release identity frozen
no production identities on Host D
```

#### Freeze record (immutable candidate)

```text
Release ID
Git commit
Version
Executable SHA-256
Migration-set SHA-256
Build date
Staging validation result
```

Do **not** rebuild this package on Host P.

---

### Phase V1B — Deploy exact artifact to Host P

- **Status:** **DEFERRED BY OWNER** (not next; Host P not reserved)
- **Objective:** Install the Host D candidate on Host P; production smoke; first backup/restore; declare v1 complete.
- **Prerequisite:** Successful Host D development stability (V1A.1 or successor) and explicit owner authorisation. Transfer exact frozen archive only. Host P performs **no** source builds.

#### Procedure

```text
Validated artifact from Host D
  → Secure copy to Host P
  → Verify SHA-256 matches
  → Install under immutable production release path
  → Create production database and configuration
  → Start production privately
  → Smoke + backup/restore
```

#### V1B acceptance

```text
SHA-256 matches Host D candidate
production DB identity = fusion_production
service active; listener correct; health version correct
create/read/update one task; restart preserves task
first production backup succeeds
temporary restore succeeds; restore DB destroyed
previous release remains available
production credentials/data only on Host P
legacy production still frozen
```

#### Declare

After V1B passes: **Personal Project v1 complete**.

---

### One-day schedule (indicative; requires Host P ready)

| Time | Work |
| --- | --- |
| 08:30–09:00 | Topology locked; inspect Host D |
| 09:00–11:00 | V1A: build production candidate on Host D |
| 11:00–12:30 | V1A: staging task, restart, backup/restore |
| 12:30–13:00 | V1A: freeze artifact and release identity |
| 13:00–14:00 | V1B: prepare production identities on Host P |
| 14:00–15:00 | V1B: transfer and install exact artifact |
| 15:00–16:00 | V1B: production smoke and backup/restore |
| 16:00–17:00 | Recovery record and buffer |

**Excluded from the clock:** buying/waiting for Host P; DNS wait; old-data migration; upstream sync; new features; unrelated repairs; long soak.

#### Forbidden during V1

- Production service/DB/state on Host D
- Rebuilding the candidate on Host P
- Product behaviour / workflow changes
- Upstream pull/merge
- Migrating old production tasks/DB
- Expanding Future Improvements as launch blockers

---

## Future Improvements (optional backlog)

Former Phases 3–8 and related programme work. **None reopen the v1 gate.**

| Backlog item | Notes |
| --- | --- |
| Managed external PostgreSQL | Optional later |
| Larger dedicated Host B/P sizing | Optional later |
| Automated release controller | Former Phase 3 |
| Contamination / Git-safety programme | Former Phase 4 |
| Durable execution / scheduler redesign | Former Phase 5 |
| Full verification programme | Former Phase 6 |
| Provider failover; full observability stack | Former Phase 7 |
| Multi-agent scaling; seven-day soak | Former Phase 8+ |
| Autonomous host-admin | Engine-child path |
| Upstream refresh | Operating model (manual/monthly) |

---

## Sequencing

```text
0 → 1 → 2A → V1A (Host D candidate) → V1B (Host P deploy) → Personal Project v1 complete
                              ↘ Future Improvements (optional)
```
