# Strategic Questions and Decisions

Last updated: 2026-07-29
Status: **Phase 0 APPROVED** — see `15-open-decisions.md` for the binding approval record.
Legend: **Accepted** = standing operator decision; **Approved (Phase 0)** = closed by 2026-07-29 approval; **Phase 1** = exact value selected during baseline evaluation

## 1. Product and reliability scope

| Question | Answer | Status |
| --- | --- | --- |
| What is the reliability contract? | Every task succeeds or reaches one durable actionable terminal state without losing completed work, duplicating execution, corrupting peers, merging unrelated changes, or looping the same deterministic failure | Accepted |
| Preserve old tasks/worktrees/DB/logs? | No | Accepted |
| Preserve engineering lessons / issue register? | Yes — permanent | Accepted |
| Production runs clean source-built release? | Yes — surgical overlays are temporary only | Accepted |
| Upstream direct-to-production installs? | Forbidden | Accepted |
| Current production posture? | Degraded and frozen (DB 0036 / binary 0035) — see `15-open-decisions.md` | Approved (Phase 0) |

## 2. Fork and upstream strategy

| Question | Decision | Status |
| --- | --- | --- |
| Fork model? | Hybrid: clean `appsolino/main` + plugins + host automation | Approved (Phase 0) |
| Baseline cut? | Pin upstream commit **only after** unchanged packaged-runtime smoke; not moving `main` tip; exact SHA in Phase 1 | Approved (Phase 0) / Phase 1 |
| Dirty `fusion-development` / `fusion-appsolino`? | Reference only — must not become `appsolino/main` | Approved (Phase 0) as OD-DIRTY-TREES |
| FUSI-007? | Reimplement four-file fix + tests; no contaminated cherry-pick | Approved (Phase 0) |
| Phase 2 modules? | Re-land from invariants/modules/tests; not contaminated history | Approved (Phase 0) |

## 3. Server architecture

| Question | Decision | Status |
| --- | --- | --- |
| Dedicated Fusion server? | Yes | Accepted |
| Unrestricted passwordless sudo? | Yes on dedicated host | Accepted |
| Host may be destroyed/rebuilt? | Yes | Accepted |
| OS / process model? | Ubuntu 24.04; systemd Fusion; bubblewrap tasks | Approved (Phase 0) |
| Topology? | Host B (16c/64G/500G build+staging) + Host P (8–16c/32–64G/500G prod) | Approved (Phase 0) |
| PostgreSQL? | Managed external prod + separate staging DB same major/class | Approved (Phase 0) |

## 4. Release and schema

| Question | Decision | Status |
| --- | --- | --- |
| Authoritative identity? | Release manifest (release); PG migration history (schema); symlink + activation must match manifest | Approved (Phase 0) |
| Release controller? | Freeze; replace/reactivate only after new system passes staging | Approved (Phase 0) |
| Production activate/migrate? | Explicit human confirmation initially | Approved (Phase 0) |

## 5. Control-plane / external tools

Unchanged from plan recommendations (harden native coordinator; defer Temporal/Restate; wrap providers later). See `08-component-keep-wrap-replace-matrix.md`.

## 6. Implementation gate

| Gate | Rule |
| --- | --- |
| After Phase 0 approval record committed + reviewed | Phase 1 clean baseline + unchanged upstream packaged smoke **only** |
| After Phase 1 exit gate | Appsolino fixes may be re-landed per approved treatment table in `15-open-decisions.md` |
| Never in Phase 1 | Contamination Phase 1/2 re-land, FUSI-007 product re-land, workflow restructuring, multi-agent scale |
