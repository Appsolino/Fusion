#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-29-21:45:
# Allow-listed ACC-ENV-03..08 harness intended to run from systemd service context
# (fusion-staging-acceptance.service / run as fusion with same NoNewPrivileges=no).
set -euo pipefail
OUT=/srv/appsolino-fusion/staging/state/acceptance-result.json
ACC_DIR=/etc/appsolino-fusion/staging/acceptance
CORR_ID="phase2a-acc-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$ACC_DIR" "$(dirname "$OUT")"
declare -A R

run() {
  local id="$1"; shift
  if "$@" >/tmp/"$id".out 2>/tmp/"$id".err; then
    R["$id"]=PASS
  else
    R["$id"]=FAIL
  fi
}

# ACC-ENV-03: sudo -n id -u == 0
if out="$(sudo -n id -u 2>/tmp/acc03.err)"; then
  [[ "$out" == "0" ]] && R[ACC-ENV-03]=PASS || R[ACC-ENV-03]=FAIL
else
  R[ACC-ENV-03]=FAIL
fi

# ACC-ENV-04: harmless non-interactive package-management probe
if sudo -n apt-get --dry-run install -y bubblewrap >/tmp/acc04.out 2>/tmp/acc04.err; then
  R[ACC-ENV-04]=PASS
else
  R[ACC-ENV-04]=FAIL
fi

# ACC-ENV-05: write under acceptance dir
testfile="$ACC_DIR/acc05-$CORR_ID.txt"
if echo "ok $CORR_ID" | sudo -n tee "$testfile" >/dev/null && sudo -n rm -f "$testfile"; then
  R[ACC-ENV-05]=PASS
else
  R[ACC-ENV-05]=FAIL
fi

# ACC-ENV-06: restart dedicated harmless probe unit
if sudo -n systemctl start fusion-staging-acceptance-probe.service >/tmp/acc06.out 2>/tmp/acc06.err; then
  R[ACC-ENV-06]=PASS
else
  R[ACC-ENV-06]=FAIL
fi

# ACC-ENV-07: bubblewrap ordinary mode must NOT write to /etc acceptance
if bwrap --die-with-parent --unshare-all --share-net \
  --ro-bind / / --tmpfs /tmp --dev /dev --proc /proc \
  --bind /srv/appsolino-fusion/staging/workspaces /srv/appsolino-fusion/staging/workspaces \
  bash -c "echo denied > /etc/appsolino-fusion/staging/acceptance/should-fail-$CORR_ID.txt" \
  >/tmp/acc07.out 2>/tmp/acc07.err; then
  # If write somehow succeeded, fail the test
  if [[ -f /etc/appsolino-fusion/staging/acceptance/should-fail-$CORR_ID.txt ]]; then
    sudo -n rm -f "/etc/appsolino-fusion/staging/acceptance/should-fail-$CORR_ID.txt"
    R[ACC-ENV-07]=FAIL
  else
    R[ACC-ENV-07]=PASS
  fi
else
  # Expected: denied / failed
  R[ACC-ENV-07]=PASS
fi

# ACC-ENV-08: explicit host-admin outside bubblewrap succeeds + audit
audit=/srv/appsolino-fusion/staging/logs/host-admin-audit.log
mkdir -p "$(dirname "$audit")"
if echo "$(date -u --iso-8601=seconds) corr=$CORR_ID host-admin write" | sudo -n tee "$ACC_DIR/acc08-$CORR_ID.txt" >/dev/null; then
  echo "$(date -u --iso-8601=seconds) corr=$CORR_ID ACC-ENV-08 PASS uid=$(id -u) sudo_uid=$(sudo -n id -u)" | tee -a "$audit" >/dev/null
  sudo -n rm -f "$ACC_DIR/acc08-$CORR_ID.txt"
  R[ACC-ENV-08]=PASS
else
  R[ACC-ENV-08]=FAIL
fi

python3 - "$OUT" <<'PY'
import json, os, sys
# reconstruct from env files written below
PY

# Emit JSON
{
  echo "{"
  echo "  \"correlation_id\": \"$CORR_ID\","
  echo "  \"uid\": \"$(id -u)\","
  echo "  \"sudo_uid\": \"$(sudo -n id -u 2>/dev/null || echo fail)\","
  echo "  \"results\": {"
  first=1
  for k in ACC-ENV-03 ACC-ENV-04 ACC-ENV-05 ACC-ENV-06 ACC-ENV-07 ACC-ENV-08; do
    [[ $first -eq 1 ]] || echo ","
    first=0
    printf '    "%s": "%s"' "$k" "${R[$k]}"
  done
  echo
  echo "  }"
  echo "}"
} | tee "$OUT"

# Overall
for k in ACC-ENV-03 ACC-ENV-04 ACC-ENV-05 ACC-ENV-06 ACC-ENV-07 ACC-ENV-08; do
  [[ "${R[$k]}" == PASS ]] || exit 1
done
echo ACCEPTANCE_PASS
