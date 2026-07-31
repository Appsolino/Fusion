# Upstream monitoring (Appsolino)

**Status:** Supporting ops note (not a fourth status ledger). Live status: [`../CURRENT-STATE.md`](../CURRENT-STATE.md).
Governing absorb architecture: [`../master-plan/MASTER-PLAN.md`](../master-plan/MASTER-PLAN.md) and [`../OPERATING-MODEL.md`](../OPERATING-MODEL.md).

Last updated: 2026-07-31

## Roles

| Layer | Role |
| --- | --- |
| **Interim detection** | `.github/workflows/upstream-shadow.yml` — observation only |
| **AUTO-1 (OPERATIONAL)** | `upstream-auto1.yml` + `auto1-upstream-sync.mjs` — App identity; `automation/upstream-*` + sync PR; no Host D |
| **AUTO-2 (OPERATIONAL)** | `upstream-auto2-validate.yml` (credential-free candidate checks) + `upstream-auto2-finalize.yml` (trusted classify/labels/exact-head low-risk merge). Sensitive → `auto2:approval-required`. Never Host D |
| **AUTO-3 (NEXT)** | Immutable Host D package/deploy/rollback |
| **Historical assessment** | `UPSTREAM-ASSESSMENT-2026-07-30.md` numbers are frozen |

## AUTO-2 trust zones

1. **Candidate validate** — checkout PR head; `persist-credentials: false`; no App private key; no merge/comment/label.
2. **Trusted finalize** — checkout Appsolino main (or dispatch ref for proofs); mint App token; recompute risk via `auto2-classify-upstream.mjs`; exact-head `--match-head-commit` merge for **low** only.

## Local harness

```bash
node --test infra/scripts/__tests__/auto1-upstream-sync.test.mjs
node --test infra/scripts/__tests__/auto2-classify-upstream.test.mjs
```

Required secrets (finalizer / AUTO-1 only):

- `APPSOLINO_AUTOMATION_APP_ID`
- `APPSOLINO_AUTOMATION_APP_PRIVATE_KEY`

## Current absorb PR

PR #34 — **SENSITIVE / UNMERGED** (do not auto-merge; AUTO-4 backlog after AUTO-3).
