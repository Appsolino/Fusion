# Open Decisions — Phase 0 Approval Record

Last updated: 2026-07-29
Status: **Phase 0 decisions APPROVED** (operator direction recorded below).
**Implementation authorisation:** Phase 1 clean-baseline work may begin only after this decision record is **committed and reviewed**. No production activation is authorised. No Appsolino reliability re-land (contamination gates, Phase 2, FUSI-007, etc.) until Phase 1 exit gate passes.

---

# Phase 0 Decision Approval

Date: 2026-07-29

## OD-BASELINE
Approved direction: Select a pinned upstream commit only after unchanged
packaged-runtime acceptance. Exact SHA will be selected during Phase 1 candidate
evaluation.

Do **not** treat moving `upstream/main` as the baseline. Do **not** select a SHA merely because it is newest.

### Baseline selection gate (unchanged upstream)

```text
clean clone
→ frozen dependency install
→ complete source build
→ complete CLI package
→ packaged dist/bin.js start
→ dashboard health
→ task list
→ task show
→ activity feed
→ migration identity check
```

If a candidate fails: choose an earlier known-good upstream commit, **or** apply a separate minimal baseline build patch (not Appsolino reliability work).

### Baseline record fields (required when selected)

```text
Upstream repository
Upstream commit SHA
Upstream version/tag
Lockfile hash
Node version
pnpm version
Date selected
Packaged-smoke result
```

## OD-TOPOLOGY
Approved: Two hosts initially:
- Host B: combined build and staging
- Host P: dedicated production

Split build vs staging later only if measurements justify it.

### Approved initial specifications

**Host B — Build and staging**

```text
Ubuntu Server 24.04 LTS
16 vCPU
64 GB RAM
500 GB NVMe
16–32 GB swap
```

Responsibilities: upstream clones; Appsolino product source; dependency installation; full builds; packaged-runtime tests; staging Fusion service; staging PostgreSQL (or separate managed staging DB); migration rehearsals; chaos testing; release artefact creation.

**Host P — Production**

```text
Ubuntu Server 24.04 LTS
8–16 vCPU
32–64 GB RAM
500 GB NVMe
16 GB swap
```

Responsibilities: immutable packaged releases only; production Fusion service; task worktrees; bubblewrap execution; monitoring; backup agent; **no** source compilation; **no** experimental dependency installation against the deployed release.

## OD-IDENTITY
Approved:
- release manifest is authoritative for release identity;
- PostgreSQL migration history is authoritative for schema;
- active symlink and activation record must match the release manifest.

Controller/status JSON is subordinate and must never disagree with the activated manifest after cutover.

## OD-DIRTY-TREES
Approved: Existing dirty source trees (`fusion-development`, `fusion-appsolino`) are reference-only and will **not** become the new baseline or `appsolino/main`.

They remain reference sources for: known issue behaviour; source modules; tests; expected error codes; documentation. Extract fixes, tests, and design knowledge **selectively**.

Alias of prior IDs: `OD-DEV-TREE`, `OD-MANAGED-DIRTY` — both closed by this decision.

## OD-FUSI-007
Approved: Reimplement the four-file `CentralCore.close` fix and tests on the clean baseline. Do not cherry-pick the contaminated task branch.

(Contaminated branch may be archived as evidence only.)

## OD-PHASE-2
Approved: Re-land Phase 2 from documented invariants, source modules and tests, not from contaminated branch history.

## OD-RELEASE-CONTROLLER
Approved: Freeze the existing release controller. Replace or reactivate only after the new release system passes staging acceptance.

Do **not** resume the current controller against production.

## OD-POSTGRES
Approved: Managed external PostgreSQL for production, with a separate production-equivalent staging database (same major version and configuration class).

Current embedded Postgres on the live host is a temporary degraded bridge only — not the target.

## OD-ACTIVATION
Approved: Production activation and migrations require explicit human confirmation during the initial reliability programme.

Reconsider autonomous production activation only after several successful releases **and** restore drills. Staging may remain more autonomous under gates.

