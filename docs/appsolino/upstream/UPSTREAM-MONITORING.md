# Upstream monitoring (Appsolino)

**Purpose:** Detect Runfusion/Fusion `main` movement and eventually drive automated absorb into Appsolino `main`. Permanent exact-tip `upstream-shadow` mirroring is **not** the absorb process.

Last updated: 2026-07-31

## Governing principle

> Automate routine development completely. Require human approval only when automation detects high risk, or before production activation.

Full architecture: `docs/appsolino/master-plan/04-fork-and-upstream-update-strategy.md` and `docs/appsolino/OPERATING-MODEL.md` §3.

## Status

```text
Automated upstream integration: REQUIRED / NOT IMPLEMENTED
Automated Host D release: REQUIRED / NOT IMPLEMENTED
Interim workflow: read-only detection / observation only
upstream-shadow exact-tip mirror: REJECTED (failed run 30601438029)
Host P / production automation: NO
```

## Two models (do not confuse)

| Model | Branch / PR | What it does | When |
| --- | --- | --- | --- |
| **Detection / observation (interim automated)** | None — job summary only | Fetches `https://github.com/Runfusion/Fusion.git` `main`; records SHAs, merge-base, ahead/behind vs Appsolino `main`. Does **not** create or update any Appsolino branch. | Daily + `workflow_dispatch` until AUTO-D.1 lands |
| **Automated absorb (target)** | `automation/upstream-*` → sync PR → `main` | `git merge --no-ff`, risk classification, Correction A/B tests, package + staging candidate, safe auto-merge or one owner approval, then Host D immutable release | REQUIRED / NOT IMPLEMENTED |

```text
Runfusion/Fusion main
        │
        │  scheduled fetch + compare (interim)
        ▼
GitHub Actions job summary     ← observational; no Appsolino refs updated
        │
        │  AUTO-D.1 (future): automation/upstream-* + sync PR
        ▼
Appsolino main → AUTO-D.2 Host D release → a.anas.bz
```

## Why exact-tip `upstream-shadow` was abandoned

Force-pushing upstream `main` onto Appsolino `upstream-shadow` failed when the upstream tip modifies `.github/workflows/*`: the default Actions credential cannot push workflow-file changes (failed run `30601438029`). Appsolino does **not** add a PAT, OAuth token, deploy key, or GitHub App token to bypass that restriction, and does **not** import upstream workflow files. A permanent mirror branch is unnecessary anyway — the workflow can fetch the upstream remote directly.

## Hard rules

1. **Never** auto-deploy to Host P or place production secrets on Host D.
2. Interim monitor **must not** create/update any Appsolino branch (including `upstream-shadow`).
3. Interim monitor **must not** run `pnpm install`, `pnpm build`, or full product CI.
4. Full absorb (when implemented) uses `merge --no-ff` on `automation/upstream-*`, risk gates, and one sync PR — not unbounded duplicate PRs.
5. Appsolino `main` is never force-updated from a raw upstream tip without the absorb pipeline.

## Interim workflow

Canonical Actions path: `.github/workflows/upstream-shadow.yml` (workflow name: **Upstream Monitor**)

- Schedule: daily cron + `workflow_dispatch`.
- Permissions: `contents: read` only.
- Fetches upstream `main` (no pnpm / no build / no push / no secrets).
- Records upstream SHA, Appsolino `main` SHA, merge-base, ahead count, and behind count in the job summary.
- Sets `Repository refs updated | NO`.

## How to inspect upstream locally

```bash
git fetch https://github.com/Runfusion/Fusion.git main
git log --oneline origin/main..FETCH_HEAD | head
git diff --stat origin/main...FETCH_HEAD | head
```

Do **not** start a multi-hundred-commit manual catch-up as the standing process. Once AUTO-D.1 exists, automation performs the merge/test/build work; sensitive classifications wait for one owner approval.

## Related evidence

Point-in-time assessment (2026-07-30): `docs/appsolino/upstream/UPSTREAM-ASSESSMENT-2026-07-30.md`  
Host evidence directory (not in git): `/srv/appsolino-fusion/phase-2a/evidence/upstream-assessment-2026-07-30/`

Do not modify the historical 2026-07-30 assessment numbers in that document when updating this monitoring policy.
