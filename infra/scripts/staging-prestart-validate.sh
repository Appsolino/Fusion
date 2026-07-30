#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-30-07:50: Mandatory pre-start validation for fusion-staging.service.
# Requires secrets.env with exact localhost fusion_staging DATABASE_URL identity and safe mode.
set -euo pipefail
SECRETS=/etc/appsolino-fusion/staging/secrets.env
ENV_FILE=/etc/appsolino-fusion/staging/fusion.env

fail() { echo "PRESTART_FAIL: $*" >&2; exit 1; }

[[ -f "$SECRETS" ]] || fail "secrets.env missing"
[[ -f "$ENV_FILE" ]] || fail "fusion.env missing"

owner_group="$(stat -c '%U:%G' "$SECRETS")"
mode="$(stat -c '%a' "$SECRETS")"
[[ "$owner_group" == "root:fusion" ]] || fail "secrets owner must be root:fusion (got $owner_group)"
case "$mode" in
  640|600) ;;
  *) fail "secrets mode must be 0640 or 0600 (got $mode)" ;;
esac

if grep -Eiq '(^|[^a-z_])production([^a-z_]|$)|/opt/appsolino-fusion/production|fusion_prod([^a-z_]|$)|fusion_production|appsolino-prod' "$SECRETS" "$ENV_FILE"; then
  fail "production marker present"
fi

url="$(grep '^DATABASE_URL=' "$SECRETS" | head -1 | cut -d= -f2-)"
[[ -n "$url" ]] || fail "DATABASE_URL missing"

python3 - "$url" <<'PY'
import re, sys
url = sys.argv[1]
# postgresql://fusion_staging:PASSWORD@127.0.0.1:5432/fusion_staging
m = re.match(r'^postgresql://([^:/@]+):([^@]*)@([^:/]+)(?::(\d+))?/([^?\s]+)$', url)
if not m:
    raise SystemExit('DATABASE_URL parse failed')
user, _pw, host, port, db = m.groups()
port = port or '5432'
if user != 'fusion_staging':
    raise SystemExit(f'role must be fusion_staging (got {user})')
if db != 'fusion_staging':
    raise SystemExit(f'database must be fusion_staging (got {db})')
if host not in ('127.0.0.1', 'localhost'):
    raise SystemExit(f'host must be 127.0.0.1/localhost (got {host})')
if port != '5432':
    raise SystemExit(f'port must be 5432 (got {port})')
print('PRESTART_OK')
PY
