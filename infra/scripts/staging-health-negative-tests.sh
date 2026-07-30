#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-30-07:50: Negative proofs that staging-health-check.sh exits non-zero for known failure classes.
# Restores fusion-staging.service if temporarily stopped. Does not modify production.
set -euo pipefail
HC=/usr/local/sbin/staging-health-check.sh
EV=${1:-/srv/appsolino-fusion/staging/state/health-negative-results.json}
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"; systemctl is-active --quiet fusion-staging.service || systemctl start fusion-staging.service || true' EXIT

pass=0
fail=0
declare -A R

assert_fail() {
  local name="$1"; shift
  set +e
  "$@" >"$tmpdir/$name.out" 2>"$tmpdir/$name.err"
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    R["$name"]=PASS
    pass=$((pass+1))
  else
    R["$name"]=FAIL
    fail=$((fail+1))
  fi
}

# 1) Bad version override
assert_fail bad_version env FORCE_VERSION_OVERRIDE=9.9.9 "$HC"

# 2) Inactive service
systemctl stop fusion-staging.service
sleep 1
assert_fail inactive_service "$HC"
systemctl start fusion-staging.service
# Wait until health recovers for subsequent cases
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:4140/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done

# 3) Database query failure forced
assert_fail database_failure env FORCE_DB_QUERY_FAIL=1 "$HC"

# 4) Migration mismatch
assert_fail migration_mismatch env EXPECTED_HIGHEST_MIGRATION=9999 "$HC"

python3 - "$EV" <<PY
import json, os, sys
payload = {
  "results": {
    "bad_version": """${R[bad_version]}""",
    "inactive_service": """${R[inactive_service]}""",
    "database_failure": """${R[database_failure]}""",
    "migration_mismatch": """${R[migration_mismatch]}""",
  },
  "pass_count": $pass,
  "fail_count": $fail,
  "result": "PASS" if $fail == 0 else "FAIL",
}
json.dump(payload, open(sys.argv[1], "w"), indent=2)
print(json.dumps(payload, indent=2))
raise SystemExit(0 if payload["result"] == "PASS" else 1)
PY
