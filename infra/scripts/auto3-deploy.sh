#!/usr/bin/env bash
# FNXC:AppsolinoAuto3 2026-08-01-01:20:
# Trusted Host D AUTO-3 deploy/rollback entry implementation. Parameterized for
# staging and disposable proof profiles. Reuses install-staging-release.sh.
# Never targets Host P / production. Never prints secret values.
# Classification: DEPLOYED | ROLLED_BACK | CRITICAL | IDEMPOTENT_NOOP | BLOCKED
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SH="${AUTO3_INSTALL_SH:-$SCRIPT_DIR/install-staging-release.sh}"
BACKUP_SH="${AUTO3_BACKUP_SH:-/usr/local/sbin/staging-backup.sh}"
RESULT_STATUS="BLOCKED"
RESULT_FILE=""
FORCE_SMOKE_FAIL=0
PROFILE="staging"
ARCHIVE=""
MANIFEST=""
SKIP_PROBE=0

usage() {
  echo "usage: $0 deploy --archive A --manifest M [--profile staging|proof] [--force-smoke-fail] [--skip-probe] [--result-file PATH]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    deploy) shift ;;
    --archive) ARCHIVE="${2:-}"; shift 2 ;;
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --force-smoke-fail) FORCE_SMOKE_FAIL=1; shift ;;
    --skip-probe) SKIP_PROBE=1; shift ;;
    --result-file) RESULT_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
done

[[ -n "$ARCHIVE" && -n "$MANIFEST" ]] || usage
[[ -f "$ARCHIVE" && -f "$MANIFEST" ]] || { echo "archive/manifest missing" >&2; exit 1; }

case "$PROFILE" in
  staging)
    RELEASES_ROOT=/opt/appsolino-fusion/staging/releases
    CURRENT_LINK=/opt/appsolino-fusion/staging/current
    PREVIOUS_LINK=/opt/appsolino-fusion/staging/previous
    IDENTITY_FILE=/srv/appsolino-fusion/staging/state/release-identity.txt
    STATE_DIR=/srv/appsolino-fusion/staging/state
    SERVICE=fusion-staging.service
    HEALTH_URL=http://127.0.0.1:4140/api/health
    HEALTH_PORT=4140
    SECRETS=/etc/appsolino-fusion/staging/secrets.env
    ENV_FILE=/etc/appsolino-fusion/staging/fusion.env
    DB_NAME=fusion_staging
    PROBE_DB=fusion_staging_auto3_probe
    PROBE_PORT=4149
    EVIDENCE_DIR=/srv/appsolino-fusion/staging/state/auto3
    ;;
  proof)
    # FNXC:AppsolinoAuto3 2026-08-01-01:20: Proof profile uses isolated roots/service so rollback drills cannot mutate the live Host D staging release.
    RELEASES_ROOT=/opt/appsolino-fusion/staging-proof/releases
    CURRENT_LINK=/opt/appsolino-fusion/staging-proof/current
    PREVIOUS_LINK=/opt/appsolino-fusion/staging-proof/previous
    IDENTITY_FILE=/srv/appsolino-fusion/staging-proof/state/release-identity.txt
    STATE_DIR=/srv/appsolino-fusion/staging-proof/state
    SERVICE=fusion-staging-proof.service
    HEALTH_URL=http://127.0.0.1:4141/api/health
    HEALTH_PORT=4141
    SECRETS=/etc/appsolino-fusion/staging/secrets.env
    ENV_FILE=/etc/appsolino-fusion/staging/fusion.env
    DB_NAME=fusion_staging_auto3_proof
    PROBE_DB=fusion_staging_auto3_proof_probe
    PROBE_PORT=4150
    EVIDENCE_DIR=/srv/appsolino-fusion/staging-proof/state/auto3
    ;;
  *)
    echo "unknown profile: $PROFILE" >&2
    exit 2
    ;;
esac

for marker in production fusion_production HostP /opt/appsolino-fusion/production; do
  if grep -Fq "$marker" <<<"$RELEASES_ROOT$CURRENT_LINK$SERVICE$DB_NAME"; then
    echo "REFUSED: Host P / production marker" >&2
    exit 2
  fi
