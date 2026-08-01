#!/usr/bin/env bash
# FNXC:AppsolinoAuto3 2026-08-01-01:20:
# Forced-command SSH wrapper for appsolino-deploy. Public-key only, no agent/
# port forwarding. Accepts only allow-listed AUTO-3 receive/deploy commands.
# Never opens an interactive shell. Never targets Host P.
set -euo pipefail

ENTRY="${AUTO3_DEPLOY_ENTRY:-/usr/local/sbin/auto3-deploy.sh}"
INBOX="${AUTO3_INBOX:-/var/lib/appsolino-deploy/inbox}"
mkdir -p "$INBOX"
chmod 0750 "$INBOX" 2>/dev/null || true

cmd="${SSH_ORIGINAL_COMMAND:-}"
if [[ -z "$cmd" ]]; then
  echo "AUTO3_SSH_DENIED: empty command" >&2
  exit 1
fi

# Reject Host P / production markers in the command string.
if grep -Eiq 'production|Host[[:space:]]*P|fusion_production|/opt/appsolino-fusion/production' <<<"$cmd"; then
  echo "AUTO3_SSH_DENIED: Host P / production marker" >&2
  exit 1
fi

case "$cmd" in
  "auto3-receive "*)
    # auto3-receive <archive-basename>   — writes stdin to inbox (1.5 GiB cap)
    base="${cmd#auto3-receive }"
    base="$(basename "$base")"
    if [[ ! "$base" =~ ^[A-Za-z0-9._-]{1,200}$ ]]; then
      echo "AUTO3_SSH_DENIED: bad archive name" >&2
      exit 1
    fi
    dest="$INBOX/$base"
    python3 - "$dest" <<'PY'
import sys
dest = sys.argv[1]
cap = 1536 * 1024 * 1024
written = 0
with open(dest, "wb") as out:
    while True:
        chunk = sys.stdin.buffer.read(1024 * 1024)
        if not chunk:
            break
        written += len(chunk)
        if written > cap:
            out.close()
            import os
            os.remove(dest)
            raise SystemExit("AUTO3_SSH_DENIED: archive exceeds size cap")
        out.write(chunk)
print(written)
PY
    chmod 0640 "$dest"
    sha256sum "$dest" | awk '{print $1}'
    ;;
  "auto3-deploy "*)
    # auto3-deploy --archive NAME --manifest NAME [--profile staging|proof] [--force-smoke-fail] [--skip-probe]
    # shellcheck disable=SC2086
    args=(${cmd#auto3-deploy })
    archive=""
    manifest=""
    profile="staging"
    extra=()
    i=0
    while [[ $i -lt ${#args[@]} ]]; do
      a="${args[$i]}"
      case "$a" in
        --archive)
          i=$((i + 1))
          archive="$(basename "${args[$i]}")"
          ;;
        --manifest)
          i=$((i + 1))
          manifest="$(basename "${args[$i]}")"
          ;;
        --profile)
          i=$((i + 1))
          profile="${args[$i]}"
          ;;
        --force-smoke-fail|--skip-probe)
          extra+=("$a")
          ;;
        *)
          echo "AUTO3_SSH_DENIED: arg $a" >&2
          exit 1
          ;;
      esac
      i=$((i + 1))
    done
    [[ "$profile" == "staging" || "$profile" == "proof" ]] || { echo "AUTO3_SSH_DENIED: profile" >&2; exit 1; }
    [[ -n "$archive" && -n "$manifest" ]] || { echo "AUTO3_SSH_DENIED: archive/manifest required" >&2; exit 1; }
    [[ -f "$INBOX/$archive" && -f "$INBOX/$manifest" ]] || { echo "AUTO3_SSH_DENIED: inbox files missing" >&2; exit 1; }
    exec sudo -n "$ENTRY" deploy --archive "$INBOX/$archive" --manifest "$INBOX/$manifest" --profile "$profile" "${extra[@]}"
    ;;
  "auto3-ping")
    echo "AUTO3_PONG"
    ;;
  *)
    echo "AUTO3_SSH_DENIED: command not allow-listed" >&2
    exit 1
    ;;
esac
