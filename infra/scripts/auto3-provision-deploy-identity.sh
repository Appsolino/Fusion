#!/usr/bin/env bash
# FNXC:AppsolinoAuto3 2026-08-01-01:20:
# Provision dedicated appsolino-deploy identity + root-owned deploy entrypoints on Host D.
# Public-key only; forced command; no password; no Host P access. Safe to re-run.
# Does not print private key material.
set -euo pipefail

REPO_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME=appsolino-deploy
HOME_DIR=/var/lib/appsolino-deploy
KEY_DIR=/etc/appsolino-fusion/staging/auto3-deploy
INBOX="$HOME_DIR/inbox"
WRAPPER=/usr/local/sbin/auto3-ssh-wrapper.sh
DEPLOY=/usr/local/sbin/auto3-deploy.sh
INSTALL=/usr/local/sbin/install-staging-release.sh

if [[ "$(id -u)" -ne 0 ]]; then
  echo "must run as root" >&2
  exit 1
fi

# FNXC:AppsolinoAuto3 2026-08-01-01:25: Use /bin/bash so sshd accepts the account; interactive use is still blocked by authorized_keys forced-command + restrict.
id -u "$USER_NAME" >/dev/null 2>&1 || useradd --system --home "$HOME_DIR" --shell /bin/bash --create-home "$USER_NAME"
usermod -s /bin/bash "$USER_NAME" >/dev/null 2>&1 || true
mkdir -p "$HOME_DIR/.ssh" "$INBOX" "$KEY_DIR" \
  /opt/appsolino-fusion/staging-proof/releases \
  /srv/appsolino-fusion/staging-proof/state/auto3 \
  /srv/appsolino-fusion/staging-proof/backups
chown -R "$USER_NAME:$USER_NAME" "$HOME_DIR"
chmod 0750 "$HOME_DIR" "$INBOX"
chmod 0700 "$HOME_DIR/.ssh"
chmod 0750 "$KEY_DIR"
# FNXC:AppsolinoAuto3 2026-08-01-01:33: Proof release trees must be root:fusion 0750 so the fusion service user can traverse and execute immutable releases (same contract as live staging).
chown root:fusion /opt/appsolino-fusion/staging-proof /opt/appsolino-fusion/staging-proof/releases
chmod 0750 /opt/appsolino-fusion/staging-proof /opt/appsolino-fusion/staging-proof/releases
chown -R fusion:fusion /srv/appsolino-fusion/staging-proof
chmod 0750 /srv/appsolino-fusion/staging-proof /srv/appsolino-fusion/staging-proof/state /srv/appsolino-fusion/staging-proof/backups

install -m 0755 -o root -g root "$REPO_SCRIPTS/auto3-ssh-wrapper.sh" "$WRAPPER"
install -m 0755 -o root -g root "$REPO_SCRIPTS/auto3-deploy.sh" "$DEPLOY"
install -m 0755 -o root -g root "$REPO_SCRIPTS/install-staging-release.sh" "$INSTALL"

# Sudo: only the deploy entry
cat >/etc/sudoers.d/appsolino-deploy <<EOF
# FNXC:AppsolinoAuto3 2026-08-01-01:20: appsolino-deploy may run only the allow-listed AUTO-3 deploy entry as root.
${USER_NAME} ALL=(root) NOPASSWD: ${DEPLOY}
Defaults:${USER_NAME} !requiretty
EOF
chmod 0440 /etc/sudoers.d/appsolino-deploy
visudo -cf /etc/sudoers.d/appsolino-deploy

if [[ ! -f "$KEY_DIR/id_ed25519" ]]; then
  ssh-keygen -t ed25519 -N "" -f "$KEY_DIR/id_ed25519" -C "appsolino-deploy@github-actions" >/dev/null
  chmod 0600 "$KEY_DIR/id_ed25519"
  chmod 0640 "$KEY_DIR/id_ed25519.pub"
fi

PUB="$(cat "$KEY_DIR/id_ed25519.pub")"
# Forced command + hardening options
{
  echo "command=\"${WRAPPER}\",no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-pty,restrict ${PUB}"
} >"$HOME_DIR/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "$HOME_DIR/.ssh/authorized_keys"
chmod 0600 "$HOME_DIR/.ssh/authorized_keys"

# Ensure proof DB exists
if ! sudo -u postgres psql -Atc "SELECT 1 FROM pg_database WHERE datname='fusion_staging_auto3_proof'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE fusion_staging_auto3_proof OWNER fusion_staging ENCODING 'UTF8' TEMPLATE template0;"
fi

STAGING_DB_PASSWORD="$(grep '^STAGING_DB_PASSWORD=' /etc/appsolino-fusion/staging/secrets.env | head -1 | cut -d= -f2-)"
PROOF_DB_URL="postgresql://fusion_staging:${STAGING_DB_PASSWORD}@127.0.0.1:5432/fusion_staging_auto3_proof"

# Proof systemd unit (isolated port/state/DB; engine paused)
cat >/etc/systemd/system/fusion-staging-proof.service <<EOF
# FNXC:AppsolinoAuto3 2026-08-01-01:20: Disposable AUTO-3 proof unit. Isolated from live fusion-staging.service.
[Unit]
Description=Appsolino Fusion staging PROOF service (AUTO-3)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=fusion
Group=fusion
UMask=0027
WorkingDirectory=/srv/appsolino-fusion/staging/workspaces/project
Environment=HOME=/srv/appsolino-fusion/staging-proof/state/fusion-home
Environment=FUSION_HOME=/srv/appsolino-fusion/staging-proof/state/fusion-home
Environment=FUSION_SKIP_ONBOARDING=1
EnvironmentFile=/etc/appsolino-fusion/staging/fusion.env
Environment=DATABASE_URL=${PROOF_DB_URL}
ExecStart=/opt/appsolino-fusion/staging-proof/current/fn dashboard --host 127.0.0.1 --port 4141 --paused --no-auth --no-supervise
Restart=no
StandardOutput=journal
StandardError=journal
SyslogIdentifier=fusion-staging-proof

[Install]
WantedBy=multi-user.target
EOF

mkdir -p /srv/appsolino-fusion/staging-proof/state/fusion-home
chown -R fusion:fusion /srv/appsolino-fusion/staging-proof
systemctl daemon-reload
unset STAGING_DB_PASSWORD PROOF_DB_URL
# known_hosts for this host
HOST_IP="$(hostname -I | awk '{print $1}')"
KNOWN="$(ssh-keyscan -H 127.0.0.1 "$HOST_IP" 2>/dev/null || true)"
printf '%s\n' "$KNOWN" >"$KEY_DIR/known_hosts"
chmod 0640 "$KEY_DIR/known_hosts"

echo "PROVISION_OK user=$USER_NAME key=$KEY_DIR/id_ed25519 pubkey_fingerprint=$(ssh-keygen -lf "$KEY_DIR/id_ed25519.pub" | awk '{print $2}')"
echo "PRIVATE_KEY_PATH=$KEY_DIR/id_ed25519"
echo "KNOWN_HOSTS_PATH=$KEY_DIR/known_hosts"
echo "HOST_IP=$HOST_IP"
echo "DEPLOY_USER=$USER_NAME"
