# Appsolino Fusion Operations

## Repository branches

- `main`: clean mirror of `Runfusion/Fusion` upstream.
- `appsolino/stable`: validated Appsolino production branch.
- `update/upstream-*`: temporary upstream update and validation branches.
- `contrib/*`: isolated changes intended for upstream contribution.

## Git remotes

```text
origin    https://github.com/Anas966/Fusion.git
upstream  https://github.com/Runfusion/Fusion.git
````

Never merge upstream changes directly into `appsolino/stable`.

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

## Update procedure

Synchronize the clean main branch:

```bash
git fetch upstream --prune --tags
git fetch origin --prune

git switch main
git merge --ff-only upstream/main
git push origin main
```

Create an update branch from the current stable version:

```bash
git switch appsolino/stable

UPDATE_BRANCH="update/upstream-$(date +%Y%m%d-%H%M)"
git switch -c "$UPDATE_BRANCH"

git merge --no-ff upstream/main \
  -m "merge: update Fusion from upstream"
```

Do not continue when unresolved conflicts exist:

```bash
git diff --name-only --diff-filter=U
```

## Update validation

```bash
export NODE_OPTIONS="--max-old-space-size=6144"
export FUSION_CLI_FULL_PACKAGE=0
unset CI

pnpm install --frozen-lockfile
pnpm audit --prod
pnpm typecheck
pnpm test:gate
pnpm build
```

A successful `test:gate` may still skip PostgreSQL tests. Always run an
isolated embedded-PostgreSQL runtime test before promotion.

Known excluded deployment paths must be reviewed separately:

* Electron desktop
* WhatsApp plugin

Their audit findings are not automatically safe merely because the server runs
headlessly. Production packaging must exclude unused components.

## Promotion

Promote only after dependency review, typecheck, tests, build, and runtime
health checks pass:

```bash
git push -u origin "$UPDATE_BRANCH"

git switch appsolino/stable
git merge --ff-only "$UPDATE_BRANCH"
git push origin appsolino/stable
```

Create a rollback tag:

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
