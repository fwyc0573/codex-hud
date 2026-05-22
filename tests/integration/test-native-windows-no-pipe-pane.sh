#!/usr/bin/env bash
set -euo pipefail

case "$(uname -s 2>/dev/null || true)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    echo "test-native-windows-no-pipe-pane: SKIP (requires native Windows Git Bash)"
    exit 0
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-hud-native-pipe.XXXXXX")"
FAKE_BIN="$TMP_DIR/bin"
TMUX_LOG="$TMP_DIR/tmux.log"
SESSION_FILE="$TMP_DIR/session-name.txt"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/codex" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN/node" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "v24.0.0"
  exit 0
fi
exit 0
FAKE

cat > "$FAKE_BIN/npm" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN/tmux" <<FAKE
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$TMUX_LOG"

cmd="\${1:-}"
case "\$cmd" in
  -V)
    echo "tmux 3.6a-win32"
    exit 0
    ;;
  new-session|set-option|set-window-option|send-keys|select-pane|set-hook|bind-key|resize-pane|kill-session)
    exit 0
    ;;
  list-panes)
    echo "%0"
    exit 0
    ;;
  split-window)
    echo "%1"
    exit 0
    ;;
  show-option)
    exit 0
    ;;
  has-session)
    exit 0
    ;;
  pipe-pane)
    exit 88
    ;;
  *)
    exit 0
    ;;
esac
FAKE

chmod +x "$FAKE_BIN/codex" "$FAKE_BIN/node" "$FAKE_BIN/npm" "$FAKE_BIN/tmux"

PATH="$FAKE_BIN:$PATH" \
CODEX_HUD_WINDOWS_BASH_EXE=/d/Git2/bin/bash.exe \
CODEX_HUD_WINDOWS_DEFER_ATTACH=1 \
CODEX_HUD_SESSION_NAME_FILE="$SESSION_FILE" \
CODEX_HUD_SCRIPT_DIR="$REPO_ROOT/bin" \
"$REPO_ROOT/bin/codex-hud" --new-session --version >/tmp/codex-hud-native-no-pipe.out 2>&1

if grep -q '^pipe-pane\b' "$TMUX_LOG"; then
  echo "native Windows launch should not call tmux pipe-pane because tmux-windows can terminate the server" >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if grep -q '^set-option .* default-shell\b' "$TMUX_LOG"; then
  echo "native Windows launch should not set tmux default-shell because tmux-windows can terminate the server" >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if grep -Eq '^new-session .* /d/Git2/bin/bash\.exe$' "$TMUX_LOG"; then
  echo "native Windows launch should start the main runner directly instead of a bare detached bash shell" >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if grep -Eq '^split-window .* /d/Git2/bin/bash\.exe$' "$TMUX_LOG"; then
  echo "native Windows launch should start the HUD runner directly instead of a bare detached bash shell" >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if grep -Eq '^send-keys .*bash /tmp/codex-hud-native\\..*/(main|hud)\\.sh' "$TMUX_LOG"; then
  echo "native Windows launch should not bootstrap runner scripts through send-keys" >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if [[ ! -s "$SESSION_FILE" ]]; then
  echo "native Windows launch should report the deferred session name" >&2
  cat /tmp/codex-hud-native-no-pipe.out >&2
  exit 1
fi

echo "test-native-windows-no-pipe-pane: PASS"
