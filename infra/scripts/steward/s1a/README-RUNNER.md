# Steward S1A — self-hosted analyze runner registration

Live `observe-analyze` runs on labels:

```text
runs-on: [self-hosted, appsolino-fusion]
```

Override with repository variable `S1A_ANALYZE_RUNS_ON` if needed (JSON array string is not required when using the default expression in the workflow).

If no runner with those labels is registered, the live job stays **queued** — that is OK. Do **not** retarget live analyze to `ubuntu-latest` + fixture/deterministic.

## Canonical worktree root

```text
S1A_WORKTREE_ROOT=/srv/appsolino-fusion/phase-1/worktrees
→ repair-<incident-id>
```

Owned/writable by `fusion`. Live fail-closed if this root is missing and `S1A_WORKTREE_ROOT` is unset.

## Register a runner (fusion host)

1. Sign in to GitHub as an Appsolino org admin.
2. Repo **Settings → Actions → Runners → New self-hosted runner** (Linux x64).
3. As `fusion` on the Appsolino fusion host:

```bash
sudo -u fusion bash -lc '
  set -euo pipefail
  mkdir -p /srv/appsolino-fusion/phase-1/actions-runner/s1a
  cd /srv/appsolino-fusion/phase-1/actions-runner/s1a
  # Download the runner tarball URL+token from the GitHub UI “Configure” page, then:
  # ./config.sh --url https://github.com/Appsolino/Fusion \
  #   --token <REGISTRATION_TOKEN> \
  #   --name appsolino-fusion-s1a \
  #   --labels self-hosted,appsolino-fusion \
  #   --work _work \
  #   --unattended
  # sudo ./svc.sh install fusion
  # sudo ./svc.sh start
'
```

4. Confirm labels include `self-hosted` and `appsolino-fusion`.
5. Ensure `cursor-agent` is on PATH for fusion:

```bash
sudo -u fusion bash -lc 'cursor-agent status; which cursor-agent'
# expect: /home/fusion/.local/bin/cursor-agent
```

6. Repo variables / secrets for live:

| Name | Value |
| --- | --- |
| `S1A_WORKTREE_ROOT` | `/srv/appsolino-fusion/phase-1/worktrees` |
| `S1A_AUTO_HANDOFF` | `false` (default) |
| `S1A_CURSOR_API_KEY` or `CURSOR_API_KEY` | optional if interactive login already works |

7. Live dispatch:

```bash
gh workflow run upstream-reliability-steward-s1a.yml \
  -f issue_number=74 -f mode=live -R Appsolino/Fusion
```

## Operator CLI (fusion)

```bash
# Read-only analyze (GITHUB_TOKEN with contents/actions/pull-requests/issues read)
sudo -u fusion bash -lc '
  cd /srv/appsolino-fusion/phase-1/closure/Appsolino-Fusion  # or worktree
  export S1A_ENGINE=cursor-cli S1A_PROVIDER=cursor-cli S1A_MODEL=composer-2.5
  export S1A_WORKTREE_ROOT=/srv/appsolino-fusion/phase-1/worktrees
  export S1A_OUT_DIR=/tmp/s1a-out
  node infra/scripts/steward/s1a/run-s1a-analyze.mjs \
    --issue=74 --repo=Appsolino/Fusion --mode=live --out="$S1A_OUT_DIR"
'

# Write upsert separately (App token with issues:write)
sudo -u fusion bash -lc '
  export GH_TOKEN=...   # App installation token
  node infra/scripts/steward/s1a/run-s1a-upsert.mjs \
    --artifact=/tmp/s1a-out/assessment-artifact.json \
    --repo=Appsolino/Fusion --expect-mode=live
'
```

Never run fixture/deterministic under `--mode=live`.
