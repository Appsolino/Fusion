> **Status: Historical/reference**
> This document does not override `MASTER-PLAN.md`, `OPERATING-MODEL.md` or `CURRENT-STATE.md`.


**Live status:** [`docs/appsolino/CURRENT-STATE.md`](../CURRENT-STATE.md) — do not treat numbers below as authoritative.

# Phased Implementation Roadmap

Last updated: 2026-07-31
**Process authority:** `docs/appsolino/OPERATING-MODEL.md`

**Stop rule:** V1A.2 corrected Host D retest is **PASS WITH OBSERVATIONS**. **V1B remains deferred by owner** until production is explicitly authorised. Host D is development/build/staging only — **production on Host D is prohibited**. **Automated upstream integration and automated Host D release are REQUIRED and not yet implemented** — align docs, then implement, before treating large upstream catch-up as a manual chore. Legacy production remains **DEGRADED / FROZEN**.

---

## Completed

### Phase 0 — Strategic decisions
- **Status:** COMPLETE / APPROVED (2026-07-29). Record: `15-open-decisions.md` (amended 2026-07-31 for automation-first Host D).

### Phase 1 — Accepted package
- **Status:** COMPLETE / ACCEPTED (2026-07-29). Baseline `0.74.0-beta.5`. Closure PR #9 → `4c9e98cd…`.

### Phase 2A — Staging foundation
- **Status:** COMPLETE ENOUGH / USABLE (2026-07-30). PR #10 → `6caca1ec…`. Staging on Host D works. Dev URL `a.anas.bz` active/authenticated.

---

## Active phase: Phase V1 + Host D automation

### Topology (binding)