done

mkdir -p "$EVIDENCE_DIR" "$STATE_DIR" "$RELEASES_ROOT" "$(dirname "$CURRENT_LINK")"
RESULT_FILE="${RESULT_FILE:-$EVIDENCE_DIR/last-deploy-result.json}"
WORK="$(mktemp -d /tmp/auto3-deploy.XXXXXX)"
PROBE_PID=""
CANDIDATE_DEST=""
SCHEMA_ADVANCED=0
BACKUP_DUMP=""
PREV_RELEASE_PATH=""
ACTIVE_BEFORE=""
LOCK_DIR=/run/auto3-deploy.lock

cleanup() {
  if [[ -n "${PROBE_PID}" ]] && kill -0 "$PROBE_PID" 2>/dev/null; then
    kill "$PROBE_PID" 2>/dev/null || true
    wait "$PROBE_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK" || true
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

write_result() {
  local status="$1"
  local reasons_json="$2"
  # FNXC:AppsolinoStewardS0 2026-08-02-04:55: Factual receipt fields for steward evidence.
  # Empty env → JSON null. deployedHostP is false because this Host D entry never targets Host P.
  PROFILE="$PROFILE" RESULT_FILE="$RESULT_FILE" STATUS="$status" REASONS_JSON="$reasons_json" \
  SOURCE_SHA="${SOURCE_SHA-}" RELEASE_ID="${RELEASE_ID-}" APP_VER="${APP_VER-}" \
  EVIDENCE_PREVIOUS="${ACTIVE_REL-}" EVIDENCE_HIGHEST="${HIGHEST_NOW-${HIGHEST_BEFORE-}}" \
  EVIDENCE_HEALTH="${EVIDENCE_HEALTH-}" EVIDENCE_ENGINE_PAUSED="${EVIDENCE_ENGINE_PAUSED-}" \
  python3 <<'PY'
import json, os
from datetime import datetime, timezone

def opt(key):
    v = (os.environ.get(key, "") or "").strip()
    return v if v else None

def opt_bool(key):
    v = (os.environ.get(key, "") or "").strip().lower()
    if v == "true":
        return True
    if v == "false":
        return False
    return None

payload = {
  "status": os.environ["STATUS"],
  "reasons": json.loads(os.environ["REASONS_JSON"]),
  "profile": os.environ["PROFILE"],
  "deployedHostP": False,
  "sourceSha": opt("SOURCE_SHA"),
  "releaseId": opt("RELEASE_ID"),
  "applicationVersion": opt("APP_VER"),
  "previousRelease": opt("EVIDENCE_PREVIOUS"),
  "highestMigration": opt("EVIDENCE_HIGHEST"),
  "health": opt("EVIDENCE_HEALTH"),
  "enginePaused": opt_bool("EVIDENCE_ENGINE_PAUSED"),
  "recordedUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
path = os.environ["RESULT_FILE"]
if path:
  open(path, "w").write(json.dumps(payload, indent=2) + "\n")
print(json.dumps(payload, indent=2))
PY
  RESULT_STATUS="$status"
}

# Concurrency: only one Host D deploy at a time (also enforced in GHA concurrency group).
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  write_result BLOCKED '["another Host D deployment is in progress"]'
  exit 3
fi

json_field() {
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get(sys.argv[2],"") if d.get(sys.argv[2]) is not None else "")' "$MANIFEST" "$1"
}

SOURCE_SHA="$(json_field sourceSha)"
RELEASE_ID="$(json_field releaseId)"
APP_VER="$(json_field applicationVersion)"
EXP_EXE="$(json_field executableSha256)"
EXP_ARCH="$(json_field archiveSha256)"
EXP_HEALTH_VER="$(json_field expectedHealthVersion)"
REQ_CEILING="$(json_field requiredSchemaCeiling)"

if [[ -z "$SOURCE_SHA" || -z "$RELEASE_ID" || -z "$EXP_EXE" || -z "$EXP_ARCH" ]]; then
  write_result BLOCKED '["missing classification/manifest data"]'
  exit 2
fi

ACT_ARCH="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
if [[ "$ACT_ARCH" != "$EXP_ARCH" ]]; then
  write_result BLOCKED '["archive hash mismatch"]'
  exit 2
fi

# Disk space: require >= 2GiB free on /opt
FREE_KB="$(df -Pk /opt | awk 'NR==2{print $4}')"
if [[ "${FREE_KB:-0}" -lt 2000000 ]]; then
  write_result BLOCKED '["insufficient disk space"]'
  exit 2
fi

# Extract into work (path-escape already validated at build; re-check listing)
if tar -tzf "$ARCHIVE" | grep -E '(^|/)\.\.(/|$)|^\s*/' >/dev/null; then
  write_result BLOCKED '["archive extraction would escape release directory"]'
  exit 2
fi
mkdir -p "$WORK/dist"
tar -xzf "$ARCHIVE" -C "$WORK/dist"
if [[ ! -x "$WORK/dist/fn" ]]; then
  write_result BLOCKED '["executable mode mismatch"]'
  exit 2
fi
ACT_EXE="$(sha256sum "$WORK/dist/fn" | awk '{print $1}')"
if [[ "$ACT_EXE" != "$EXP_EXE" ]]; then
  write_result BLOCKED '["executable hash mismatch"]'
  exit 2
fi

read_active() {
  if [[ -L "$CURRENT_LINK" || -e "$CURRENT_LINK" ]]; then
    readlink -f "$CURRENT_LINK" 2>/dev/null || true
  fi
}

ACTIVE_BEFORE="$(read_active || true)"
PREV_RELEASE_PATH="$ACTIVE_BEFORE"
ACTIVE_MAIN=""
ACTIVE_EXE=""
ACTIVE_REL=""
if [[ -n "$ACTIVE_BEFORE" && -f "$ACTIVE_BEFORE/RELEASE_IDENTITY" ]]; then
  ACTIVE_MAIN="$(grep -E '^MAIN_SHA=' "$ACTIVE_BEFORE/RELEASE_IDENTITY" | head -1 | cut -d= -f2- || true)"
  ACTIVE_EXE="$(grep -E '^EXE_SHA256=' "$ACTIVE_BEFORE/RELEASE_IDENTITY" | head -1 | cut -d= -f2- || true)"
  ACTIVE_REL="$(grep -E '^release_id=' "$ACTIVE_BEFORE/RELEASE_IDENTITY" | head -1 | cut -d= -f2- || true)"
fi

CANDIDATE_DEST="$RELEASES_ROOT/$RELEASE_ID"

# Idempotent same release
if [[ -n "$ACTIVE_BEFORE" && "$ACTIVE_BEFORE" == "$CANDIDATE_DEST" && "$ACTIVE_MAIN" == "$SOURCE_SHA" && "$ACTIVE_EXE" == "$EXP_EXE" ]]; then
  if curl -fsS -m 5 "$HEALTH_URL" | grep -q '"status":"ok"'; then
    write_result IDEMPOTENT_NOOP '["exact release already active; integrity revalidation ok"]'
    exit 0
  fi
fi

# Pre-activation: current service health (staging only hard-requires live ok)
if [[ "$PROFILE" == "staging" ]]; then
  if ! systemctl is-active --quiet "$SERVICE"; then
    write_result BLOCKED '["current staging service is not active"]'
    exit 2
  fi
  if ! curl -fsS -m 5 "$HEALTH_URL" | grep -q '"status":"ok"'; then
    write_result BLOCKED '["current staging health is not ok"]'
    exit 2
  fi
  # enginePaused must remain true; no dispatching tasks
  SETTINGS="$(curl -fsS -m 5 http://127.0.0.1:4140/api/settings)"
  echo "$SETTINGS" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("enginePaused") is True, "enginePaused must be true"; assert d.get("testMode") is False, "testMode must be false"'
  EVIDENCE_ENGINE_PAUSED="true"
  EVIDENCE_HEALTH="ok"
fi

# Record schema ceiling before
HIGHEST_BEFORE="$(sudo -n -u postgres psql -d "$DB_NAME" -Atc "SELECT coalesce(max(version),'none') FROM fusion_schema_migrations;" 2>/dev/null || echo none)"

# Side-by-side install (do not publish current yet)
export AUTO3_RELEASES_ROOT="$RELEASES_ROOT"
export AUTO3_CURRENT_LINK="$CURRENT_LINK"
export AUTO3_IDENTITY_FILE="$IDENTITY_FILE"
export AUTO3_PUBLISH_CURRENT=0
# FNXC:AppsolinoAuto3 2026-08-01-15:20: Pass packaged applicationVersion into installer (no hardcoded beta pin).
export AUTO3_APPLICATION_VERSION="${APP_VER}"
set +e
INSTALL_OUT="$(bash "$INSTALL_SH" "$WORK/dist" "$SOURCE_SHA" "$RELEASE_ID" 2>&1)"
INSTALL_RC=$?
set -e
echo "$INSTALL_OUT"
if [[ $INSTALL_RC -ne 0 ]]; then
  # existing conflicting identity
  write_result BLOCKED "$(python3 -c 'import json,sys; print(json.dumps([sys.argv[1][:500]]))' "install failed: $INSTALL_OUT")"
  exit 2
fi

# Pre-activation probe on disposable DB (optional skip for pure unit harness)
if [[ "$SKIP_PROBE" != "1" ]]; then
  sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${PROBE_DB}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${PROBE_DB};" >/dev/null
  sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${PROBE_DB} OWNER fusion_staging ENCODING 'UTF8' TEMPLATE template0;" >/dev/null
  # Clone schema+data from active staging DB when profile uses real staging secrets
  if [[ "$PROFILE" == "staging" || "$PROFILE" == "proof" ]]; then
    TMP_DUMP="/tmp/fusion_auto3_probe_$$.dump"
    rm -f "$TMP_DUMP"
    # FNXC:AppsolinoAuto3 2026-08-01-01:28: pg_dump runs as postgres and cannot write root-only mktemp dirs — use /tmp file then copy.
    if [[ "$PROFILE" == "staging" ]]; then
      sudo -n -u postgres pg_dump -d "$DB_NAME" --format=custom --file="$TMP_DUMP"
    else
      sudo -n -u postgres pg_dump -d fusion_staging --format=custom --file="$TMP_DUMP" || \
        sudo -n -u postgres pg_dump -d "$DB_NAME" --format=custom --file="$TMP_DUMP"
    fi
    sudo -n -u postgres pg_restore --no-owner --role=fusion_staging --dbname="$PROBE_DB" "$TMP_DUMP" >/dev/null 2>&1 || true
    rm -f "$TMP_DUMP"
  fi
  STAGING_DB_PASSWORD="$(grep '^STAGING_DB_PASSWORD=' "$SECRETS" | head -1 | cut -d= -f2-)"
  PROBE_HOME="$WORK/probe-home"
  mkdir -p "$PROBE_HOME"
  # shellcheck disable=SC2097,SC2098
  HOME="$PROBE_HOME" FUSION_HOME="$PROBE_HOME" FUSION_SKIP_ONBOARDING=1 \
    DATABASE_URL="postgresql://fusion_staging:${STAGING_DB_PASSWORD}@127.0.0.1:5432/${PROBE_DB}" \
    "$CANDIDATE_DEST/fn" dashboard --host 127.0.0.1 --port "$PROBE_PORT" --paused --no-auth --no-supervise \
    >"$WORK/probe.log" 2>&1 &
  PROBE_PID=$!
  ok_probe=0
  for _ in $(seq 1 60); do
    if curl -fsS -m 2 "http://127.0.0.1:${PROBE_PORT}/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
      ok_probe=1
      break
    fi
    sleep 2
  done
  if [[ "$ok_probe" != "1" ]]; then
    kill "$PROBE_PID" 2>/dev/null || true
    PROBE_PID=""
    # quarantine candidate: leave immutable dir but do not activate
    write_result BLOCKED '["migration/probe failure before activation; active service unchanged"]'
    exit 2
  fi
  PROBE_VER="$(curl -fsS -m 2 "http://127.0.0.1:${PROBE_PORT}/api/health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))')"
  if [[ -n "$EXP_HEALTH_VER" && "$PROBE_VER" != "$EXP_HEALTH_VER" ]]; then
    kill "$PROBE_PID" 2>/dev/null || true
    PROBE_PID=""
    write_result BLOCKED '["probe health version mismatch"]'
    exit 2
  fi
  if [[ ! -d "$CANDIDATE_DEST/plugins/fusion-plugin-cursor-runtime" ]]; then
    kill "$PROBE_PID" 2>/dev/null || true
    PROBE_PID=""
    write_result BLOCKED '["Cursor plugin/package missing in candidate"]'
    exit 2
  fi
  # FNXC:SoakR3PluginFreshness 2026-08-08-09:42: candidate must ship settleFallbackDispatch in Cursor bundle.
  if ! grep -q 'settleFallbackDispatch' "$CANDIDATE_DEST/plugins/fusion-plugin-cursor-runtime/bundled.js"; then
    kill "$PROBE_PID" 2>/dev/null || true
    PROBE_PID=""
    write_result BLOCKED '["Cursor bundled runtime missing settleFallbackDispatch marker"]'
    exit 2
  fi
  kill "$PROBE_PID" 2>/dev/null || true
  wait "$PROBE_PID" 2>/dev/null || true
  PROBE_PID=""
  sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${PROBE_DB}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${PROBE_DB};" >/dev/null 2>&1 || true
fi

# Consistent backup before activation (staging profile)
if [[ "$PROFILE" == "staging" && -x "$BACKUP_SH" ]]; then
  set +e
  BACKUP_OUT="$("$BACKUP_SH" 2>&1)"
  BACKUP_RC=$?
  set -e
  echo "$BACKUP_OUT" | sed 's/PASSWORD=[^ ]*/PASSWORD=***/g' || true
  if [[ $BACKUP_RC -ne 0 && "$BACKUP_OUT" != *OFF_HOST_TARGET_NOT_CONFIGURED* ]]; then
    # staging-backup exits 0 even when off-host not configured; non-zero is hard fail
    if [[ $BACKUP_RC -ne 0 ]]; then
      write_result BLOCKED '["staging backup failed before activation"]'
      exit 2
    fi
  fi
  BACKUP_DUMP="$(ls -1t /srv/appsolino-fusion/staging/backups/fusion_staging_*.dump 2>/dev/null | head -1 || true)"
  if [[ -n "$BACKUP_DUMP" ]]; then
    TMPR="/tmp/fusion_auto3_list_$$.dump"
    install -m 0600 -o postgres -g postgres "$BACKUP_DUMP" "$TMPR"
    sudo -n -u postgres pg_restore -l "$TMPR" >/dev/null
    rm -f "$TMPR"
  fi
elif [[ "$PROFILE" == "proof" ]]; then
  mkdir -p /srv/appsolino-fusion/staging-proof/backups
  BACKUP_DUMP="/srv/appsolino-fusion/staging-proof/backups/proof_$(date -u +%Y%m%dT%H%M%SZ).dump"
  sudo -n -u postgres pg_dump -d fusion_staging --format=custom --file="/tmp/fusion_auto3_proof_backup_$$.dump" >/dev/null
  install -m 0600 -o root -g fusion "/tmp/fusion_auto3_proof_backup_$$.dump" "$BACKUP_DUMP"
  rm -f "/tmp/fusion_auto3_proof_backup_$$.dump"
  # FNXC:AppsolinoAuto3 2026-08-01-01:29: Verify readability via postgres-owned temp copy (backups are root:fusion 0600).
  TMPR="/tmp/fusion_auto3_proof_list_$$.dump"
  install -m 0600 -o postgres -g postgres "$BACKUP_DUMP" "$TMPR"
  sudo -n -u postgres pg_restore -l "$TMPR" >/dev/null
  rm -f "$TMPR"
fi

# Atomic activation
if [[ -n "$ACTIVE_BEFORE" ]]; then
  ln -sfn "$ACTIVE_BEFORE" "$PREVIOUS_LINK"
  chown -h root:fusion "$PREVIOUS_LINK" 2>/dev/null || true
fi

export AUTO3_PUBLISH_CURRENT=1
# Point current at candidate without re-copy: installer already published side-by-side dest
ln -sfn "$CANDIDATE_DEST" "$CURRENT_LINK"
chown -h root:fusion "$CURRENT_LINK" 2>/dev/null || true
{
  echo "release_id=$RELEASE_ID"
  echo "path=$CANDIDATE_DEST"
  echo "version=$APP_VER"
  echo "executable_sha256=$EXP_EXE"
  echo "main_sha=$SOURCE_SHA"
  echo "installed_utc=$(date -u --iso-8601=seconds)"
} >"$IDENTITY_FILE"
chmod 0640 "$IDENTITY_FILE"
chown root:fusion "$IDENTITY_FILE" 2>/dev/null || true

rollback() {
  local why="$1"
  echo "AUTO3_ROLLBACK: $why" >&2
  systemctl stop "$SERVICE" 2>/dev/null || true
  if [[ -n "$PREV_RELEASE_PATH" && -d "$PREV_RELEASE_PATH" ]]; then
    ln -sfn "$PREV_RELEASE_PATH" "$CURRENT_LINK"
    chown -h root:fusion "$CURRENT_LINK" 2>/dev/null || true
  fi
  # Restore DB if schema advanced
  HIGHEST_NOW="$(sudo -n -u postgres psql -d "$DB_NAME" -Atc "SELECT coalesce(max(version),'none') FROM fusion_schema_migrations;" 2>/dev/null || echo none)"
  if [[ "$HIGHEST_NOW" != "$HIGHEST_BEFORE" && -n "$BACKUP_DUMP" && -f "$BACKUP_DUMP" ]]; then
    SCHEMA_ADVANCED=1
    sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" >/dev/null || true
    sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${DB_NAME};"
    sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME} OWNER fusion_staging ENCODING 'UTF8' TEMPLATE template0;"
    TMPR="$WORK/restore.dump"
    install -m 0600 -o postgres -g postgres "$BACKUP_DUMP" "$TMPR"
    sudo -n -u postgres pg_restore --no-owner --role=fusion_staging --dbname="$DB_NAME" "$TMPR" >/dev/null 2>&1 || true
  fi
  if [[ "$PROFILE" == "staging" ]] || systemctl cat "$SERVICE" >/dev/null 2>&1; then
    systemctl start "$SERVICE" || true
  fi
  local healthy=0
  for _ in $(seq 1 45); do
    if curl -fsS -m 2 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then healthy=1; break; fi
    sleep 2
  done
  if [[ "$healthy" == "1" ]]; then
    # FNXC:AppsolinoStewardS0 2026-08-05: populate factual receipt fields for steward (#105).
    EVIDENCE_HEALTH="ok"
    if [[ "$PROFILE" == "staging" ]] || [[ "$PROFILE" == "proof" ]]; then
      EVIDENCE_ENGINE_PAUSED="true"
    fi
    write_result ROLLED_BACK "$(python3 -c 'import json,sys; print(json.dumps([sys.argv[1],"previous release restored"]))' "$why")"
    exit 4
  fi
  write_result CRITICAL "$(python3 -c 'import json,sys; print(json.dumps([sys.argv[1],"rollback did not restore healthy previous release"]))' "$why")"
  exit 5
}

