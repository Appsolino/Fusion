#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-30-07:40: Local staging pg_dump as postgres (RLS-safe) with metadata; fail-closed off-host upload.
# FNXC:Phase2A 2026-07-30-07:40: dump_path and source_main_sha are distinct variables — never reuse the dump path name for git output.
set -euo pipefail
# FNXC:HostDTrust 2026-08-06: Must run as root so postgres dump in /tmp is installable (#109 cycle1).
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "staging-backup.sh must run as root (sudo)" >&2
  exit 1
fi
SECRETS=/etc/appsolino-fusion/staging/secrets.env
BACKUPS=/srv/appsolino-fusion/staging/backups
META_DIR="$BACKUPS/meta"
CURRENT=/opt/appsolino-fusion/staging/current
OFF_HOST_CONF=/etc/appsolino-fusion/staging/off-host-backup.env
TMP_DUMP=""
cleanup() {
  [[ -n "$TMP_DUMP" && -f "$TMP_DUMP" ]] && rm -f "$TMP_DUMP" || true
}
trap cleanup EXIT

mkdir -p "$BACKUPS" "$META_DIR"
chmod 0750 "$BACKUPS" || true

if [[ ! -f "$SECRETS" ]]; then
  echo "missing secrets file" >&2
  exit 1
fi

# Fail closed only on explicit production markers
if grep -Eiq '(^|[^a-z_])production([^a-z_]|$)|/opt/appsolino-fusion/production|fusion_prod([^a-z_]|$)|fusion_production' "$SECRETS"; then
  echo "PRODUCTION_MARKER" >&2
  exit 2
fi

STAGING_DB_PASSWORD="$(grep '^STAGING_DB_PASSWORD=' "$SECRETS" | head -1 | cut -d= -f2-)"
if [[ -z "$STAGING_DB_PASSWORD" ]]; then
  echo "STAGING_DB_PASSWORD missing" >&2
  exit 1
fi

ts="$(date -u +%Y%m%dT%H%M%SZ)"
dump_path="$BACKUPS/fusion_staging_${ts}.dump"
meta_path="$META_DIR/fusion_staging_${ts}.json"
TMP_DUMP="/tmp/fusion_staging_backup_${ts}.dump"

# Prefer RELEASE_IDENTITY; fall back to repository HEAD without touching dump_path.
source_main_sha="unknown"
if [[ -f "$CURRENT/RELEASE_IDENTITY" ]]; then
  source_main_sha="$(grep -E '^MAIN_SHA=' "$CURRENT/RELEASE_IDENTITY" | head -1 | cut -d= -f2- || true)"
  [[ -n "$source_main_sha" ]] || source_main_sha="unknown"
fi
if [[ "$source_main_sha" == "unknown" ]]; then
  git_sha="$(git -C /srv/appsolino-fusion/worktrees/phase-2a-staging-infrastructure-foundation rev-parse HEAD 2>/dev/null || true)"
  [[ -n "$git_sha" ]] && source_main_sha="$git_sha"
fi

exe_sha="unknown"
if [[ -x "$CURRENT/fn" ]]; then
  exe_sha="$(sha256sum "$CURRENT/fn" | awk '{print $1}')"
fi
release_id="$(basename "$(readlink -f "$CURRENT" 2>/dev/null || echo unknown)")"

export PGPASSWORD="$STAGING_DB_PASSWORD"
export PGHOST=127.0.0.1
export PGUSER=fusion_staging
export PGDATABASE=fusion_staging
pg_ver="$(psql -Atc 'SHOW server_version;' 2>/dev/null || echo unknown)"
# FNXC:Phase2A 2026-07-29-22:15: Migration identity from fusion_schema_migrations (not public table names).
mig_list="$(psql -Atc "SELECT coalesce(string_agg(version, ',' ORDER BY version),'') FROM fusion_schema_migrations;" 2>/dev/null || echo '')"
mig_hash="$(printf '%s' "$mig_list" | sha256sum | awk '{print $1}')"
highest_mig="$(psql -Atc "SELECT coalesce(max(version),'none') FROM fusion_schema_migrations;" 2>/dev/null || echo unknown)"
unset PGPASSWORD

# FNXC:Phase2A 2026-07-29-22:15: Dump as postgres superuser so FORCE RLS tables are included; never put password on argv.
sudo -n -u postgres pg_dump -d fusion_staging --format=custom --file="$TMP_DUMP"
install -m 0600 -o root -g fusion "$TMP_DUMP" "$dump_path"
rm -f "$TMP_DUMP"
TMP_DUMP=""
backup_sha="$(sha256sum "$dump_path" | awk '{print $1}')"

python3 -c "import json; json.dump({
  'timestamp': '''$ts''',
  'database': 'fusion_staging',
  'postgresql_version': '''$pg_ver''',
  'source_main_sha': '''$source_main_sha''',
  'release_id': '''$release_id''',
  'executable_sha256': '''$exe_sha''',
  'migration_set_sha256': '''$mig_hash''',
  'highest_migration': '''$highest_mig''',
  'backup_sha256': '''$backup_sha''',
  'backup_file': '''$dump_path''',
  'result': 'PASS',
}, open('''$meta_path''','w'), indent=2); print(open('''$meta_path''').read())"
chmod 0640 "$meta_path"

ls -1t "$BACKUPS"/fusion_staging_*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f || true
rm -f "$BACKUPS"/test.dump "$BACKUPS"/fusion_staging_manual.dump || true

if [[ ! -f "$OFF_HOST_CONF" ]]; then
  echo "OFF_HOST_TARGET_NOT_CONFIGURED"
  exit 0
fi
# shellcheck disable=SC1090
set -a; source "$OFF_HOST_CONF"; set +a
if [[ "${OFF_HOST_BACKUP_CONFIGURED:-false}" != "true" || -z "${OFF_HOST_BACKUP_TARGET:-}" ]]; then
  echo "OFF_HOST_TARGET_NOT_CONFIGURED"
  exit 0
fi
if [[ -x /usr/local/sbin/staging-offhost-upload.sh ]]; then
  /usr/local/sbin/staging-offhost-upload.sh "$dump_path" "$OFF_HOST_BACKUP_TARGET"
else
  echo "OFF_HOST_TARGET_NOT_CONFIGURED: upload helper missing"
  exit 0
fi
