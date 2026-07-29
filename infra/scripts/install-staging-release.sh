#!/usr/bin/env bash
# FNXC:Phase2A 2026-07-29-21:45: Install packaged fn into immutable staging release dir + current symlink.
# FNXC:Phase2A 2026-07-29-22:25: Write RELEASE_IDENTITY before freezing the release tree read-only.
set -euo pipefail
SRC_DIST="${1:-}"
MAIN_SHA="${2:-}"
VERSION="0.74.0-beta.5"
if [[ -z "$SRC_DIST" || -z "$MAIN_SHA" ]]; then
  echo "usage: $0 <packages/cli/dist> <main-sha>" >&2
  exit 1
fi
short="${MAIN_SHA:0:12}"
rel="phase2a-${VERSION}-${short}"
dest="/opt/appsolino-fusion/staging/releases/${rel}"
if [[ ! -x "$SRC_DIST/fn" ]]; then
  echo "missing $SRC_DIST/fn" >&2
  exit 1
fi
ver="$("$SRC_DIST/fn" --version 2>/dev/null | head -1 | tr -d '\r')"
if [[ "$ver" != "$VERSION" ]]; then
  echo "version mismatch: got '$ver' expected '$VERSION'" >&2
  exit 1
fi

rm -rf "$dest"
mkdir -p "$dest"
cp -a "$SRC_DIST/fn" "$dest/fn"
[[ -d "$SRC_DIST/client" ]] && cp -a "$SRC_DIST/client" "$dest/client"
[[ -d "$SRC_DIST/migrations" ]] && cp -a "$SRC_DIST/migrations" "$dest/migrations"
[[ -d "$SRC_DIST/runtime" ]] && cp -a "$SRC_DIST/runtime" "$dest/runtime"

sha="$(sha256sum "$dest/fn" | awk '{print $1}')"
{
  echo "MAIN_SHA=$MAIN_SHA"
  echo "VERSION=$ver"
  echo "EXE_SHA256=$sha"
  echo "release_id=$rel"
  echo "path=$dest"
  echo "installed_utc=$(date -u --iso-8601=seconds)"
} > "$dest/RELEASE_IDENTITY"

chown -R root:fusion "$dest"
find "$dest" -type d -exec chmod 0755 {} \;
find "$dest" -type f -exec chmod 0644 {} \;
chmod 0755 "$dest/fn"
find "$dest" -type f -name '*.node' -exec chmod 0644 {} \; 2>/dev/null || true
chmod -R a-w "$dest" || true
chmod 0755 "$dest/fn"

ln -sfn "$dest" /opt/appsolino-fusion/staging/current
chown -h root:fusion /opt/appsolino-fusion/staging/current

{
  echo "release_id=$rel"
  echo "path=$dest"
  echo "version=$ver"
  echo "executable_sha256=$sha"
  echo "main_sha=$MAIN_SHA"
  echo "installed_utc=$(date -u --iso-8601=seconds)"
} | tee /srv/appsolino-fusion/staging/state/release-identity.txt
chmod 0640 /srv/appsolino-fusion/staging/state/release-identity.txt
chown root:fusion /srv/appsolino-fusion/staging/state/release-identity.txt
echo "INSTALLED $rel"