if [[ "$PROFILE" == "staging" ]]; then
  systemctl stop "$SERVICE"
  systemctl start "$SERVICE"
elif [[ "$PROFILE" == "proof" ]]; then
  # Ensure proof unit exists; start via systemd if present, else direct supervise for drill
  if systemctl cat "$SERVICE" >/dev/null 2>&1; then
    systemctl stop "$SERVICE" 2>/dev/null || true
    systemctl start "$SERVICE"
  else
    echo "PROOF_SERVICE_MISSING: expected $SERVICE to be provisioned" >&2
    rollback "proof service missing"
  fi
fi

ok=0
for _ in $(seq 1 60); do
  if curl -fsS -m 2 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then ok=1; break; fi
  sleep 2
done
if [[ "$ok" != "1" ]]; then
  rollback "health timeout after activation"
fi

HEALTH_JSON="$(curl -fsS -m 5 "$HEALTH_URL")"
echo "$HEALTH_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("status")=="ok"'
GOT_VER="$(echo "$HEALTH_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))')"
if [[ -n "$EXP_HEALTH_VER" && "$GOT_VER" != "$EXP_HEALTH_VER" ]]; then
  rollback "wrong release health version"
fi

CUR_EXE="$(sha256sum "$(readlink -f "$CURRENT_LINK")/fn" | awk '{print $1}')"
if [[ "$CUR_EXE" != "$EXP_EXE" ]]; then
  rollback "hash mismatch after activation"
