# Phased Implementation Roadmap

Last updated: 2026-07-30  
**Process authority:** `docs/appsolino/OPERATING-MODEL.md`

**Stop rule:** Only **Phase V1** is active. Former Phases 3–8 are **Future Improvements** and must not reopen the Personal Project v1 completion gate. Legacy production remains **DEGRADED / FROZEN** until replacement smoke passes.

---

## Completed

### Phase 0 — Strategic decisions
- **Status:** COMPLETE / APPROVED (2026-07-29). Record: `15-open-decisions.md`.

### Phase 1 — Accepted package
- **Status:** COMPLETE / ACCEPTED (2026-07-29). Baseline `0.74.0-beta.5` (upstream `b85a5d453…` + product `82feb14b7…`). Closure PR #9 → `4c9e98cd…`. Evidence: `docs/appsolino/phase-1/candidate-b85a5d453/`.

### Phase 2A — Staging foundation
- **Status:** COMPLETE ENOUGH / USABLE (2026-07-30). PR #10 → `6caca1ec…`. Staging on Host D works. Evidence: `docs/appsolino/phase-2/`. Remaining NOT PROVEN items (off-host backup, clean rebuild, engine-child admin) are capability gates — not blockers for Phase V1 launch scope beyond the six hard controls.

---

## Active phase

### Phase V1 — Personal Project v1 — One-day production launch
- **Status:** **NOT STARTED** (authorised as the sole active completion phase).  
- **Objective:** Deploy usable production on the simplified topology; prove backup/restore; leave recovery instructions in Git; declare Personal Project v1 complete.  
- **Product behaviour:** Do not change Fusion product behaviour. Do not pull upstream. Do not migrate old damaged data.

#### Tasks

1. Review current `main`.  
2. Do not pull upstream.  
3. Do not change product behaviour.  
4. Build the accepted package once using the existing cache.  
5. Create isolated production configuration and database.  
6. Install the immutable package.  
7. Start production service privately.  
8. Run focused production smoke tests.  
9. Create and restore one production backup.  
10. Record release identity and recovery instructions.  
11. Declare Personal Project v1 complete.

#### Initial topology

Host D may run build + staging + production with separate production identities:

```text
fusion-production.service
fusion_production (role + database)
/etc/appsolino-fusion/production/
/srv/appsolino-fusion/production/
/opt/appsolino-fusion/production/releases/
```

#### One-day schedule (indicative)

| Time | Work |
| --- | --- |
| 08:30–09:00 | Lock scope (this plan) |
| 09:00–10:00 | Production paths, DB identity, secrets, systemd unit |
| 10:00–12:00 | Build once from current `main`; hash package |
| 12:00–13:00 | Install and start production service |
| 13:00–14:00 | Health, version, task, restart smoke |
| 14:00–15:00 | Backup and temporary restore proof |
| 15:00–16:00 | Recovery instructions, release record, final review |
| 16:00–17:00 | Buffer for one blocking defect |

**Excluded from the one-day clock:** buying/waiting for a new server; DNS wait; migrating old damaged data; upstream sync; new product features; unrelated repairs; long soak.

#### Focused acceptance (Level C production-candidate)

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

**Not required:** all repository tests; all ACC classes; clean Ubuntu rebuild during launch; seven-day soak; upstream merge; staging reconstruction; full observability; autonomous agent root path.

#### Forbidden during V1

- Changing product behaviour / workflows / reliability modules  
- Pulling or merging upstream  
- Migrating old production tasks/DB  
- Touching the legacy degraded production system except to leave it frozen  
- Expanding into Future Improvements as launch blockers  

---

## Future Improvements (optional backlog)

Former Phases 3–8 and related programme work. **None reopen the v1 gate.**

| Backlog item | Former phase (reference) |
| --- | --- |
| Automated release controller / schema lease framework | Phase 3 |
| Contamination gates / patch reconstruction / Git-safety programme | Phase 4 |
| Durable execution leases / scheduler redesign | Phase 5 |
| Full verification integrity programme | Phase 6 |
| Provider failover gateway; cost budgets; event wakeups | Phase 7 |
| Full observability (OTel, Prometheus, Grafana, Loki, Sentry) | Phase 7 |
| Multi-agent DAG / concurrency scaling | Phase 8 |
| Seven-day soak / complete chaos catalogue | Phase 5+ |
| Managed external PostgreSQL | Phase 0 OD-POSTGRES (superseded for v1) |
| Dedicated high-capacity Host B / Host P | Phase 0 OD-TOPOLOGY (superseded for v1) |
| Autonomous host-admin execution | ACC engine-child path |
| Upstream refresh (manual/monthly) | Operating model |

---

## Sequencing

```text
0 → 1 → 2A → V1 (Personal Project v1 complete)
                ↘ Future Improvements (optional, anytime later)
```
