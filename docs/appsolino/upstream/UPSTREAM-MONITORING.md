# Upstream monitoring (Appsolino)

**Status:** Supporting ops note (not a fourth status ledger). Live status: [`../CURRENT-STATE.md`](../CURRENT-STATE.md).
Governing absorb architecture: [`../master-plan/MASTER-PLAN.md`](../master-plan/MASTER-PLAN.md) and [`../OPERATING-MODEL.md`](../OPERATING-MODEL.md).

Last updated: 2026-08-01

## Roles

| Layer | Role |
| --- | --- |
| **Interim detection** | `.github/workflows/upstream-shadow.yml` — observation only |
| **AUTO-1 (OPERATIONAL)** | `upstream-auto1.yml` + `auto1-upstream-sync.mjs` — App identity; `automation/upstream-*` + sync PR; no Host D |
| **AUTO-2 (OPERATIONAL)** | `upstream-auto2-validate.yml` (credential-free) + `upstream-auto2-finalize.yml` (classify / low-risk exact-head merge) + `upstream-auto2-approve-sensitive.yml` (post-approval sensitive merge) |
| **AUTO-3 (OPERATIONAL)** | `upstream-auto3-deploy.yml` + `appsolino-deploy` — immutable Host D build/deploy/rollback; exact `handoff_id` correlation |
| **Historical assessment** | `UPSTREAM-ASSESSMENT-2026-07-30.md` numbers are frozen |

## AUTO-4 catch-up — COMPLETE

| Item | Value |
| --- | --- |
| Pinned upstream | `71576d9536267a7835f352922a55831811717896` |
| PR | #47 merged → `3e6a0ad67262152fc846cc0134a424903f0b4dec` |
| Host D | `auto3-0.74.0-beta.5-3e6a0ad67262` DEPLOYED |
| Mode after | **CONTINUOUS UPSTREAM MAINTENANCE** (do not reopen AUTO-4) |

## Post-catch-up divergence (2026-08-01)

Runfusion/Fusion `main` tip was **ahead by ~15 commits** of the AUTO-4 pin at proof time. After handoff-correlation live proof (PR #52 → AUTO-3 run `30691437372` DEPLOYED with handoff `auto2-30691423651-1-5f1b923bd815-5ccedbe0`), run AUTO-1 once and process **one** incremental `automation/upstream-*` via normal AUTO-2 policy.

## AUTO-2 → AUTO-3 correlation

Trusted waiters generate `handoff_id`, pass `-f handoff_id=…`, and poll only `workflow_dispatch` runs whose run-name contains that id (created after dispatch). Removed unsafe `or .display_title != null` and newest-run fallback (ISS-AUTO-003). **Live proven** on Host D via disposable PR #52.

Regression: `node --test infra/scripts/__tests__/auto3-handoff.test.mjs`

## AUTO-2 trust zones

1. **Candidate validate** — checkout PR head; `persist-credentials: false`; no App private key; no merge/comment/label; no Host D secrets.
2. **Trusted finalize** — checkout Appsolino main (or dispatch ref for proofs); mint App token; recompute risk via `auto2-classify-upstream.mjs`; exact-head `--match-head-commit` merge for **low** only. Sensitive without verified owner review → `approval-required` (no merge).
3. **Trusted approve-sensitive** — `workflow_dispatch` only from trusted main code; independently verifies open `automation/upstream-*` PR, exact `approved_head`, sensitive classification, green checks, and APPROVED review from `Anas966` on that exact commit; then exact-head merge + AUTO-3. Boolean flags are not authorization.

### Prior gap (recorded)

AUTO-2 classified sensitive PRs correctly but had **no implemented trusted post-approval merge path**. `ownerApproved=true` still returned `approval-required` and never merged. (Closed via approve-sensitive workflow.)

## Local harness

```bash
node --test infra/scripts/__tests__/auto2-classify-upstream.test.mjs
node --test infra/scripts/__tests__/auto3-handoff.test.mjs
```

Required secrets (finalizer / approve-sensitive / AUTO-1 only):

- `APPSOLINO_AUTOMATION_APP_ID` (migrate to `vars.APPSOLINO_AUTOMATION_CLIENT_ID` when available — non-blocking)
- `APPSOLINO_AUTOMATION_APP_PRIVATE_KEY`

App installation must grant: `contents: write`, `pull-requests: write`, `workflows: write`, `actions: write`.

## Current absorb PR

None for AUTO-4 (complete). Next absorb is normal continuous AUTO-1 after correlation proof.