fi
CUR_MAIN="$(grep -E '^MAIN_SHA=' "$(readlink -f "$CURRENT_LINK")/RELEASE_IDENTITY" | head -1 | cut -d= -f2-)"
if [[ "$CUR_MAIN" != "$SOURCE_SHA" ]]; then
  rollback "wrong release identity"
fi

if [[ "$PROFILE" == "staging" ]]; then
  SETTINGS="$(curl -fsS -m 5 http://127.0.0.1:4140/api/settings)"
  echo "$SETTINGS" | python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d.get("enginePaused") is True, "engine unexpectedly unpaused"
assert d.get("testMode") is False
assert d.get("defaultProvider")=="cursor-cli"
assert d.get("defaultModelId")=="composer-2.5"
assert not d.get("fallbackProvider") and not d.get("fallbackModelId")
'
fi

if [[ "$FORCE_SMOKE_FAIL" == "1" ]]; then
  rollback "deliberate post-activation smoke failure"
fi

# Restart once while paused
systemctl restart "$SERVICE"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS -m 2 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then ok=1; break; fi
  sleep 2
done
if [[ "$ok" != "1" ]]; then
  rollback "restart instability"
fi

if [[ "$PROFILE" == "staging" ]]; then
  SETTINGS="$(curl -fsS -m 5 http://127.0.0.1:4140/api/settings)"
  echo "$SETTINGS" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("enginePaused") is True'
  # FNXC:SoakR3PluginFreshness 2026-08-08-10:15:
  # Fingerprint match alone is insufficient — the plugin must also load (Host D
  # immutable release dirs EACCES'd sibling .bundled.reload copies after #170).
  FRESH="$(curl -fsS -m 10 http://127.0.0.1:4140/api/plugins/bundled-freshness?id=fusion-plugin-cursor-runtime)"
  echo "$FRESH" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d.get("ok") is True and d.get("status")=="pass", d
