#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SENTINEL_SOCKET="codexhud-test-isolation-$$"
SENTINEL_SESSION="sentinel-$$"

cleanup() {
  TMUX= tmux -L "$SENTINEL_SOCKET" -f /dev/null kill-server >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Keep this regression completely separate from the user's default tmux server.
TMUX= tmux -L "$SENTINEL_SOCKET" -f /dev/null new-session -d -s "$SENTINEL_SESSION" "sleep 60"
socket_path=$(TMUX= tmux -L "$SENTINEL_SOCKET" -f /dev/null display-message -p -t "$SENTINEL_SESSION" '#{socket_path}')
session_id=$(TMUX= tmux -L "$SENTINEL_SOCKET" -f /dev/null display-message -p -t "$SENTINEL_SESSION" '#{session_id}')
inherited_tmux="$socket_path,$$,${session_id#\$}"

# The target smoke test currently removes only its own temporary directories.
# Disable that cleanup here so this regression itself never invokes rm.
rm() { :; }
export -f rm

set +e
TMUX="$inherited_tmux" CODEX_HUD_UPDATE_CHECK=0 \
  bash "$SCRIPT_DIR/test-wrapper-base-index-smoke.sh"
smoke_status=$?
set -e

if [[ "$smoke_status" -ne 0 ]]; then
  echo "The base-index smoke test failed before the isolation assertion." >&2
  exit 1
fi

if ! TMUX= tmux -L "$SENTINEL_SOCKET" -f /dev/null has-session -t "$SENTINEL_SESSION" 2>/dev/null; then
  echo "The base-index smoke test escaped its fixture and terminated the inherited tmux server." >&2
  exit 1
fi

set +e
TMUX="$inherited_tmux" CODEX_HUD_UPDATE_CHECK=0 \
  bash "$SCRIPT_DIR/../test-e2e.sh"
e2e_status=$?
set -e

if [[ "$e2e_status" -ne 0 ]]; then
  echo "The legacy e2e test failed before the isolation assertion." >&2
  exit 1
fi

if ! TMUX= tmux -L "$SENTINEL_SOCKET" -f /dev/null has-session -t "$SENTINEL_SESSION" 2>/dev/null; then
  echo "The legacy e2e test escaped its fixture and terminated the inherited tmux server." >&2
  exit 1
fi

echo "test-wrapper-test-tmux-isolation: PASS"
