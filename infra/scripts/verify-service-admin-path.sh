#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-29-21:45: Launch ACC harness under a oneshot service matching staging privilege model.
set -euo pipefail
UNIT=/etc/systemd/system/fusion-staging-acceptance-run.service
cat >"$UNIT" <<'EOF'
[Unit]
Description=Appsolino Fusion staging acceptance harness (service context)
After=network.target

[Service]
Type=oneshot
User=fusion
Group=fusion
UMask=0027
NoNewPrivileges=no
ProtectSystem=off
WorkingDirectory=/srv/appsolino-fusion/staging/workspaces/project
Environment=HOME=/srv/appsolino-fusion/staging/state/fusion-home
Environment=FUSION_HOME=/srv/appsolino-fusion/staging/state/fusion-home
ExecStart=/usr/local/sbin/run-staging-acceptance.sh
EOF
systemctl daemon-reload
systemctl start fusion-staging-acceptance-run.service
systemctl status fusion-staging-acceptance-run.service --no-pager || true
cat /srv/appsolino-fusion/staging/state/acceptance-result.json