## Implementation authorisation
Phase 1 clean-baseline work may begin only after this decision record is committed and reviewed. No production activation is authorised.

**Next mission after commit/review:** Phase 1 only — clean-baseline establishment and **unchanged** upstream packaged-runtime testing. Do **not** yet re-land Phase 1 contamination gate, Phase 2, FUSI-007, or other Appsolino fixes.

---

## Approved source model

```text
upstream/main
    Exact mirror of Runfusion/Fusion

appsolino/main
    Clean Appsolino product source

integration/upstream-<version>-<date>
    Temporary upstream adoption branch

release/<appsolino-version>
    Exact immutable release source

hotfix/<issue>
    Emergency fixes that must later return through appsolino/main
```

---

## Production posture until replacement (mandatory)

Reported live split:

```text
Database schema: 0036
Production surgical binary: 0035
```

A healthy dashboard response does **not** prove production compatibility.

Until a coherent replacement release is activated:

- do **not** create new tasks;
- do **not** resume paused tasks;
- do **not** run CLI commands that attempt to open the incompatible database;
- do **not** run migrations;
- do **not** activate another partial build;
- do **not** rely on the long-lived dashboard process as evidence that the release is safe.

**Classification:** production is **available but degraded and frozen**.

---

## How existing fixes should be handled (approved)

| Existing work | Clean-baseline treatment |
| --- | --- |
| Runtime write-path corrections | Recreate in Ansible/systemd provisioning |
| Environment preflight V3 | Adapt and re-land with focused tests |
| Worktree dependency preparation | Adapt after deciding the package-store design |
| Phase 1 contamination gate | Reimplement or copy as a clean isolated module with tests |
| Canonical path-set comparison | Reuse algorithm and tests |
| Pre-token Code Review gate | Re-land |
| Pre-token AI merge gate | Re-land |
| Phase 2 patch-only candidate | Re-land from module behaviour and tests |
| Automatic contaminated-branch recovery | Re-land after patch-only candidate |
| Execution-specific branches | Re-land |
| Deterministic disposition | Re-land after durable execution-state design is approved |
| Retry UI/API lock | Re-land with the disposition contract |
| Release/schema gate | Reimplement as part of the release foundation |
| Activation tooling | Redesign around the final immutable release layout |
| FUSI-007 four-file fix | Reimplement and prove through packaged runtime |
| Surgical production bundle | Retire after the clean release passes acceptance |

---

## Phase 1 programme (authorised only after this record is committed + reviewed)

Deliverables:

1. New clean Appsolino repository branch.
2. Pinned upstream baseline (after packaged-smoke gate).
3. Reproducible build environment.
4. Unmodified upstream package build.
5. Packaged `dist/bin.js` smoke suite.
6. Separate staging database.
7. Recorded upstream failures.
8. **No** Appsolino reliability changes yet.

### Phase 1 exit gate

```text
Clean install: PASS
Source build: PASS
CLI package: PASS
Packaged dashboard start: PASS
Health endpoint: PASS
Task list: PASS
Task show: PASS
Activity feed: PASS
Database migration identity: PASS
Service restart: PASS
```

Only after this gate may Appsolino fixes be added.

---

## Historical options (superseded by approval above)

Prior option lists for OD-BASELINE through OD-ACTIVATE-AUTH are retained in git history of earlier draft versions of this file and in `01-strategic-questions-and-decisions.md` for audit trail. They are no longer open.

## Resolved during planning (non-OD)

| Item | Resolution |
| --- | --- |
| Missing `runtime-identity-report-2026-07-28.md` | Found at `/home/anas/fusion-reliability-hardening/docs/appsolino/runtime-identity-report-2026-07-28.md` |
| Temporal/Restate now? | Deferred; not selected for Phases 0–7 |
| Restrict sudo on dedicated host? | Do not restrict |

## Still missing artefact

| Item | Status |
| --- | --- |
| `activate-fusion-release.sh` | Not found; likely superseded by `fusion-release` v2 — confirm during Phase 3 design |
