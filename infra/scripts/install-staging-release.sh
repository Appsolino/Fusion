#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-30-07:55: Install packaged fn into immutable staging release dir + current symlink.
# FNXC:Phase2A 2026-07-30-07:55: Never rm -rf an existing named release; stage then rename; fail closed on identity mismatch; idempotent no-op on match.
# FNXC:V1A 2026-07-30-08:55: Optional third arg sets the immutable release ID so V1A can freeze v1a-0.74.0-beta.5-<short> without inventing a second layout or deleting prior phase2a releases.
# FNXC:V1A 2026-07-30-09:24: Validate RELEASE_ID_OVERRIDE as a single safe basename before joining privileged /opt/.../releases/${rel}; reject path separators, "..", whitespace, control chars, and leading-dot IDs so a malformed override cannot escape the release directory.
# FNXC:V1A.1 2026-07-30-10:55: Preserve packaged execute bits from cp -a; never blanket-chmod files to 0644 (that stripped initdb/pg helpers and broke restart under embedded/testMode). Immutability is write-bit removal only (chmod -R a-w), with fail-closed SRC↔stage executable-path verification before publish.
set -euo pipefail
SRC_DIST="${1:-}"
MAIN_SHA="${2:-}"
RELEASE_ID_OVERRIDE="${3:-}"
VERSION="0.74.0-beta.5"
if [[ -z "$SRC_DIST" || -z "$MAIN_SHA" ]]; then
  echo "usage: $0 <packages/cli/dist> <main-sha> [release-id]" >&2
  exit 1
