# Phased Implementation Roadmap

Last updated: 2026-07-29
**Stop:** Phase 0 is **APPROVED** (see `15-open-decisions.md`). Phase 1 coding begins only after that approval record is **committed and reviewed**. Later phases remain gated by prior exit criteria. Production remains degraded/frozen until a coherent replacement.

## Phase 0 — Strategic decisions
- **Objective:** Lock fork model, topology, tools, reliability targets.
- **Status:** **COMPLETE / APPROVED** 2026-07-29 — binding record in `15-open-decisions.md`.
- **Remaining before Phase 1 coding:** commit + review that approval record.
- **Acceptance:** Written Phase 0 Decision Approval present; production freeze posture documented.
- **Rollback:** N/A (docs only).
- **Complexity:** small
- **Upstream overlap:** monitor only

## Phase 1 — Clean upstream baseline
- **Objective:** Prove **unchanged** upstream builds and packaged runtime on Host B (or isolated build env). **No Appsolino reliability changes.**
- **Tasks:** Evaluate candidate upstream SHAs against packaged-smoke gate; pin winner; clean `appsolino/main` from pin; reproducible build env; unmodified package build; packaged `dist/bin.js` smoke (health, task list/show, activity feed, migration identity, service restart); separate staging DB; catalogue upstream failures.
- **Dependencies:** Phase 0 approval record **committed and reviewed**.
- **Forbidden in Phase 1:** re-land contamination gates, Phase 2 patch candidate, FUSI-007 product fix, workflow restructuring, multi-agent features.
- **Risks:** Node image vs host mismatch — record in baseline record; newest upstream may fail smoke → pick earlier known-good or minimal build patch only.
- **Acceptance / exit gate:**

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

Plus baseline record fields (repo, SHA, tag, lockfile hash, Node, pnpm, date, smoke result).
- **Rollback:** Delete build trees only; production remains frozen surgical pin.
- **Complexity:** medium
- **Upstream overlap:** yes — document only

## Phase 2 — Infrastructure foundation
- **Objective:** Env A/B/C separation, provisioning, PG, backup, monitoring skeleton.
- **Tasks:** Ansible+cloud-init; filesystem layout; sudo; bubblewrap; external PG; off-host backup; OTel/Prom skeleton.
- **Dependencies:** Phase 0 topology/`OD-PG`.
- **Risks:** Co-locating stage+prod again.
- **Acceptance:** Rebuild Host B from zero; staging unit healthy on isolated DB; backup dry-run; `sudo -n` OK.
- **Rollback:** Destroy VMs; preserve artefacts elsewhere.
- **Complexity:** large
- **Upstream overlap:** low

## Phase 3 — Release integrity
- **Objective:** Manifest, schema gate, packaged tests, atomic activation, migration policy.
- **Tasks:** Implement/adapt `release-schema-consistency`; activator; packaged FUSI-007 proofs; staging migrate drills.
- **Dependencies:** Phases 1–2.
- **Risks:** Live 0035/0036 split — production cutover must use coherent ≥0036 release.
- **Acceptance:** ACC-REL-* pass on staging; identity disagreement impossible under activator.
- **Rollback:** Previous schema-compatible artefact.
- **Complexity:** large
- **Upstream overlap:** medium (schema-applier)

## Phase 4 — Git safety
- **Objective:** Execution branches, provenance, contamination gate, patch-only candidate, reconstruction.
- **Tasks:** Re-land Phase 1–3 Appsolino modules cleanly; contribute prep; retire surgical overlay after promote.
- **Dependencies:** Phase 3 (trusted package path).
- **Risks:** Conflict with upstream worktree changes (#2476/#2211).
- **Acceptance:** ACC-GIT-* ; surgical release retired.
- **Rollback:** Re-activate prior packaged release (not surgical if avoidable).
- **Complexity:** large
- **Upstream overlap:** high

## Phase 5 — Workflow reliability
- **Objective:** Durable execution record; one lifecycle authority; leases; checkpoints; deterministic retries.
- **Tasks:** Narrow self-healing; durable merge leases replacing `mergeActive` authority; disposition wired everywhere; Retry lock.
- **Dependencies:** Phase 4.
- **Risks:** Large executor/scheduler conflicts.
- **Acceptance:** ACC-EXE-* ACC-REC-*; no deterministic loop in soak.
- **Rollback:** Feature flags off; prior release.
- **Complexity:** programme-level
- **Upstream overlap:** very high — sync often

## Phase 6 — Verification integrity
- **Objective:** Manifest recording, exact replay, process cancellation, production-shaped tests.
- **Dependencies:** Phase 5.
- **Acceptance:** ACC-VER-*.
- **Complexity:** medium–large
- **Upstream overlap:** medium (#2180)

## Phase 7 — Provider and operational resilience
- **Objective:** Gateway/failover, cost budgets, event-driven wakeups, full observability/alerts.
- **Dependencies:** Phase 5–6; track upstream #1399/#2181.
- **Acceptance:** ACC-PRV-*; ACC-OPS-* backup/restore; ops view live.
- **Complexity:** large
- **Upstream overlap:** high on wakeups/budgets

## Phase 8 — Controlled multi-agent scale
- **Objective:** Task DAG, parallel ownership, patch integration, concurrency benchmarks.
- **Dependencies:** Phases 4–7 green on Tier sizing.
- **Acceptance:** Tier 2 soak without fingerprint storms; worktree GC stable.
- **Complexity:** programme-level
- **Upstream overlap:** #2186 symbol locking

## Sequencing diagram

```text
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
         ↘ monitoring skeleton early
```

## Global stop conditions

- Open decision unresolved that blocks topology or baseline
- Upstream mid-rewrite of coordinator making Appsolino leases wasteful → pause Phase 5, escalate
- External orchestration tool selected → stop native Phase 5 redesign until revisited
- Packaged runtime still red → **do not** expand Git/workflow scope on surgical pins

## Phase gates (measurable)

| Gate | Metric |
| --- | --- |
| G0 | Phase 0 Decision Approval committed + reviewed |
| G1 | Upstream pin packaged smoke (Phase 1 exit gate) |
| G2 | Rebuild + backup dry-run |
| G3 | ACC-REL 100% |
| G4 | ACC-GIT 100% + surgical retired |
| G5 | ACC-EXE/REC 100% on staging soak ≥7 days |
| G6 | ACC-VER 100% |
| G7 | ACC-PRV/OPS 100% |
| G8 | Tier-N concurrency report signed |
