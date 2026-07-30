#!/usr/bin/env bash
# FNXC:V1A.1 2026-07-30-10:55: Focused permission fixture for install-staging-release.sh — preserve packaged execute bits; immutability is a-w only; fail-closed on exec mismatch.
# FNXC:V1A.1 2026-07-30-11:35: Also cover a-w fail-closed (no || true), writable file/dir rejection, and same-ID existing-release permission gates before IDEMPOTENT_NOOP.
# Usage: bash infra/scripts/test-install-staging-permissions.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL_SH="$ROOT/infra/scripts/install-staging-release.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

bash -n "$INSTALL_SH" || fail "bash -n install-staging-release.sh"

# FNXC:V1A.1 2026-07-30-11:35: Staged chmod -R a-w failure must not be ignored in the installer source.
if grep -E 'chmod -R a-w "\$stage"[[:space:]]*\|\|[[:space:]]*true' "$INSTALL_SH"; then
  fail "installer still ignores chmod -R a-w failure via || true"
fi
grep -q 'chmod -R a-w "\$stage"' "$INSTALL_SH" || fail "installer missing chmod -R a-w \"\$stage\""
grep -q 'writable path remains after immutability' "$INSTALL_SH" || fail "installer missing post-a-w write-bit rejection"
grep -q 'existing release permissions do not match package' "$INSTALL_SH" || fail "installer missing same-ID permission IMMUTABLE_CONFLICT"
pass "staged chmod -R a-w failure is not ignored (source contract)"

TMP="$(mktemp -d)"
# FNXC:V1A.1 2026-07-30-10:55: Fixture trees are made a-w; restore user write before cleanup so trap can remove them.
cleanup_tmp() {
  if [[ -d "$TMP" ]]; then
    chmod -R u+w "$TMP" 2>/dev/null || true
    rm -rf "$TMP"
  fi
}
trap cleanup_tmp EXIT

# --- Shared helpers mirroring install-staging-release.sh ---
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
  if [[ -d "$src/runtime" ]]; then
    verify_tree_executable_modes "$src/runtime" "$dst/runtime" "runtime" || mismatch=1
  fi
  [[ -x "$dst/fn" ]] || { echo "PERMISSION_MISMATCH: fn not executable"; mismatch=1; }
  if [[ -e "$dst/RELEASE_IDENTITY" && -x "$dst/RELEASE_IDENTITY" ]]; then
    echo "PERMISSION_MISMATCH: RELEASE_IDENTITY executable"; mismatch=1
  fi
  return "$mismatch"
}

assert_no_write_bits() {
  local root="$1"
  if find "$root" -perm /222 -print -quit | grep -q .; then
    echo "PERMISSION_MISMATCH: writable path remains after immutability" >&2
    return 1
  fi
  return 0
}

# FNXC:V1A.1 2026-07-30-11:35: Mirror same-ID identity+permission gate before touching a fake current symlink.
try_idempotent_reactivate() {
  local src="$1"
  local dest="$2"
  local current_link="$3"
  local identity_ok="${4:-1}"
  if [[ "$identity_ok" != "1" ]]; then
    echo "IMMUTABLE_CONFLICT: identity mismatch" >&2
    return 2
  fi
  if ! verify_stage_permissions "$src" "$dest"; then
    echo "IMMUTABLE_CONFLICT: existing release permissions do not match package" >&2
    return 2
  fi
  if ! assert_no_write_bits "$dest"; then
    echo "IMMUTABLE_CONFLICT: existing release permissions do not match package" >&2
    return 2
  fi
  ln -sfn "$dest" "$current_link"
  echo "IDEMPOTENT_NOOP"
  return 0
}

build_package_tree() {
  local root="$1"
  mkdir -p "$root/runtime/bin"
  printf '#!/bin/sh\necho initdb\n' >"$root/runtime/bin/initdb"
  printf '#!/bin/sh\necho postgres\n' >"$root/runtime/bin/postgres"
  printf 'config\n' >"$root/runtime/config.txt"
  printf '#!/bin/sh\necho fn\n' >"$root/fn"
  chmod 0755 "$root/runtime/bin/initdb" "$root/runtime/bin/postgres" "$root/fn"
  chmod 0644 "$root/runtime/config.txt"
}

# --- Fresh stage: copy + permission sequence ---
SRC="$TMP/src"
DST="$TMP/dst"
mkdir -p "$DST"
build_package_tree "$SRC"

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
verify_stage_permissions "$SRC" "$DST" || fail "pre-immutability verification"
chmod -R a-w "$DST"
assert_no_write_bits "$DST" || fail "post-a-w write bits remain"
verify_stage_permissions "$SRC" "$DST" || fail "post-immutability verification"

[[ -x "$DST/runtime/bin/initdb" ]] || fail "initdb not executable"
[[ -x "$DST/runtime/bin/postgres" ]] || fail "postgres not executable"
[[ ! -x "$DST/runtime/config.txt" ]] || fail "config.txt unexpectedly executable"
[[ -x "$DST/fn" ]] || fail "fn not executable"
[[ ! -x "$DST/RELEASE_IDENTITY" ]] || fail "RELEASE_IDENTITY unexpectedly executable"
pass "fixture preserved exec bits; a-w clears write on files and dirs"

# Writable staged file is rejected (mode bits; root-safe).
chmod u+w "$DST/RELEASE_IDENTITY"
if assert_no_write_bits "$DST" 2>/dev/null; then
  fail "expected rejection of writable staged file"
fi
chmod a-w "$DST/RELEASE_IDENTITY"
pass "writable staged file is rejected"

# Writable staged directory is rejected.
chmod u+w "$DST/runtime"
if assert_no_write_bits "$DST" 2>/dev/null; then
  fail "expected rejection of writable staged directory"
