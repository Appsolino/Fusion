#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-29-21:45: Assert build/staging separation and production path absence.
set -euo pipefail
fail=0
note() { echo "$1"; }

for p in /opt/appsolino-fusion/production /etc/appsolino-fusion/production /srv/appsolino-fusion/production; do
  if [[ -e "$p" ]]; then note "FAIL production path exists: $p"; fail=1; fi
done

for p in /srv/appsolino-fusion/build /srv/appsolino-fusion/cache/pnpm \
         /opt/appsolino-fusion/staging/releases /etc/appsolino-fusion/staging \
         /srv/appsolino-fusion/staging/state /srv/appsolino-fusion/staging/workspaces \
         /srv/appsolino-fusion/staging/worktrees /srv/appsolino-fusion/staging/logs \
         /srv/appsolino-fusion/staging/backups /run/appsolino-fusion/staging; do
  if [[ ! -d "$p" ]]; then note "FAIL missing path: $p"; fail=1; else note "OK $p"; fi
done

# Build must not equal staging FUSION_HOME
if [[ -f /etc/appsolino-fusion/staging/fusion.env ]]; then
  # shellcheck disable=SC1091
  source /etc/appsolino-fusion/staging/fusion.env
  if [[ "${FUSION_HOME:-}" == /srv/appsolino-fusion/build* ]]; then
    note "FAIL staging FUSION_HOME overlaps build"
    fail=1
  fi
fi

if [[ $fail -ne 0 ]]; then exit 1; fi
echo "HOST_SEPARATION_PASS"
