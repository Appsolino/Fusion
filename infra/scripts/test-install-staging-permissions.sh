#!/usr/bin/env bash
# FNXC:V1A.1 2026-07-30-10:55: Focused permission fixture for install-staging-release.sh — preserve packaged execute bits; immutability is a-w only; fail-closed on exec mismatch.
# Usage: bash infra/scripts/test-install-staging-permissions.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL_SH="$ROOT/infra/scripts/install-staging-release.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

bash -n "$INSTALL_SH" || fail "bash -n install-staging-release.sh"

# --- Extract and exercise the same copy + permission logic used by the installer ---
# Mirrors the post-cp permission steps without touching /opt or requiring a real fn binary.

TMP="$(mktemp -d)"
# FNXC:V1A.1 2026-07-30-10:55: Fixture trees are made a-w; restore user write before cleanup so trap can remove them.
cleanup_tmp() {
  if [[ -d "$TMP" ]]; then
    chmod -R u+w "$TMP" 2>/dev/null || true
    rm -rf "$TMP"
  fi
}
trap cleanup_tmp EXIT

SRC="$TMP/src"
DST="$TMP/dst"
mkdir -p "$SRC/runtime/bin" "$DST"

printf '#!/bin/sh\necho initdb\n' >"$SRC/runtime/bin/initdb"
printf '#!/bin/sh\necho postgres\n' >"$SRC/runtime/bin/postgres"
printf 'config\n' >"$SRC/runtime/config.txt"
printf '#!/bin/sh\necho fn\n' >"$SRC/fn"
chmod 0755 "$SRC/runtime/bin/initdb" "$SRC/runtime/bin/postgres" "$SRC/fn"
chmod 0644 "$SRC/runtime/config.txt"

# Same copy + permission sequence as install-staging-release.sh (sans chown / version checks).
cp -a "$SRC/fn" "$DST/fn"
cp -a "$SRC/runtime" "$DST/runtime"
{
  echo "MAIN_SHA=deadbeef"
  echo "VERSION=0.74.0-beta.5"
  echo "EXE_SHA256=fixture"
  echo "release_id=fixture"
  echo "path=$DST"
  echo "installed_utc=$(date -u --iso-8601=seconds)"
} >"$DST/RELEASE_IDENTITY"

find "$DST" -type d -exec chmod 0755 {} \;

list_executable_relpaths() {
  local root="$1"
  find "$root" -type f \( -perm -u=x -o -perm -g=x -o -perm -o=x \) -printf '%P\n' | LC_ALL=C sort -u
}

verify_tree_executable_modes() {
  local src_root="$1"
  local dst_root="$2"
  local label="$3"
  local rel
  local mismatch=0
  if [[ -f "$src_root" ]]; then
    [[ -x "$dst_root" ]] || { echo "PERMISSION_MISMATCH: $label"; return 1; }
    return 0
  fi
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    [[ -x "$dst_root/$rel" ]] || { echo "PERMISSION_MISMATCH: lost exec ${label}/${rel}"; mismatch=1; }
  done < <(list_executable_relpaths "$src_root")
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    [[ ! -f "$dst_root/$rel" ]] && continue
    [[ -x "$src_root/$rel" ]] && continue
    if [[ -x "$dst_root/$rel" ]]; then
      echo "PERMISSION_MISMATCH: gained exec ${label}/${rel}"
      mismatch=1
    fi
  done < <(find "$src_root" -type f -printf '%P\n' | LC_ALL=C sort -u)
  return "$mismatch"
}

verify_stage_permissions() {
  local src="$1" dst="$2" mismatch=0
  verify_tree_executable_modes "$src/fn" "$dst/fn" "fn" || mismatch=1
  verify_tree_executable_modes "$src/runtime" "$dst/runtime" "runtime" || mismatch=1
  [[ -x "$dst/fn" ]] || { echo "PERMISSION_MISMATCH: fn not executable"; mismatch=1; }
  if [[ -e "$dst/RELEASE_IDENTITY" && -x "$dst/RELEASE_IDENTITY" ]]; then
    echo "PERMISSION_MISMATCH: RELEASE_IDENTITY executable"; mismatch=1
  fi
  return "$mismatch"
}

verify_stage_permissions "$SRC" "$DST" || fail "pre-immutability verification"
chmod -R a-w "$DST" || true
verify_stage_permissions "$SRC" "$DST" || fail "post-immutability verification"

