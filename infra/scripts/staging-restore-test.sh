#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-29-22:20: Restore latest staging dump into fusion_staging_restore_test; verify marker + migrations; destroy DB.
set -euo pipefail
SECRETS=/etc/appsolino-fusion/staging/secrets.env
BACKUPS=/srv/appsolino-fusion/staging/backups
RESTORE_DB=fusion_staging_restore_test
EVIDENCE=/srv/appsolino-fusion/staging/state/restore-test-result.json
MARKER_FRAG="${MARKER_TITLE_FRAG:-Phase2A backup marker}"

STAGING_DB_PASSWORD="$(grep '^STAGING_DB_PASSWORD=' "$SECRETS" | head -1 | cut -d= -f2-)"
dump="${1:-}"
if [[ -z "$dump" ]]; then
  dump="$(ls -1t "$BACKUPS"/fusion_staging_*.dump 2>/dev/null | head -1 || true)"
fi
[[ -f "$dump" ]] || { echo "no dump" >&2; exit 1; }

# FNXC:Phase2A 2026-07-29-22:20: Copy dump to postgres-readable temp (backups are root:fusion 0600).
tmp_dump="/tmp/fusion_staging_restore_$$.dump"
cleanup() { rm -f "$tmp_dump"; }
trap cleanup EXIT
install -m 0600 -o postgres -g postgres "$dump" "$tmp_dump"

sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${RESTORE_DB}' AND pid <> pg_backend_pid();" >/dev/null || true
sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${RESTORE_DB};"
sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${RESTORE_DB} OWNER fusion_staging ENCODING 'UTF8' TEMPLATE template0;"

# Restore as postgres; tolerate non-fatal extension ownership warnings
set +e
sudo -n -u postgres pg_restore --no-owner --role=fusion_staging --dbname="$RESTORE_DB" "$tmp_dump"
restore_rc=$?
set -e
# pg_restore returns 1 on warnings; fail only if migrations missing afterward

# Query as postgres to bypass FORCE RLS when verifying restored rows
src_migs="$(sudo -n -u postgres psql -d fusion_staging -Atc "SELECT coalesce(string_agg(version, ',' ORDER BY version),'') FROM fusion_schema_migrations;")"
dst_migs="$(sudo -n -u postgres psql -d "$RESTORE_DB" -Atc "SELECT coalesce(string_agg(version, ',' ORDER BY version),'') FROM fusion_schema_migrations;" 2>/dev/null || echo '')"
src_high="$(sudo -n -u postgres psql -d fusion_staging -Atc "SELECT coalesce(max(version),'none') FROM fusion_schema_migrations;")"
dst_high="$(sudo -n -u postgres psql -d "$RESTORE_DB" -Atc "SELECT coalesce(max(version),'none') FROM fusion_schema_migrations;" 2>/dev/null || echo none)"

marker_sql="SELECT count(*) FROM project.tasks WHERE coalesce(title,'') ILIKE '%${MARKER_FRAG}%' OR coalesce(description,'') ILIKE '%${MARKER_FRAG}%'"
marker_count="$(sudo -n -u postgres psql -d "$RESTORE_DB" -Atc "$marker_sql" 2>/dev/null || echo 0)"
src_marker="$(sudo -n -u postgres psql -d fusion_staging -Atc "$marker_sql" 2>/dev/null || echo 0)"
unset PGPASSWORD || true

python3 - "$EVIDENCE" <<PY
import json,sys
src_migs="""$src_migs"""
dst_migs="""$dst_migs"""
payload={
  "dump": "$dump",
  "restore_db": "$RESTORE_DB",
  "pg_restore_rc": int("$restore_rc"),
  "source_highest_migration": "$src_high",
  "restore_highest_migration": "$dst_high",
  "migrations_match": src_migs == dst_migs and bool(src_migs),
  "source_marker_count": int("$src_marker" or 0),
  "restore_marker_count": int("$marker_count" or 0),
  "marker_fragment": "$MARKER_FRAG",
}
payload["result"] = "PASS" if payload["migrations_match"] and payload["restore_marker_count"] >= 1 and payload["restore_marker_count"] == payload["source_marker_count"] else "FAIL"
json.dump(payload, open(sys.argv[1],"w"), indent=2)
print(json.dumps(payload, indent=2))
if payload["result"] != "PASS":
  raise SystemExit(1)
PY

sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${RESTORE_DB}' AND pid <> pg_backend_pid();" >/dev/null || true
sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${RESTORE_DB};"
echo "restore_test_db_destroyed"
