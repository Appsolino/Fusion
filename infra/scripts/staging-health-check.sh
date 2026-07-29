#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-29-21:45: Localhost staging health + monitoring textfile exporter.
set -euo pipefail
ENV_FILE=/etc/appsolino-fusion/staging/fusion.env
SECRETS=/etc/appsolino-fusion/staging/secrets.env
CURRENT=/opt/appsolino-fusion/staging/current
PORT=4140
HOST=127.0.0.1
PROM_DIR=/var/lib/node_exporter/textfile_collector
PROM_FILE="$PROM_DIR/appsolino_fusion_staging.prom"
STATUS_JSON=/srv/appsolino-fusion/staging/state/health-status.json
NOTES_FILE=$(mktemp)
mkdir -p "$PROM_DIR" /srv/appsolino-fusion/staging/state
# shellcheck disable=SC1090
if [[ -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a; fi
PORT="${PORT:-4140}"
HOST="${HOST:-127.0.0.1}"

ok=1
service_active=0
version=""
db_ok=0
listener_ok=0
restart_count=0
rss_kb=0
disk_free_gb=0
migration_ok=0
: >"$NOTES_FILE"
note() { echo "$1" >>"$NOTES_FILE"; }

if systemctl is-active --quiet fusion-staging.service; then service_active=1; else ok=0; note service_inactive; fi
pid="$(systemctl show -p MainPID --value fusion-staging.service 2>/dev/null || echo 0)"
if [[ "$pid" != "0" && -n "$pid" ]]; then rss_kb="$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' || echo 0)"; fi
restart_count="$(systemctl show -p NRestarts --value fusion-staging.service 2>/dev/null || echo 0)"
exe_path="$(readlink -f "$CURRENT/fn" 2>/dev/null || true)"
if [[ -z "$exe_path" || ! -x "$exe_path" ]]; then ok=0; note missing_executable; fi

if ss -ltn | grep -qE "${HOST}:${PORT}[[:space:]]"; then listener_ok=1; else ok=0; note listener_missing; fi
if ss -ltn | grep -qE "0\\.0\\.0\\.0:${PORT}[[:space:]]"; then ok=0; note public_listener; fi
if [[ -f "$SECRETS" ]] && grep -Eiq 'production|/opt/appsolino-fusion/production|fusion_prod' "$SECRETS"; then ok=0; note production_secret_marker; fi

body="$(curl -fsS --max-time 5 "http://${HOST}:${PORT}/api/health" 2>/dev/null || true)"
if [[ -n "$body" ]]; then
  version="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' <<<"$body")"
  db_ok="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(1 if d.get("database",{}).get("healthy") else 0)' <<<"$body")"
else
  ok=0; note health_http_fail
fi
if [[ "$version" != "0.74.0-beta.5" ]]; then ok=0; note "bad_version:${version:-empty}"; fi
if [[ "$version" == "unknown" || "$version" == "0.0.0" ]]; then ok=0; note placeholder_version; fi

if [[ -f "$SECRETS" ]]; then
  set -a; # shellcheck disable=SC1090
  source "$SECRETS"; set +a
  if [[ -n "${DATABASE_URL:-}" ]]; then
    mig_count="$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo 0)"
    if [[ "$mig_count" -gt 0 ]]; then migration_ok=1; fi
  fi
fi

disk_free_gb="$(df -BG / | awk 'NR==2{gsub(/G/,"",$4); print $4}')"
if [[ "${disk_free_gb:-0}" -lt 5 ]]; then ok=0; note low_disk; fi
if [[ "${restart_count:-0}" -gt 20 ]]; then ok=0; note restart_loop; fi

backup_age=-1
backup_status=0
latest_backup="$(ls -1t /srv/appsolino-fusion/staging/backups/*.dump 2>/dev/null | head -1 || true)"
if [[ -n "$latest_backup" ]]; then
  backup_status=1
  backup_age=$(( ($(date +%s) - $(stat -c %Y "$latest_backup")) / 60 ))
fi
acceptance_status=0
if [[ -f /srv/appsolino-fusion/staging/state/acceptance-result.json ]]; then acceptance_status=1; fi

cat >"$PROM_FILE.tmp" <<EOP
# HELP appsolino_fusion_staging_up Staging Fusion service up
# TYPE appsolino_fusion_staging_up gauge
appsolino_fusion_staging_up $service_active
# HELP appsolino_fusion_staging_health_ok Composite health OK
# TYPE appsolino_fusion_staging_health_ok gauge
appsolino_fusion_staging_health_ok $ok
# HELP appsolino_fusion_staging_restarts Restart count
# TYPE appsolino_fusion_staging_restarts gauge
appsolino_fusion_staging_restarts $restart_count
# HELP appsolino_fusion_staging_rss_kb Process RSS KiB
# TYPE appsolino_fusion_staging_rss_kb gauge
appsolino_fusion_staging_rss_kb ${rss_kb:-0}
# HELP appsolino_fusion_staging_disk_free_gb Root disk free GiB
# TYPE appsolino_fusion_staging_disk_free_gb gauge
appsolino_fusion_staging_disk_free_gb ${disk_free_gb:-0}
# HELP appsolino_fusion_staging_db_ok Database healthy
# TYPE appsolino_fusion_staging_db_ok gauge
appsolino_fusion_staging_db_ok $db_ok
# HELP appsolino_fusion_staging_listener_ok Localhost listener present
# TYPE appsolino_fusion_staging_listener_ok gauge
appsolino_fusion_staging_listener_ok $listener_ok
# HELP appsolino_fusion_staging_backup_present Latest local backup present
# TYPE appsolino_fusion_staging_backup_present gauge
appsolino_fusion_staging_backup_present $backup_status
# HELP appsolino_fusion_staging_backup_age_minutes Backup age minutes
# TYPE appsolino_fusion_staging_backup_age_minutes gauge
appsolino_fusion_staging_backup_age_minutes $backup_age
# HELP appsolino_fusion_staging_acceptance_present Acceptance result present
# TYPE appsolino_fusion_staging_acceptance_present gauge
appsolino_fusion_staging_acceptance_present $acceptance_status
EOP
mv -f "$PROM_FILE.tmp" "$PROM_FILE"

NOTES="$(tr '\n' ' ' <"$NOTES_FILE" | sed 's/ *$//')"
python3 - "$STATUS_JSON" <<PY
import json
payload = {
  "ok": ${ok} == 1,
  "service_active": ${service_active} == 1,
  "version": """${version}""",
  "db_ok": ${db_ok} == 1,
  "listener_ok": ${listener_ok} == 1,
  "migration_ok": ${migration_ok} == 1,
  "exe_path": """${exe_path}""",
  "pid": """${pid}""",
  "restart_count": int("""${restart_count}""" or 0),
  "rss_kb": int("""${rss_kb:-0}""" or 0),
  "disk_free_gb": int("""${disk_free_gb:-0}""" or 0),
  "notes": """${NOTES}""".split(),
}
json.dump(payload, open("""${STATUS_JSON}""", "w"), indent=2)
print(json.dumps(payload, indent=2))
PY
rm -f "$NOTES_FILE"
exit 0
