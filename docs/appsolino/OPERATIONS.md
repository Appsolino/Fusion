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

## Architecture (unattended release)

Host automation lives outside the mirrored `main` branch:

`/srv/software-factory/integrations/fusion-update/`

```text
mirror (hourly) → daily/security candidate (pinned SHA)
                 → release-controller timer (every 5 min, one transition)
                 → CI_PENDING…READY_TO_MERGE → merge (exact head)
                 → build immutable release dir → backup → drain → deploy
                 → verify → COMPLETED | automatic rollback
```

State machine file:

`/srv/software-factory/integrations/fusion-update/state/release-state.json`

Sanitized status (no secrets):

`/srv/software-factory/integrations/fusion-update/state/status.json`

Lock:

`/run/lock/appsolino-fusion-release.lock` (falls back under `state/` if needed)

Activation flag (must stay `0` until final review):

`FUSION_AUTO_RELEASE_ENABLED` in `env/release-controller.env`

## Timers

| Timer | Action |
|-------|--------|
| `fusion-mirror-upstream.timer` | Hourly fast-forward `Appsolino/main` ← `Runfusion/main` (no validation) |
| `fusion-daily-candidate.timer` | Daily: at most one pinned `update/upstream-*` PR onto `appsolino/stable` |
| `fusion-release-controller.timer` | Every 5 minutes: one bounded state transition (CI check / merge / build / deploy / rollback) |

Quick commands:

```bash
systemctl list-timers 'fusion-*'
systemctl status fusion-release-controller.service
journalctl -u fusion-release-controller.service -n 100 --no-pager
cat /srv/software-factory/integrations/fusion-update/state/status.json
/srv/software-factory/integrations/fusion-update/bin/release-controller.sh --dry-run
```

Routine successful updates require **zero** operator interaction once
`FUSION_AUTO_RELEASE_ENABLED=1`. Do **not** run Cursor-side loops that poll GitHub.

## State machine

States: `IDLE` → `CANDIDATE_OPEN` → `CI_PENDING` → `READY_TO_MERGE` → `MERGED` →
`BUILDING` → `READY_TO_DEPLOY` → `DEPLOYING` → `VERIFYING` → `COMPLETED` → `IDLE`

Failure / control states: `CI_FAILED`, `DEFERRED`, `ROLLBACK_REQUIRED`,
`ROLLING_BACK`, `FAILED_NEEDS_OPERATOR`

Each systemd invocation obtains the lock non-blockingly, performs **at most one**
transition, saves state atomically, and exits. CI waits are spread across timer
ticks (no 30-minute polling loop).

## Automatic merge rules

Merge into `appsolino/stable` only when all hold:

- PR `OPEN`, not draft
- `MERGEABLE` and clean enough (not `DIRTY`)
- Head OID equals recorded `expectedCandidateHead` (exact-head protection)
- Base is `appsolino/stable`
- Required checks exactly successful: **Lint**, **Typecheck**, **Build**, **Gate**
- No unresolved review threads
- Appsolino preservation checks pass
- Migration policy allows merge
- `FUSION_AUTO_RELEASE_ENABLED=1`
- **Never** `--admin`

Merge method: GitHub `merge` (merge commit) to preserve upstream history on update branches.

## Migration classifications

| Class | Action |
|-------|--------|
| `NO_MIGRATIONS` | Normal automatic path |
| `ADDITIVE_MIGRATIONS` | Disposable Postgres rehearsal, then continue |
| `DESTRUCTIVE_OR_UNKNOWN_MIGRATIONS` | `FAILED_NEEDS_OPERATOR` — do not merge/deploy |

## Deployment flow

1. Build exact merged SHA into `/srv/software-factory/releases/fusion/<sha>/`
2. Write `APPSOLINO_RELEASE.json` provenance
3. Offline/static checks on the release directory
4. Production backup as user `fusion` with `FUSION_HOME`
5. Drain: defer when tasks are actively executing (in-progress / running agents)
6. Atomically switch `/srv/software-factory/current/fusion`
7. Restart `fusion.service`
8. Verify health contract (≤ ~90s): service active, `/api/health` ok, DB healthy,
   taskIdIntegrity ok, engine available, portal reachable, APP-002 untouched

Retain at least three validated releases; never delete active or immediately previous.

## Rollback

On verification failure:

1. Capture logs/health evidence under `state/failure-*.log`
2. Stop failed service
3. Restore previous release symlink
4. Restore pre-deploy backup when migrations may have changed the DB
5. Restart previous release and re-verify
6. Mark `FAILED_NEEDS_OPERATOR` and send **one** PR comment/notification

If rollback itself fails → highest-severity operator state; no further auto retries.

## Managed-source update UX

Environment:

```bash
FUSION_MANAGED_SOURCE=appsolino
FUSION_MANAGED_SOURCE_STATUS=/srv/software-factory/integrations/fusion-update/state/status.json
```

In this mode:

