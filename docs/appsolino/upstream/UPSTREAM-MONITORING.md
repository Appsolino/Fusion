# Upstream monitoring (Appsolino)

**Purpose:** Observe Runfusion/Fusion `main` daily without merging it into Appsolino `main`.

Last updated: 2026-07-30

## Two models (do not confuse)

| Model | Branch / PR | What it does | When |
| --- | --- | --- | --- |
| **Shadow monitor (automated)** | Force-updates `upstream-shadow` | Exact tip mirror of `https://github.com/Runfusion/Fusion.git` `main` onto Appsolino `upstream-shadow`. Posts ahead/behind vs Appsolino `main`. | Daily (GitHub Actions) + manual `workflow_dispatch` |
| **Controlled sync (intentional)** | `sync/upstream-YYYY-MM-DD` → PR into `main` | Human-driven fetch/merge, conflict resolution, migration review, Level B/C validation, then merge. | Monthly or when a needed fix/feature/security change justifies the cost |

```text
Runfusion/Fusion main
        │
        │  daily force-push tip only
        ▼
Appsolino upstream-shadow     ← observational; NEVER auto-merged
        │
        │  human opens sync/upstream-YYYY-MM-DD when ready
        ▼
PR → Appsolino main           ← intentional; validated; may rewrite history of the sync branch only
```

## Hard rules

1. **Never auto-merge** upstream into Appsolino `main`.
2. **Never auto-overwrite** Appsolino `main` from the shadow job.
3. The shadow workflow must **not** run `pnpm install`, `pnpm build`, or full CI product suites.
4. Sync remains intentional (see `docs/appsolino/OPERATING-MODEL.md` §3).
5. Treat `upstream-shadow` as a read-only observation tip for diffs and planning — not a deployable Appsolino release line.

## Workflow

Source: `.github/workflows/upstream-shadow.yml`

- Schedule: daily cron.
- Fetches `https://github.com/Runfusion/Fusion.git` `main`.
- Force-pushes that exact tip to Appsolino branch `upstream-shadow`.
- Writes a job summary with upstream SHA and ahead/behind vs Appsolino `main`.

## How to use the shadow tip

```bash
git fetch origin upstream-shadow
git log --oneline origin/main..origin/upstream-shadow | head
git diff --stat origin/main...origin/upstream-shadow | head
```

To start a controlled sync, create `sync/upstream-YYYY-MM-DD` from Appsolino `main`, merge upstream once, resolve conflicts, run the validation required by change risk, and open a PR. Do not promote `upstream-shadow` itself into `main`.

## Related evidence

Point-in-time assessment (2026-07-30): `docs/appsolino/upstream/UPSTREAM-ASSESSMENT-2026-07-30.md`  
Host evidence directory (not in git): `/srv/appsolino-fusion/phase-2a/evidence/upstream-assessment-2026-07-30/`
