# Appsolino operating model (personal project)

Last updated: 2026-07-30

Optimise for:

1. Fast development
2. Protect irreplaceable data
3. Rebuild the system when a server is lost

Everything else is proportionate to actual risk. This is not an enterprise compliance programme.

## Hard requirements (always)

1. Secrets never go into Git or normal logs.
2. Production data is backed up before migrations or risky deployments.
3. Production deployments use a known package/version.
4. A failed deployment must not destroy the previous working release.
5. Development agents must not modify production accidentally.
6. We must know how to rebuild a server and restore the data.

## Philosophy

```text
Build infrastructure from code.
Back up irreplaceable data.
Regenerate everything else.
Run small tests frequently.
Run expensive tests only when their risk applies.
Synchronise upstream intentionally, not continuously.
```

## Validation levels

| Level | When | Target |
| --- | --- | --- |
| **A — Fast** | Most feature branches | Under ~10 minutes: format/typecheck/unit tests for changed packages; shell/Ansible syntax when those change; `git diff --check` |
| **B — Integration** | Executable, DB, infra, or service changes | Under ~30 minutes where practical: relevant builds, staging start/health, one basic task op, restart |
| **C — Release** | Preparing a version that may reach production | Frozen install, full build/package, staging smoke, migration check, DB backup (+ restore if migrations changed), release identity/hashes, deploy/rollback |

A normal task must **not** automatically trigger clean dependency install, `build:full`, `build:exe`, backup/restore, full staging rebuild, clean Ubuntu rebuild, or full ACC suites.

Suggested future wrappers (call existing package commands; do not invent a large framework):

```text
pnpm check:fast
pnpm check:integration
pnpm check:release
```

## Daily development

```text
Appsolino main → small feature branch → change → relevant tests → quick smoke → merge
```

| Change type | Expected validation |
| --- | ---: |
| Documentation only | 1–3 minutes |
| Small script/config | 3–10 minutes |
| Isolated application change | 5–15 minutes |
| Packaging/runtime change | 15–30 minutes |
| Full release | Longer, infrequent |

### Branch / PR policy

- **Lightweight / direct merge OK:** docs, comments, harmless ops text, small non-production scripts, test-only fixes — after fast validation and a reviewed diff with no production impact.
- **PR required:** product source, migrations, systemd, backup/restore, deployment, auth/secrets, production config, upstream sync.

PRs remain useful for one person (clear diff, Cursor review, history). No two-person enterprise approval chain.

## Upstream synchronisation

Pinned baseline (do not move on every feature):

```text
b85a5d4531df8fa749d77bf85ea4ab9ab960ce86
```

Continue from Appsolino `main`. Sync upstream only when needed (feature, important fix, scheduled update, or intentional refresh). Reasonable cadence: **manual or about monthly**, not before every task.

```text
Appsolino main → upstream-sync/YYYY-MM → fetch/merge upstream once → resolve once
→ full app tests → packaged staging smoke → merge to main
```

Enable `git rerere` so repeated conflict resolutions are remembered.

Keep Appsolino-specific changes small, isolated, well named, and covered by focused tests.

## Build rules

- Prefer shared store `/srv/appsolino-fusion/cache/pnpm/` and `pnpm install --frozen-lockfile --prefer-offline`.
- Clean/full installs only for release validation, upstream sync, or suspected corruption.
- Docs / Ansible / backup / monitoring scripts: no Fusion product build unless product code changed.
- **Build once, hash, test that artifact, deploy that same artifact.**

## What to back up

**Must (production-focused):**

- Production PostgreSQL (schema + data + migration history)
- User files outside Postgres, if any
- Encrypted secrets/config (separate from the server; never plaintext in Git)
- Source/infra in GitHub (primary off-host copy)
- Small release-identity record with the associated DB backup

**Optional:** latest one or two production release packages for quick rollback.

**Do not back up off-host:** `node_modules`, pnpm cache, build/tmp dirs, worktrees, development/staging/test DBs, OS packages, downloadable deps, temporary logs, Cursor working dirs, rebuildable artefacts, Phase 1 candidate trees.

**Logs:** 7–14 days local; keep longer only for real production incidents.

### Production backup schedule (practical)

- Daily DB: retain 7
- Weekly DB: retain 4
- Always before deployment/migration
- Restore test: before first production launch; after significant migrations; monthly/quarterly; after backup-script or storage-provider changes — not every backup

## Recovery (the real requirement)

```text
New Ubuntu → cloud-init/Ansible → clone Appsolino/Fusion → restore secrets
→ install selected package → empty production DB → restore dump
→ restore uploads if any → start Fusion → verify version/health/migrations
```

Do not recover old staging state, caches, worktrees, or rebuildable artefacts.

## Reinterpreting Phase 2A `NOT PROVEN` items

| Item | Meaning now |
| --- | --- |
| Off-host backup | Required **before production**; protect production DB/files/secrets (+ optional package) — not staging evidence dumps |
| Clean rebuild | Prove **once before production** (and after major provisioning / OS changes) — not every PR |
| Real Fusion engine-child path | Required before **autonomous host-admin**; not required to block ordinary app/staging/packaging work. Until proven, autonomous root/admin stays disabled or manual |

## Current status (2026-07-30)

```text
PR #10: MERGED (6caca1ec…)
Phase 2A: PARTIAL — staging foundation usable
Off-host backup: required before production only
Clean rebuild: required once before production
Engine-child admin proof: required before autonomous admin tasks
Daily development: fast targeted validation
Full validation: release-only
Upstream sync: scheduled/manual
Production: DEGRADED / FROZEN (untouched)
```