fi
chmod a-w "$DST/runtime"
assert_no_write_bits "$DST" || fail "write bits remain after restoring a-w"
pass "writable staged directory is rejected"

# Fail-closed: stripping exec from a packaged binary must be detected.
chmod u+w "$DST/runtime/bin/initdb" 2>/dev/null || true
chmod a-x "$DST/runtime/bin/initdb"
if verify_stage_permissions "$SRC" "$DST" 2>/dev/null; then
  fail "expected PERMISSION_MISMATCH when initdb lost execute bit"
fi
# Restore for later cases
chmod u+w "$DST/runtime/bin/initdb" 2>/dev/null || true
chmod 0555 "$DST/runtime/bin/initdb"
chmod a-w "$DST/runtime/bin/initdb"
pass "stripped execute bit is detected"

# --- Same-ID existing-release gate (local fixture; does not touch /opt) ---
CURRENT="$TMP/current-link"
PRIOR="$TMP/prior-current"
mkdir -p "$PRIOR"
echo prior >"$PRIOR/marker"
ln -sfn "$PRIOR" "$CURRENT"
CURRENT_BEFORE="$(readlink -f "$CURRENT")"

EXIST_BAD_EXEC="$TMP/exist-bad-exec"
mkdir -p "$EXIST_BAD_EXEC"
cp -a "$SRC/fn" "$EXIST_BAD_EXEC/fn"
cp -a "$SRC/runtime" "$EXIST_BAD_EXEC/runtime"
printf 'MAIN_SHA=deadbeef\nVERSION=0.74.0-beta.5\n' >"$EXIST_BAD_EXEC/RELEASE_IDENTITY"
find "$EXIST_BAD_EXEC" -type d -exec chmod 0755 {} \;
chmod -R a-w "$EXIST_BAD_EXEC"
chmod u+w "$EXIST_BAD_EXEC/runtime/bin/initdb"
chmod a-x "$EXIST_BAD_EXEC/runtime/bin/initdb"
chmod a-w "$EXIST_BAD_EXEC/runtime/bin/initdb"
ec=0
try_idempotent_reactivate "$SRC" "$EXIST_BAD_EXEC" "$CURRENT" 1 >/dev/null 2>"$TMP/err-bad-exec" || ec=$?
[[ "$ec" -ne 0 ]] || fail "stripped-initdb same-ID release was accepted"
grep -q 'IMMUTABLE_CONFLICT: existing release permissions do not match package' "$TMP/err-bad-exec" \
  || fail "missing IMMUTABLE_CONFLICT for stripped initdb"
[[ "$(readlink -f "$CURRENT")" == "$CURRENT_BEFORE" ]] || fail "current symlink changed on stripped-initdb reject"
pass "existing same-ID release with stripped initdb execute bit is rejected; current unchanged"

EXIST_WRITABLE="$TMP/exist-writable"
mkdir -p "$EXIST_WRITABLE"
cp -a "$SRC/fn" "$EXIST_WRITABLE/fn"
cp -a "$SRC/runtime" "$EXIST_WRITABLE/runtime"
printf 'MAIN_SHA=deadbeef\nVERSION=0.74.0-beta.5\n' >"$EXIST_WRITABLE/RELEASE_IDENTITY"
find "$EXIST_WRITABLE" -type d -exec chmod 0755 {} \;
# Leave write bits (skip a-w) to simulate a non-immutable prior install.
ec=0
try_idempotent_reactivate "$SRC" "$EXIST_WRITABLE" "$CURRENT" 1 >/dev/null 2>"$TMP/err-writable" || ec=$?
[[ "$ec" -ne 0 ]] || fail "writable same-ID release was accepted"
grep -q 'IMMUTABLE_CONFLICT: existing release permissions do not match package' "$TMP/err-writable" \
  || fail "missing IMMUTABLE_CONFLICT for writable release"
[[ "$(readlink -f "$CURRENT")" == "$CURRENT_BEFORE" ]] || fail "current symlink changed on writable reject"
pass "existing same-ID writable release is rejected; current unchanged"

EXIST_OK="$TMP/exist-ok"
mkdir -p "$EXIST_OK"
cp -a "$SRC/fn" "$EXIST_OK/fn"
cp -a "$SRC/runtime" "$EXIST_OK/runtime"
printf 'MAIN_SHA=deadbeef\nVERSION=0.74.0-beta.5\n' >"$EXIST_OK/RELEASE_IDENTITY"
find "$EXIST_OK" -type d -exec chmod 0755 {} \;
chmod -R a-w "$EXIST_OK"
out="$(try_idempotent_reactivate "$SRC" "$EXIST_OK" "$CURRENT" 1)"
[[ "$out" == "IDEMPOTENT_NOOP" ]] || fail "correct immutable same-ID release did not noop: $out"
[[ "$(readlink -f "$CURRENT")" == "$(readlink -f "$EXIST_OK")" ]] || fail "IDEMPOTENT_NOOP did not update current"
pass "existing same-ID correctly immutable release remains IDEMPOTENT_NOOP"

# Reset current and re-confirm rejected cases still leave it alone after a successful noop path was tested.
ln -sfn "$PRIOR" "$CURRENT"
CURRENT_BEFORE="$(readlink -f "$CURRENT")"
ec=0
try_idempotent_reactivate "$SRC" "$EXIST_BAD_EXEC" "$CURRENT" 1 >/dev/null 2>/dev/null || ec=$?
[[ "$ec" -ne 0 ]] || fail "re-reject stripped initdb failed"
[[ "$(readlink -f "$CURRENT")" == "$CURRENT_BEFORE" ]] || fail "current changed on re-reject"
pass "current symlink remains unchanged for rejected cases"

# --- Release-ID validation regressions ---
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
