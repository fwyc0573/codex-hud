#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/codex-hud-nested-test-XXXXXX)"
FAKE_BIN="$TEST_ROOT/bin"
SOCKET="codexhud-nested-$$"
OUTER="outer-codex-hud-nested-$$"
OUTPUT="$TEST_ROOT/wrapper.log"

mkdir -p "$FAKE_BIN"
ln -s /bin/sh "$FAKE_BIN/codex"

cleanup() {
  TMUX= tmux -L "$SOCKET" -f /dev/null kill-server >/dev/null 2>&1 || true
}
trap cleanup EXIT

export PATH="$FAKE_BIN:$PATH"
export CODEX_HUD_UPDATE_CHECK=1
export CODEX_HUD_HEIGHT=5
export TERM=xterm-256color

outer_command="env PATH='$PATH' CODEX_HUD_UPDATE_CHECK=1 CODEX_HUD_HEIGHT=5 TERM=xterm-256color '$ROOT_DIR/bin/codex-hud' --new-session >'$OUTPUT' 2>&1; printf 'wrapper_rc=%s\\n' \"\$?\" >>'$OUTPUT'; sleep 30"
TMUX= tmux -L "$SOCKET" -f /dev/null new-session -d -s "$OUTER" "$outer_command"

sleep 1
session_count=$(TMUX= tmux -L "$SOCKET" -f /dev/null list-sessions -F '#{session_name}' | grep -c '^codex-hud-' || true)
if [[ "$session_count" -ne 1 ]]; then
  echo "expected one nested codex-hud session, found $session_count" >&2
  cat "$OUTPUT" >&2 || true
  exit 1
fi
if ! grep -q 'Update check skipped: local stable version is unknown' "$OUTPUT"; then
  echo 'expected the launch-time update check diagnostic in the nested launch output' >&2
  cat "$OUTPUT" >&2 || true
  exit 1
fi
if grep -q 'sessions should be nested with care' "$OUTPUT"; then
  echo 'nested tmux attach warning must not be emitted' >&2
  cat "$OUTPUT" >&2
  exit 1
fi

inner_session=$(TMUX= tmux -L "$SOCKET" -f /dev/null list-sessions -F '#{session_name}' | grep '^codex-hud-' | head -n1)
TMUX= tmux -L "$SOCKET" -f /dev/null detach-client -s "$inner_session"
for _ in {1..20}; do
  grep -q '^wrapper_rc=' "$OUTPUT" && break
  sleep 0.05
done
if ! grep -q '^wrapper_rc=0$' "$OUTPUT"; then
  echo 'nested attach did not return cleanly after the client detached' >&2
  cat "$OUTPUT" >&2 || true
  exit 1
fi
if ! TMUX= tmux -L "$SOCKET" -f /dev/null has-session -t "$inner_session"; then
  echo 'detaching the nested client destroyed the still-running HUD session' >&2
  cat "$OUTPUT" >&2 || true
  exit 1
fi
if ! TMUX= tmux -L "$SOCKET" -f /dev/null has-session -t "$OUTER"; then
  echo 'outer tmux session disappeared after nested codex-hud session closed' >&2
  exit 1
fi

# A real Codex/session exit remains responsible for the final session closure.
TMUX= tmux -L "$SOCKET" -f /dev/null kill-session -t "$inner_session"

echo 'test-nested-tmux-launch: PASS'
