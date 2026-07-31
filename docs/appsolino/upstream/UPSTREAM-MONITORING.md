# Upstream monitoring (Appsolino)

**Status:** Supporting ops note (not a fourth status ledger). Live status: [`../CURRENT-STATE.md`](../CURRENT-STATE.md).
Governing absorb architecture: [`../master-plan/MASTER-PLAN.md`](../master-plan/MASTER-PLAN.md) and [`../OPERATING-MODEL.md`](../OPERATING-MODEL.md).

Last updated: 2026-07-31

## Roles

| Layer | Role |
| --- | --- |
| **Interim detection** | `.github/workflows/upstream-shadow.yml` (**Upstream Monitor**): daily + dispatch; `contents: read`; fetch upstream; job summary (SHAs, merge-base, ahead/behind); **no** branch create/update, push, pnpm, build, or secrets |
| **AUTO-1 (OPERATIONAL)** | `.github/workflows/upstream-auto1.yml` on main. Live App-identity proven: `create-github-app-token@v3`, `gh auth setup-git`, `git ls-remote` probe, push + PR as `appsolino-fusion-automation[bot]`. Idempotent same-tip pair → PR #34 (`automation/upstream-73bff5f88cf2`). Do **not** merge absorb PRs until AUTO-2/AUTO-3. |
| **AUTO-2…AUTO-3 (target)** | Risk classify, package, Host D immutable release — not AUTO-1 |
| **Historical assessment** | `UPSTREAM-ASSESSMENT-2026-07-30.md` numbers are frozen; do not rewrite them when policy changes |

## Rejected approach

Exact-tip force-push to `upstream-shadow` failed (run `30601438029`) when upstream history touches `.github/workflows/*`. Do not bypass with owner OAuth/PAT in the job. Durable automation uses a dedicated GitHub App (MASTER-PLAN).

## AUTO-1 local harness

```bash
node --test infra/scripts/__tests__/auto1-upstream-sync.test.mjs
node infra/scripts/auto1-upstream-sync.mjs --repo-dir "$PWD" --json
```

Required GitHub Actions secrets (routine identity):

- `APPSOLINO_AUTOMATION_APP_ID`
- `APPSOLINO_AUTOMATION_APP_PRIVATE_KEY`

## Local inspect

```bash
git fetch https://github.com/Runfusion/Fusion.git main
git log --oneline origin/main..FETCH_HEAD | head
```