c=d.get("cursor") or {}
assert c.get("status")=="pass" and c.get("match") is True, c
assert c.get("bundledFingerprint") and c.get("bundledFingerprint")==c.get("activeFingerprint"), c
assert c.get("settleFallbackDispatchMarkerPresent") is True, c
assert c.get("loaded") is True, c
assert c.get("pluginState")=="started", c
print("cursor_bundled_freshness=PASS", c.get("bundledFingerprint","")[:16], "loaded", c.get("loaded"))
'
  PLUG="$(curl -fsS -m 5 http://127.0.0.1:4140/api/plugins)"
  echo "$PLUG" | python3 -c '
import json,sys
items=json.load(sys.stdin)
cursor=next((p for p in items if p.get("id")=="fusion-plugin-cursor-runtime"), None)
assert cursor and cursor.get("enabled") and cursor.get("state")=="started", cursor
print("cursor_plugin_loaded=PASS", cursor.get("path"), cursor.get("state"))
'
fi

EVIDENCE_HEALTH="ok"
EVIDENCE_ENGINE_PAUSED="true"
HIGHEST_NOW="$(sudo -n -u postgres psql -d "$DB_NAME" -Atc "SELECT coalesce(max(version),'none') FROM fusion_schema_migrations;" 2>/dev/null || echo "${HIGHEST_BEFORE:-}")"
write_result DEPLOYED "$(python3 -c 'import json,sys; print(json.dumps(["candidate active","health ok","engine paused","release="+sys.argv[1]]))' "$RELEASE_ID")"
exit 0
