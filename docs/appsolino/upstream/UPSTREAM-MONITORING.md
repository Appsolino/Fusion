# Upstream monitoring (Appsolino)

**Status:** Supporting ops note (not a fourth status ledger). Live status: [`../CURRENT-STATE.md`](../CURRENT-STATE.md).
Governing absorb architecture: [`../master-plan/MASTER-PLAN.md`](../master-plan/MASTER-PLAN.md) and [`../OPERATING-MODEL.md`](../OPERATING-MODEL.md).

Last updated: 2026-07-31

## Roles

| Layer | Role |
| --- | --- |
| **Interim detection** | `.github/workflows/upstream-shadow.yml` (**Upstream Monitor**): daily + dispatch; `contents: read`; fetch upstream; job summary (SHAs, merge-base, ahead/behind); **no** branch create/update, push, pnpm, build, or secrets |
| **AUTO-1…AUTO-3 (target)** | Integration branch + risk-gated PR + Host D release — see CURRENT-STATE for implementation status |
| **Historical assessment** | `UPSTREAM-ASSESSMENT-2026-07-30.md` numbers are frozen; do not rewrite them when policy changes |

## Rejected approach

Exact-tip force-push to `upstream-shadow` failed (run `30601438029`) when upstream history touches `.github/workflows/*`. Do not bypass with owner OAuth/PAT in the job. Durable automation uses a dedicated GitHub App (MASTER-PLAN).

## Local inspect

```bash
git fetch https://github.com/Runfusion/Fusion.git main
git log --oneline origin/main..FETCH_HEAD | head
```