```text
Host D — Development VPS
├── source and Git worktrees
├── dependency cache
├── builds
├── staging service + staging PostgreSQL
├── integration tests
├── automated immutable development releases → a.anas.bz
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

```text
Host D automatic development deployment: YES (required; not yet implemented)
Host P automatic production deployment: NO
Production activation: explicit owner approval
```

---

### Phase V1A — Build and validate production candidate on Host D

- **Status:** **COMPLETE** (2026-07-30). PR #11 → `45ab25100…`. Record: `docs/appsolino/v1/V1A-CANDIDATE.md`. Release `v1a-0.74.0-beta.5-f54d53082` (superseded for Host D stability by V1A.2 candidate).

### Phase V1A.1 — Extended Host D stability / real workflow validation

- **Status:** **FAIL / historical** (2026-07-30). Record: `docs/appsolino/v1/V1A-DEV-STABILITY.md` (original section).
- **Outcome:** Real path proven under `testMode`/mock; execute step-index/redispatch defects; install stripped runtime execute bits. Corrections A/B required.

### Phase V1A.2 — Corrected Host D stability retest

- **Status:** **PASS WITH OBSERVATIONS** (2026-07-30). Record: `docs/appsolino/v1/V1A-DEV-STABILITY.md` (V1A.2 section). Candidate `v1a2-0.74.0-beta.5-3bc46bffe` after PR #12 + PR #13.
- **Outcome:** Mock tasks complete without step-index/redispatch defects; concurrency isolated; restart preserves done tasks; runtime execute bits preserved. Observations: mock does not materialize descriptive file writes; immutable-helper chmod EPERM noise is non-blocking. **V1B remains DEFERRED BY OWNER.**

### Phase V1A.3 — Real-provider repository edit proof

- **Status:** **BLOCKED** (2026-07-30/31). Record: `docs/appsolino/v1/V1A-DEV-STABILITY.md` (V1A.3 section).
- **Blocker:** No non-production real-provider credential on Host D; `testMode=true` would force mock (forbidden as V1A.3 evidence).
- **Do not** silently substitute mock or pull production identities onto Host D.

#### V1A family acceptance (summary)

```text
Git tree clean; no uncontrolled upstream pull
package build succeeds; executable 0.74.0-beta.5; SHA-256 recorded
staging health + DB healthy; task CRUD + restart persistence
backup/restore; migration-set SHA-256; release identity frozen
no production identities on Host D
V1A.2: PASS WITH OBSERVATIONS
V1A.3: BLOCKED pending non-production provider credential
```

---

### Phase AUTO-D — Automated Host D development pipeline (**REQUIRED**)

- **Status:** **REQUIRED / NOT IMPLEMENTED** (aligned in docs 2026-07-31; implementation is the next engineering track).
- **Objective:** Automate upstream absorb and Host D immutable release so Cursor is not required to manually rebuild/reinstall after every accepted change.
- **Supersedes:** “manual / approximately monthly” upstream sync as the permanent operating model.

#### AUTO-D.1 — Automated upstream integration

```text
Detect Runfusion/Fusion main (6–24h)
→ single automation/upstream-* branch
→ merge --no-ff (no rebase of Appsolino history)
→ risk classification (safe | sensitive)
→ Correction A/B contract tests (hard stop on fail)
→ migration disposable proof when migrations change (always sensitive)
→ focused tests + package + staging candidate
→ one sync PR; safe auto-merge OR sensitive owner approval
→ no duplicate PR loops; full failure report fields
```

#### AUTO-D.2 — Automated Host D release (after main advances)

```text
main SHA → build once → hashes → install beside previous release
→ switch staging current symlink → restart → /api/health + smoke
→ on failure: mark new release failed; restore previous; main stays merged; report
```

Normal Appsolino feature PRs use the **same** Host D package/deploy path after merge.

#### Forbidden in AUTO-D

- Host P access; production secrets on Host D; production deployment
- Importing upstream `.github/workflows` wholesale
- Adding PAT/OAuth/deploy-key/App tokens to force exact upstream tip mirrors
- Unbounded duplicate sync PRs

Detail: `04-fork-and-upstream-update-strategy.md`, `OPERATING-MODEL.md` §3.

---

### Phase V1B — Deploy exact artifact to Host P

- **Status:** **DEFERRED BY OWNER** (not next; Host P not reserved)
- **Objective:** Install the Host D candidate on Host P; production smoke; first backup/restore; declare v1 complete.
- **Prerequisite:** Host D development stability (V1A.2+), workable real-provider path (V1A.3 or accepted waiver), **AUTO-D operational or explicitly waived by owner**, and explicit owner authorisation. Transfer exact frozen archive only. Host P performs **no** source builds.

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

### Forbidden during V1 / AUTO-D (Host P still deferred)

- Production service/DB/state on Host D
- Rebuilding candidates on Host P
- Migrating old production tasks/DB
- Expanding unrelated Future Improvements as Host P launch blockers
- Treating exact-tip `upstream-shadow` mirroring as the absorb process

---

## Future Improvements (optional backlog)

Former Phases 3–8 and related programme work **except** Host D automated upstream integration and Host D automated release (those are **AUTO-D**, required). **None of the remaining items reopen the Host P launch gate by themselves.**

| Backlog item | Notes |
| --- | --- |
| Managed external PostgreSQL | Optional later |
| Larger dedicated Host B/P sizing | Optional later |
| Full enterprise release-controller programme beyond Host D AUTO-D | Former Phase 3 remainder |
| Contamination / Git-safety programme | Former Phase 4 |
| Durable execution / scheduler redesign | Former Phase 5 |
| Full verification programme | Former Phase 6 |
| Provider failover; full observability stack | Former Phase 7 |
| Multi-agent scaling; seven-day soak | Former Phase 8+ |
| Autonomous host-admin | Engine-child path |

---

## Sequencing

```text
0 → 1 → 2A → V1A → V1A.2 (PASS WITH OBSERVATIONS)
                 → V1A.3 (BLOCKED on credentials)
                 → AUTO-D (REQUIRED: upstream absorb + Host D release)
                 → V1B (Host P, owner-gated) → Personal Project v1 complete
                              ↘ Future Improvements (optional)
```
