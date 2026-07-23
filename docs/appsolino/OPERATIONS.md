# Appsolino Fusion Operations

## Repository branches

- `main`: clean mirror of `Runfusion/Fusion` upstream.
- `appsolino/stable`: validated Appsolino production branch.
- `update/upstream-*`: temporary upstream update and validation branches.
- `contrib/*`: isolated changes intended for upstream contribution.

## Git remotes

```text
origin    https://github.com/Appsolino/Fusion.git
upstream  https://github.com/Runfusion/Fusion.git
```

Never merge upstream changes directly into `appsolino/stable`.

## Automated update cadence

Host automation lives outside the mirrored `main` branch:

`/srv/software-factory/integrations/fusion-update/`

| Timer | Action |
|-------|--------|
| `fusion-mirror-upstream.timer` | Hourly fast-forward `Appsolino/main` ← `Runfusion/main` (no validation) |
| `fusion-daily-candidate.timer` | Daily: at most one pinned `update/upstream-*` PR onto `appsolino/stable` |

Routine human effort should be minutes, even when GitHub CI takes 20–40 minutes.
Do **not** run Cursor-side Python loops that poll GitHub every 30 seconds.

After pushing a candidate:

```bash
gh pr checks <n> --repo Appsolino/Fusion
# or, if you must block a terminal once:
# gh run watch <run-id> --repo Appsolino/Fusion --exit-status
```

### Validation tiers

1. **Tier 1 (fast preflight, ~2–5 min)** — every candidate before push: `git diff --check`, FUS auto-merge preservation tests, static checks for `resolveEffectiveAutoMerge` / `AUTO_MERGE_DISABLED` / `appsolino/stable` CI filter / Appsolino migration registration.
2. **Tier 2 (GitHub merge gate)** — Lint, Typecheck, Build, Gate (including PostgreSQL + boot smoke). Asynchronous.
3. **Tier 3 (release)** — only after required PRs merge: production build, `fn backup --create`, restart, `/api/health`.

Heavy local duplication of full gate/build/runtime (as used for the first large sync / harness fix) is **not** the default for routine updates.

Protected paths that warrant deeper review: `task-merge.ts`, `project-engine.ts`, `merge-runner.ts`, dashboard retry routes, `packages/core/src/postgres/**`, backup code, `.github/workflows/**`, `docs/appsolino/**`, `pnpm-lock.yaml`.

## Check the installed source

```bash
cd /srv/software-factory/source/fusion-appsolino

git status --short --branch
git log -1 --oneline
git describe --tags --always
```

## Start Fusion manually

Fusion must listen only on localhost.

```bash
cd /srv/software-factory/workspaces

HOME=/srv/software-factory/state/fusion-production \
FUSION_SKIP_ONBOARDING=1 \
node /srv/software-factory/source/fusion-appsolino/packages/cli/dist/bin.js \
  serve \
  --host 127.0.0.1 \
  --port 4040 \
  --paused
```

Do not expose port 4040 publicly.

Access it from a workstation through an SSH tunnel:

```bash
ssh -N -L 4040:127.0.0.1:4040 anas@157.173.109.166
```

Then open:

```text
http://127.0.0.1:4040
```

## Health check

```bash
curl -fsS http://127.0.0.1:4040/api/health |
  jq '{status,database,taskIdIntegrity,engine}'
```

Required conditions:

```text
status = ok
database.healthy = true
database.corruptionDetected = false
taskIdIntegrity.status = ok
engine.available = true
```

`database.isRunning=false` is currently not a valid failure indicator.

## Update procedure (manual fallback)

Prefer the hourly mirror + daily candidate timers. Manual mirror:

```bash
/srv/software-factory/integrations/fusion-update/bin/mirror-upstream-main.sh
```

Manual candidate (or emergency / security):

```bash
/srv/software-factory/integrations/fusion-update/bin/create-daily-candidate.sh
```

Pin one upstream SHA per candidate. If upstream moves during validation, do
**not** restart the open candidate — the next daily batch absorbs it.

Do not continue when unresolved conflicts exist:

```bash
git diff --name-only --diff-filter=U
```

## Update validation

**Routine no-conflict update:** Tier 1 locally → push → GitHub CI (Tier 2).

**Conflict-sensitive / protected paths:** Tier 1 plus focused local tests for
touched areas → GitHub CI.

**Migration or infrastructure update:** add disposable PostgreSQL + runtime
smoke before merge/deploy.

**Do not** default to full local `typecheck` + `test:gate` + `build` + clean-clone
repetition on every upstream commit.

Known excluded deployment paths must be reviewed separately:

* Electron desktop
* WhatsApp plugin

Their audit findings are not automatically safe merely because the server runs
headlessly. Production packaging must exclude unused components.

## Promotion

Merge approved update PRs into `appsolino/stable` only after Tier 2 is green
(and Tier 3 prep for release windows). Prefer merging related Appsolino fix PRs
in the same release window, then deploy once.

Create a rollback tag at the deployed SHA:

```bash
TAG="appsolino-fusion-$(date +%Y%m%d)-$(git rev-parse --short HEAD)"

git tag -a "$TAG" \
  -m "Validated Appsolino Fusion release"

git push origin "$TAG"
```

## Rollback

List validated Appsolino tags:

```bash
git tag --list 'appsolino-fusion-*' --sort=-creatordate
```

Restore the source branch to a validated tag only after preserving current
work:

```bash
git switch appsolino/stable
git reset --hard <validated-tag>
git push --force-with-lease origin appsolino/stable
```

Database migrations may require restoring the matching pre-update PostgreSQL
backup. A source rollback alone may not reverse database changes.

## Security rules

* Dashboard binds only to `127.0.0.1`.
* Agents must not belong to the Docker group.
* Agents must not receive production credentials.
* Updates are tested on isolated state before production state.
* Stable releases always receive a rollback tag.
* Appsolino patches remain separate focused commits.