- Dashboard **Update now** / global `npm install` is disabled
- Banner: “Updates are managed automatically by Appsolino.”
- Footer distinguishes Appsolino release SHA / provenance from the npm version
- `fn update` refuses to replace the managed source build and points at status.json

Do not fake a stable npm version solely to suppress the banner.

## Status inspection

```bash
cat /srv/software-factory/integrations/fusion-update/state/status.json
/srv/software-factory/integrations/fusion-update/bin/release-controller.sh --status
```

Fields include deployed SHA, mirrored upstream SHA, candidate PR, CI/state,
last success/failure. No secrets.

## Manual emergency pause

```bash
# Stop controller timer
sudo systemctl stop fusion-release-controller.timer

# Or disable mutations without stopping CI observation
sudo sed -i 's/^FUSION_AUTO_RELEASE_ENABLED=.*/FUSION_AUTO_RELEASE_ENABLED=0/' \
  /srv/software-factory/integrations/fusion-update/env/release-controller.env
```

Clear operator-required state only after remediation:

```bash
jq '.state="IDLE" | .lastError=null | .operatorNotified=false' \
  /srv/software-factory/integrations/fusion-update/state/release-state.json \
  > /tmp/rs.json && mv /tmp/rs.json \
  /srv/software-factory/integrations/fusion-update/state/release-state.json
```

## Disabling automation

```bash
sudo systemctl disable --now fusion-release-controller.timer
sudo systemctl disable --now fusion-daily-candidate.timer
# Keep mirror if desired:
# sudo systemctl disable --now fusion-mirror-upstream.timer
```

## Dry run

```bash
/srv/software-factory/integrations/fusion-update/bin/release-controller.sh --dry-run
```

Shows candidate, expected merge head, migration class, deploy/rollback plan.
Does **not** modify GitHub, systemd, source, database, or state.

## Validation tiers

1. **Tier 1 (fast preflight, ~2–5 min)** — every candidate before push
2. **Tier 2 (GitHub merge gate)** — Lint/Typecheck/Build/Gate (authoritative)
3. **Tier 3 (release)** — one production release build after merge + backup + health

Do not repeat full local gate/clean-clone for every routine update.

## Issue reconciliation

See [ISSUE-RECONCILIATION.md](./ISSUE-RECONCILIATION.md). Incremental by default;
full weekly or when protected paths are touched.

## Check the installed source

```bash
# After release-directory activation:
readlink -f /srv/software-factory/current/fusion
git -C /srv/software-factory/current/fusion log -1 --oneline

# Current (pre-activation) production source tree:
cd /srv/software-factory/source/fusion-appsolino
git status --short --branch
git log -1 --oneline
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

## Update procedure (manual fallback)

Prefer timers + controller. Manual mirror / candidate:

```bash
/srv/software-factory/integrations/fusion-update/bin/mirror-upstream-main.sh
/srv/software-factory/integrations/fusion-update/bin/create-daily-candidate.sh
```

Pin one upstream SHA per candidate. If upstream moves during validation, do
**not** restart the open candidate — the next batch absorbs it.

## Activation (final review only)

After tests + disposable rehearsal:

```bash
# 1) Install/enable units (if not already)
sudo /srv/software-factory/integrations/fusion-update/bin/install-units.sh

# 2) Seed current symlink to today's production tree (no restart yet)
sudo ln -sfn /srv/software-factory/source/fusion-appsolino /srv/software-factory/current/fusion

# 3) Install fusion.service drop-in + managed-source env, then restart in a window
#    (ONLY when ready — not part of implementation)
# sudo cp .../fusion.service.d-30-release-current.conf \
#   /etc/systemd/system/fusion.service.d/30-release-current.conf
# Add FUSION_MANAGED_SOURCE=appsolino to /etc/fusion/fusion.env
# sudo systemctl daemon-reload && sudo systemctl restart fusion.service

# 4) Enable mutations
sudo sed -i 's/^FUSION_AUTO_RELEASE_ENABLED=.*/FUSION_AUTO_RELEASE_ENABLED=1/' \
  /srv/software-factory/integrations/fusion-update/env/release-controller.env
```

Exact activation command (mutations only):

```bash
sudo sed -i 's/^FUSION_AUTO_RELEASE_ENABLED=.*/FUSION_AUTO_RELEASE_ENABLED=1/' \
  /srv/software-factory/integrations/fusion-update/env/release-controller.env
```

## Security rules

* Dashboard binds only to `127.0.0.1`.
* Agents must not belong to the Docker group.
* Agents must not receive production credentials.
* Updates are tested on isolated state before production state.
* Stable releases always receive rollback tags / retained release dirs.
* Appsolino patches remain separate focused commits.
* Automation scripts should be root-owned after install; env files mode `0600`.
* Narrow sudoers: `sudoers/appsolino-fusion-release` (systemctl fusion + runuser fusion only).
* Never install `@runfusion/fusion` globally on this host for production.
* Never use admin merge bypass.

## Tests

```bash
/srv/software-factory/integrations/fusion-update/tests/run-tests.sh
```

Uses disposable directories and fake `gh` fixtures. Does not touch production.
