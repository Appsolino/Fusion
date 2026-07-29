# Appsolino Fusion Server Master Plan — Executive Summary

Last updated: 2026-07-29
Status: **Phase 0 APPROVED** — Phase 1 clean-baseline authorised only after `15-open-decisions.md` is committed and reviewed; no production activation; no Appsolino reliability re-land until Phase 1 exit gate.
Evidence base: `docs/appsolino/reset/00–06`, verified host/service state, Appsolino/dev source trees, upstream `Runfusion/Fusion` issues, runtime identity report at `/home/anas/fusion-reliability-hardening/docs/appsolino/runtime-identity-report-2026-07-28.md`

## Recommended target

Rebuild Appsolino Fusion as a **dedicated, destroyable Fusion server** running:

1. **Clean pinned upstream baseline** (SHA selected only after packaged-runtime smoke) → Appsolino product fork → **immutable packaged releases**
2. **Ubuntu Server 24.04 LTS + systemd host service** with **bubblewrap task isolation**
3. **Managed external PostgreSQL** for production (+ separate staging DB)
4. **Two-host topology:** Host B (build+staging) + Host P (production)
5. **Hybrid fork model:** `upstream/main` mirror + clean `appsolino/main` (not dirty trees)
6. **Native Fusion coordinator hardened in-tree** (not replaced by Temporal/Restate in Phase 0–7)
7. **Reliability contract:** every task either completes or reaches one durable, actionable terminal state — without losing completed work, duplicating execution, corrupting peers, merging unrelated changes, or looping the same deterministic failure

## Major decisions (APPROVED Phase 0)

| Decision | Approved choice | Failure prevented |
| --- | --- | --- |
| Product identity | Immutable releases; manifest authoritative | Source/build drift on production |
| Schema identity | PostgreSQL migration history authoritative | Binary/schema split-brain |
| Symlink/activation | Must match release manifest | Multiple identity authorities |
| Upstream install | Never direct to production | Unreviewed regressions |
| Baseline | Pinned SHA after packaged smoke — not moving `main` tip | Broken baseline |
| Dirty trees | Reference only — not `appsolino/main` | Contaminated baseline |
| Fork model | Clean `appsolino/main` + integration + release branches | Surgical forever |
| Topology | Host B 16c/64G/500G + Host P 8–16c/32–64G/500G | Undersized single host |
| PostgreSQL | Managed external prod + separate staging DB | Embedded DR/identity risk |
| Prod activate | Human confirmation initially | Bad automatic cutover |
| Release controller | Frozen until new activator passes staging | FAILED_NEEDS_OPERATOR resume |
| FUSI-007 / Phase 2 | Reimplement/re-land — no contaminated cherry-picks | Foreign-commit history |
| Admin model | Full NOPASSWD sudo on dedicated host | Interactive sudo blocking |
| Orchestration | Harden native (no Temporal/Restate yet) | Premature product rewrite |

## Production freeze (until coherent replacement)

DB **0036** / binary **0035**: available but **degraded and frozen** — no new/resumed tasks, no incompatible CLI opens, no migrations, no partial activations, no trusting long-lived dashboard health as compatibility proof.

## Major risks

1. **Schema/binary split already live**: production DB applied migration **0036**; surgical binary ceiling is **0035** — CLI opens fail while long-lived dashboard may still look healthy (`runtime-identity-report-2026-07-28.md`).
2. **Multiple identity authorities**: live symlink, `BUILD_COMPLETE.json`, and release-controller `status.json` disagree (`docs/appsolino/reset/03-production-state-inventory.md`).
3. **Appsolino reliability work is fragmented**: Phase 1 live surgically; Phase 2 / recovery / retry / schema-consistency gates are source-only or uncommitted in `fusion-development`.
4. **FUSI-007 packaged-runtime fix** lives on contaminated branch `fusion/fusi-007` (`4553fd05…`) — cannot be merged as-is.
5. **Upstream is actively changing worktree/lifecycle semantics** (e.g. issue [#2476](https://github.com/Runfusion/Fusion/issues/2476) stale planning base; [#1399](https://github.com/Runfusion/Fusion/issues/1399) event-driven wakeups) — Appsolino patches on `scheduler`/`executor`/`worktree-acquisition` will conflict often.
6. **Current host sizing** (~6 vCPU / 11 GiB / 96 GiB) is tight for Tier 2 multi-agent + builds on one box — topology separation is mandatory before scale.
7. **Full-admin sudo** without recoverability controls can still destroy releases, firewall, or local state — design must make mistakes reversible, not interactive.

## Why this design is reliable (contract, not zero-failure)

Reliability here means **bounded failure**, not absence of failure:

- **One durable execution record** per attempt (`taskId` + `executionId` + generation + stage checkpoints)
- **One lifecycle authority** for transitions; workers are disposable
- **Fenced stage leases** so crash/restart cannot double-dispatch silently
- **Deterministic Git preflight** before any reviewer/merger tokens
- **Task-owned patch merge candidates** (`recorded base + attributed patch`) so branch history cannot smuggle foreign commits
- **Verification manifests** replayed identically across implement / review / merge
- **Retry budgets + failure fingerprints** so `paused → todo → same failure → paused` cannot loop forever
- **Release/schema identity gate** so a binary older than the database cannot serve writes
- **Immutable releases + off-host append-only backups** so the dedicated host can be destroyed and rebuilt

## Explicit non-claims

- This plan does **not** claim zero task failures or zero provider outages.
- Server sizing is an **Appsolino operational recommendation**, not an official Fusion requirement.
- Source-level Vitest success is **not** packaged-runtime proof.
- Existing focused tests for Appsolino gates prove unit behaviour; they do **not** alone prove production readiness.

## Governing document

**`MASTER-PLAN.md`** is the governing project document. Phase 0 approvals are recorded in `15-open-decisions.md`. Phase 1 may start only after that record is committed and reviewed.
