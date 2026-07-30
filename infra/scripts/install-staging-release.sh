#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-30-07:55: Install packaged fn into immutable staging release dir + current symlink.
# FNXC:Phase2A 2026-07-30-07:55: Never rm -rf an existing named release; stage then rename; fail closed on identity mismatch; idempotent no-op on match.
# FNXC:V1A 2026-07-30-08:55: Optional third arg sets the immutable release ID so V1A can freeze v1a-0.74.0-beta.5-<short> without inventing a second layout or deleting prior phase2a releases.
# FNXC:V1A 2026-07-30-09:24: Validate RELEASE_ID_OVERRIDE as a single safe basename before joining privileged /opt/.../releases/${rel}; reject path separators, "..", whitespace, control chars, and leading-dot IDs so a malformed override cannot escape the release directory.
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
find "$stage" -type d -exec chmod 0755 {} \;
find "$stage" -type f -exec chmod 0644 {} \;
chmod 0755 "$stage/fn"
find "$stage" -type f -name '*.node' -exec chmod 0644 {} \; 2>/dev/null || true
chmod -R a-w "$stage" || true
chmod 0755 "$stage/fn"

# Atomic publish: rename staged tree into the immutable release name (dest must not exist).
mv "$stage" "$dest"
trap - EXIT
ensure_current_symlink
echo "INSTALLED $rel"