fi
short="${MAIN_SHA:0:12}"
if [[ -n "$RELEASE_ID_OVERRIDE" ]]; then
  if [[ ! "$RELEASE_ID_OVERRIDE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] ||
     [[ "$RELEASE_ID_OVERRIDE" == *".."* ]]; then
    echo "INVALID_RELEASE_ID: $RELEASE_ID_OVERRIDE" >&2
    exit 1
  fi
  rel="$RELEASE_ID_OVERRIDE"
else
  rel="phase2a-${VERSION}-${short}"
fi
dest="/opt/appsolino-fusion/staging/releases/${rel}"
stage="${dest}.staging.$$"
if [[ ! -x "$SRC_DIST/fn" ]]; then
  echo "missing $SRC_DIST/fn" >&2
  exit 1
fi
ver="$("$SRC_DIST/fn" --version 2>/dev/null | head -1 | tr -d '\r')"
if [[ "$ver" != "$VERSION" ]]; then
  echo "version mismatch: got '$ver' expected '$VERSION'" >&2
  exit 1
fi
src_sha="$(sha256sum "$SRC_DIST/fn" | awk '{print $1}')"

# FNXC:V1A.1 2026-07-30-10:55: Relative paths of regular files that have any execute bit set under root.
list_executable_relpaths() {
  local root="$1"
  find "$root" -type f \( -perm -u=x -o -perm -g=x -o -perm -o=x \) -printf '%P\n' | LC_ALL=C sort -u
}

# FNXC:V1A.1 2026-07-30-10:55: Fail closed if any packaged executable under a copied tree became non-executable in stage, or if a non-executable packaged file gained execute.
verify_tree_executable_modes() {
  local src_root="$1"
  local dst_root="$2"
  local label="$3"
  local rel
  local mismatch=0

  if [[ ! -e "$src_root" ]]; then
    return 0
  fi
  if [[ -f "$src_root" ]]; then
    if [[ ! -x "$dst_root" ]]; then
      echo "PERMISSION_MISMATCH: packaged executable lost execute bit: ${label}" >&2
      return 1
    fi
    return 0
  fi
  if [[ ! -d "$dst_root" ]]; then
    echo "PERMISSION_MISMATCH: staged tree missing packaged directory: ${label}" >&2
    return 1
  fi

  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    if [[ ! -e "$dst_root/$rel" ]]; then
      echo "PERMISSION_MISMATCH: staged tree missing packaged executable: ${label}/${rel}" >&2
      mismatch=1
      continue
    fi
    if [[ ! -x "$dst_root/$rel" ]]; then
      echo "PERMISSION_MISMATCH: packaged executable lost execute bit: ${label}/${rel}" >&2
      mismatch=1
    fi
  done < <(list_executable_relpaths "$src_root")

  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    [[ ! -f "$dst_root/$rel" ]] && continue
    if [[ -x "$src_root/$rel" ]]; then
      continue
    fi
    if [[ -x "$dst_root/$rel" ]]; then
      echo "PERMISSION_MISMATCH: non-executable packaged file gained execute bit: ${label}/${rel}" >&2
      mismatch=1
    fi
  done < <(find "$src_root" -type f -printf '%P\n' | LC_ALL=C sort -u)

  return "$mismatch"
}

# FNXC:V1A.1 2026-07-30-10:55: Compare executable state for every tree we copy from SRC_DIST; require fn executable and RELEASE_IDENTITY non-executable.
verify_stage_permissions() {
  local src="$1"
  local dst="$2"
  local mismatch=0

  verify_tree_executable_modes "$src/fn" "$dst/fn" "fn" || mismatch=1
  if [[ -d "$src/client" ]]; then
    verify_tree_executable_modes "$src/client" "$dst/client" "client" || mismatch=1
  fi
  if [[ -d "$src/migrations" ]]; then
    verify_tree_executable_modes "$src/migrations" "$dst/migrations" "migrations" || mismatch=1
  fi
  if [[ -d "$src/runtime" ]]; then
    verify_tree_executable_modes "$src/runtime" "$dst/runtime" "runtime" || mismatch=1
  fi
  if [[ ! -x "$dst/fn" ]]; then
    echo "PERMISSION_MISMATCH: fn is not executable" >&2
    mismatch=1
  fi
  if [[ -e "$dst/RELEASE_IDENTITY" && -x "$dst/RELEASE_IDENTITY" ]]; then
    echo "PERMISSION_MISMATCH: RELEASE_IDENTITY must not be executable" >&2
    mismatch=1
  fi
  return "$mismatch"
}

ensure_current_symlink() {
  ln -sfn "$dest" /opt/appsolino-fusion/staging/current
  chown -h root:fusion /opt/appsolino-fusion/staging/current
  {
    echo "release_id=$rel"
    echo "path=$dest"
    echo "version=$VERSION"
    echo "executable_sha256=$src_sha"
    echo "main_sha=$MAIN_SHA"
    echo "installed_utc=$(date -u --iso-8601=seconds)"
  } | tee /srv/appsolino-fusion/staging/state/release-identity.txt >/dev/null
  chmod 0640 /srv/appsolino-fusion/staging/state/release-identity.txt
  chown root:fusion /srv/appsolino-fusion/staging/state/release-identity.txt
}

if [[ -e "$dest" ]]; then
  if [[ ! -d "$dest" ]]; then
    echo "IMMUTABLE_CONFLICT: $dest exists and is not a directory" >&2
    exit 2
  fi
  existing_sha="missing"
  existing_main="missing"
  existing_ver="missing"
  if [[ -x "$dest/fn" ]]; then
    existing_sha="$(sha256sum "$dest/fn" | awk '{print $1}')"
  fi
  if [[ -f "$dest/RELEASE_IDENTITY" ]]; then
    existing_main="$(grep -E '^MAIN_SHA=' "$dest/RELEASE_IDENTITY" | head -1 | cut -d= -f2- || echo missing)"
    existing_ver="$(grep -E '^VERSION=' "$dest/RELEASE_IDENTITY" | head -1 | cut -d= -f2- || echo missing)"
  fi
  if [[ "$existing_sha" == "$src_sha" && "$existing_main" == "$MAIN_SHA" && "$existing_ver" == "$VERSION" ]]; then
    ensure_current_symlink
    echo "IDEMPOTENT_NOOP $rel"
    exit 0
  fi
  echo "IMMUTABLE_CONFLICT: $dest exists with different identity (existing_sha=$existing_sha src_sha=$src_sha existing_main=$existing_main main=$MAIN_SHA)" >&2
  exit 2
fi

cleanup_stage() {
  [[ -d "$stage" ]] && rm -rf "$stage" || true
}
trap cleanup_stage EXIT

mkdir -p "$stage"
# FNXC:V1A.1 2026-07-30-10:55: cp -a preserves packaged modes (including execute bits on runtime helpers).
cp -a "$SRC_DIST/fn" "$stage/fn"
[[ -d "$SRC_DIST/client" ]] && cp -a "$SRC_DIST/client" "$stage/client"
[[ -d "$SRC_DIST/migrations" ]] && cp -a "$SRC_DIST/migrations" "$stage/migrations"
[[ -d "$SRC_DIST/runtime" ]] && cp -a "$SRC_DIST/runtime" "$stage/runtime"

stage_sha="$(sha256sum "$stage/fn" | awk '{print $1}')"
if [[ "$stage_sha" != "$src_sha" ]]; then
  echo "staged executable hash mismatch" >&2
  exit 1
fi
if [[ "$("$stage/fn" --version 2>/dev/null | head -1 | tr -d '\r')" != "$VERSION" ]]; then
  echo "staged version mismatch" >&2
  exit 1
fi

{
  echo "MAIN_SHA=$MAIN_SHA"
  echo "VERSION=$ver"
  echo "EXE_SHA256=$stage_sha"
  echo "release_id=$rel"
  echo "path=$dest"
  echo "installed_utc=$(date -u --iso-8601=seconds)"
} > "$stage/RELEASE_IDENTITY"

chown -R root:fusion "$stage"
# Directories must stay traversable; do not rewrite file modes to 0644.
find "$stage" -type d -exec chmod 0755 {} \;

if ! verify_stage_permissions "$SRC_DIST" "$stage"; then
  echo "PERMISSION_MISMATCH: refusing to publish $rel (pre-immutability check)" >&2
  exit 1
fi

# FNXC:V1A.1 2026-07-30-10:55: Immutability removes write bits only; execute bits from the package must survive.
chmod -R a-w "$stage" || true

if ! verify_stage_permissions "$SRC_DIST" "$stage"; then
  echo "PERMISSION_MISMATCH: refusing to publish $rel (post-immutability check)" >&2
  exit 1
fi

# Atomic publish: rename staged tree into the immutable release name (dest must not exist).
mv "$stage" "$dest"
trap - EXIT
ensure_current_symlink
echo "INSTALLED $rel"
