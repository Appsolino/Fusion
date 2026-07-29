#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-29-21:45: Bubblewrap ordinary-mode filesystem denial probes (run as fusion).
set -euo pipefail
CORR="bwrap-$(date -u +%Y%m%dT%H%M%SZ)"
fail=0
ERR=/srv/appsolino-fusion/staging/state/bwrap-deny.err
try_deny() {
  local target="$1"
  if bwrap --die-with-parent --unshare-pid --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
    --ro-bind /etc /etc --ro-bind /opt /opt --bind /srv/appsolino-fusion/staging/workspaces /srv/appsolino-fusion/staging/workspaces \
    --tmpfs /tmp --dev /dev --proc /proc \
    /bin/bash -c "echo x > '$target'" 2>"$ERR"; then
    echo "FAIL unexpectedly wrote $target"
    rm -f "$target" || true
    fail=1
  else
    echo "OK denied $target"
  fi
}
try_deny "/etc/appsolino-fusion/staging/acceptance/bwrap-$CORR.txt"
try_deny "/opt/appsolino-fusion/staging/releases/bwrap-$CORR.txt"
try_deny "/srv/appsolino-fusion/build/bwrap-$CORR.txt"

if bwrap --die-with-parent --unshare-pid --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --ro-bind /etc /etc --bind /srv/appsolino-fusion/staging/workspaces /srv/appsolino-fusion/staging/workspaces \
  --tmpfs /tmp --dev /dev --proc /proc \
  /bin/bash -c "echo ok > /srv/appsolino-fusion/staging/workspaces/bwrap-ok-$CORR.txt"; then
  echo "OK allowed staging workspace write"
  rm -f "/srv/appsolino-fusion/staging/workspaces/bwrap-ok-$CORR.txt"
else
  echo "FAIL allowed workspace write"
  cat "$ERR" 2>/dev/null || true
  fail=1
fi

echo "apparmor_userns=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo n/a)"
if [[ $fail -ne 0 ]]; then exit 1; fi
echo BUBBLEWRAP_PASS