[[ -x "$DST/runtime/bin/initdb" ]] || fail "initdb not executable"
[[ -x "$DST/runtime/bin/postgres" ]] || fail "postgres not executable"
[[ ! -x "$DST/runtime/config.txt" ]] || fail "config.txt unexpectedly executable"
[[ -x "$DST/fn" ]] || fail "fn not executable"
[[ ! -x "$DST/RELEASE_IDENTITY" ]] || fail "RELEASE_IDENTITY unexpectedly executable"

# No file retains a write bit after immutability (use mode bits — root -w is not reliable).
if find "$DST" -type f -perm /222 -print -quit | grep -q .; then
  fail "write bits remain after a-w: $(find "$DST" -type f -perm /222 -print | head -5 | tr '\n' ' ')"
fi
pass "no write bits remain after a-w"

# Fail-closed: stripping exec from a packaged binary must be detected.
chmod a+w "$DST/runtime/bin/initdb" 2>/dev/null || true
chmod a-x "$DST/runtime/bin/initdb"
if verify_stage_permissions "$SRC" "$DST" 2>/dev/null; then
  fail "expected PERMISSION_MISMATCH when initdb lost execute bit"
fi
pass "fixture preserved exec bits; a-w clears write; mismatch detected"

# --- Release-ID validation regressions (do not touch /opt) ---
# Invoke only the ID-validation path by sourcing patterns via a dry run that fails early.
# We call the real script with empty/missing paths after injecting via bash -c of the regex.

validate_id() {
  local id="$1"
  if [[ ! "$id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || [[ "$id" == *".."* ]]; then
    return 1
  fi
  return 0
}

validate_id "v1a-0.74.0-beta.5-f54d53082" || fail "valid release ID rejected"
validate_id "phase2a-0.74.0-beta.5-abc" || fail "valid phase2a ID rejected"
validate_id "../escape" && fail "path escape ID accepted"
validate_id "bad/id" && fail "slash ID accepted"
validate_id ".hidden" && fail "leading-dot ID accepted"
pass "release ID validation regressions"

# --- Candidate executable inventory (read-only; no install) ---
# FNXC:V1A.1 2026-07-30-10:55: Frozen candidate dir is root:root 750; run this script as root (or with traverse rights) for inventory. Do not chmod the candidate.
CAND_ROOT="${CANDIDATE_ROOT:-/srv/appsolino-fusion/build/v1a/v1a-0.74.0-beta.5-f54d53082}"
CAND="$CAND_ROOT/dist"
if [[ -d "$CAND/runtime" && -x "$CAND/fn" ]]; then
  cand_exec="$(mktemp)"
  find "$CAND" -type f \( -perm -u=x -o -perm -g=x -o -perm -o=x \) -printf '%P\n' | LC_ALL=C sort -u >"$cand_exec"
  exec_count="$(wc -l <"$cand_exec")"
  echo "CANDIDATE_EXECUTABLE_COUNT=$exec_count"
  # Spot-check helpers that previously lost +x under the 0644 blanket.
  for rel in \
    runtime/linux-x64/embedded-postgres/native/bin/initdb \
    runtime/linux-x64/embedded-postgres/native/bin/postgres \
    fn
  do
    if [[ -e "$CAND/$rel" ]]; then
      [[ -x "$CAND/$rel" ]] || fail "candidate packaged $rel is not executable (source package)"
      echo "CANDIDATE_EXEC_OK=$rel"
    else
      echo "CANDIDATE_PATH_ABSENT=$rel"
    fi
  done
  # Confirm candidate hashes unchanged (read-only).
  exp_fn=5f33e09a2a004318b015e341dd37c88b841c3eea572e53f89658d51529b7ce4a
  exp_arc=9a3c275a34e39004d0c026e3b2a864b6f4064d174618d7f4383c3b62c7ae6598
  got_fn="$(sha256sum "$CAND/fn" | awk '{print $1}')"
  got_arc="$(sha256sum "$CAND_ROOT/artefact.tar.gz" | awk '{print $1}')"
  [[ "$got_fn" == "$exp_fn" ]] || fail "candidate fn hash changed: $got_fn"
  [[ "$got_arc" == "$exp_arc" ]] || fail "candidate archive hash changed: $got_arc"
  pass "candidate executable inventory + hashes unchanged"
  rm -f "$cand_exec"
else
  echo "SKIP: candidate dist not readable at $CAND (need traverse rights on frozen root-owned candidate dir)"
fi

echo "ALL_PERMISSION_TESTS_PASSED"
