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
| **AUTO-3 (OPERATIONAL)** | `upstream-auto3-deploy.yml` + `appsolino-deploy` — immutable Host D build/deploy/rollback |
| **Historical assessment** | `UPSTREAM-ASSESSMENT-2026-07-30.md` numbers are frozen |

## AUTO-2 trust zones

1. **Candidate validate** — checkout PR head; `persist-credentials: false`; no App private key; no merge/comment/label.
2. **Trusted finalize** — checkout Appsolino main (or dispatch ref for proofs); mint App token; recompute risk via `auto2-classify-upstream.mjs`; exact-head `--match-head-commit` merge for **low** only. Sensitive without verified owner review → `approval-required` (no merge).
3. **Trusted approve-sensitive** — `workflow_dispatch` only from trusted main code; independently verifies open `automation/upstream-*` PR, exact `approved_head`, sensitive classification, green checks, and APPROVED review from `Anas966` on that exact commit; then exact-head merge + AUTO-3. Boolean flags are not authorization.

### Prior gap (recorded)

AUTO-2 classified sensitive PRs correctly but had **no implemented trusted post-approval merge path**. `ownerApproved=true` still returned `approval-required` and never merged.

## Local harness

```bash
node --test infra/scripts/__tests__/auto2-classify-upstream.test.mjs
```

Required secrets (finalizer / approve-sensitive / AUTO-1 only):

- `APPSOLINO_AUTOMATION_APP_ID`
- `APPSOLINO_AUTOMATION_APP_PRIVATE_KEY`

App installation must grant: `contents: write`, `pull-requests: write`, `workflows: write`, `actions: write`.

## Current absorb PR

PR #47 — **SENSITIVE / UNMERGED** (AUTO-4 pinned upstream `71576d953626`; supersedes #34). Do not merge until sensitive-approval correction is on main, App permissions work, and owner approves the exact head.
