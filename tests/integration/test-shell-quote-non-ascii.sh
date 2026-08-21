#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER_PATH="${CODEX_HUD_WRAPPER:-$ROOT_DIR/bin/codex-hud}"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
TEST_TMPDIR="${CODEX_HUD_TEST_TMPDIR:-${TMPDIR:-${XDG_RUNTIME_DIR:-$HOME/.cache}}}"
mkdir -p "$TEST_TMPDIR"
TEST_ROOT="$(mktemp -d "$TEST_TMPDIR/codex-hud-shell-quote-XXXXXX")"
trap 'find "$TEST_ROOT" -depth -delete >/dev/null 2>&1 || true' EXIT

PROJECT_DIR="$TEST_ROOT/业务熟悉/it's a project"
FAKE_BIN_DIR="$TEST_ROOT/bin"
LOG_FILE="$TEST_ROOT/tmux.log"
WRAPPER_LOG="$TEST_ROOT/wrapper.log"
MARKER_FILE="$TEST_ROOT/injected"
mkdir -p "$PROJECT_DIR" "$FAKE_BIN_DIR"

FUNCTIONS_FILE="$TEST_ROOT/functions.sh"
sed -n '/^shell_quote()/,/^}/p' "$WRAPPER_PATH" > "$FUNCTIONS_FILE"

LC_ALL=C bash -c '
set -euo pipefail
source "$1"

quoted="$(shell_quote "$2")"
resolved="$(/bin/sh -c "cd $quoted && pwd")"
if [[ "$resolved" != "$2" ]]; then
  printf "POSIX shell resolved %q as %q\n" "$2" "$resolved" >&2
  exit 1
fi

argument="业务; printf injected"
quoted_argument="$(shell_quote "$argument")"
resolved_argument="$(/bin/sh -c "printf %s $quoted_argument")"
if [[ "$resolved_argument" != "$argument" ]]; then
  printf "POSIX shell changed argument %q into %q\n" "$argument" "$resolved_argument" >&2
  exit 1
fi
' _ "$FUNCTIONS_FILE" "$PROJECT_DIR"

cat > "$FAKE_BIN_DIR/codex" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/node" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "v20.0.0"
fi
exit 0
FAKE

cat > "$FAKE_BIN_DIR/npm" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/tput" <<'FAKE'
#!/usr/bin/env bash
case "${1:-}" in
  lines) echo "24" ;;
  cols) echo "120" ;;
  *) echo "0" ;;
esac
FAKE

chmod +x "$FAKE_BIN_DIR/codex" "$FAKE_BIN_DIR/node" "$FAKE_BIN_DIR/npm" "$FAKE_BIN_DIR/tput"

PROMPT="业务; touch $MARKER_FILE"
(
  cd "$PROJECT_DIR"
  LC_ALL=C \
  LANG=C \
  PATH="$FAKE_BIN_DIR:$FAKE_TMUX_DIR:$PATH" \
  HOME="$TEST_ROOT/home" \
  CODEX_HOME="$TEST_ROOT/codex-home" \
  CODEX_HUD_UPDATE_CHECK=0 \
  CODEX_HUD_HEIGHT=5 \
  CODEX_HUD_HEIGHT_AUTO=0 \
  TMUX= \
  TMUX_LOG_FILE="$LOG_FILE" \
  TMUX_MAIN_PANE_ID="%1" \
  TMUX_PANE_ID="%2" \
  TMUX_PANES=$'%1\n%2' \
  TMUX_SPLIT_PANE_ID="%2" \
  TMUX_BASE_HEIGHT=5 \
  TMUX_HEIGHT=5 \
  TMUX_HEIGHT_MIN=5 \
  TMUX_HEIGHT_MAX=12 \
  TMUX_AUTO=0 \
  TMUX_PANE_WIDTH=120 \
  TMUX_PANE_HEIGHT=5 \
  TMUX_MAIN_PANE_IN_MODE=0 \
  bash "$WRAPPER_PATH" --new-session "$PROMPT" >"$WRAPPER_LOG" 2>&1
)

respawn_command="$(sed -n 's/^respawn-pane -k -t [^ ]* //p' "$LOG_FILE" | head -n1)"
if [[ -z "$respawn_command" ]]; then
  echo "respawn-pane command was not captured" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

if ! /bin/sh -c "${respawn_command%%; tmux kill-session*}: true" >/dev/null 2>&1; then
  echo "POSIX shell could not parse the generated cwd command" >&2
  printf '%s\n' "$respawn_command" >&2
  exit 1
fi

if [[ -e "$MARKER_FILE" ]]; then
  echo "prompt text was executed as shell syntax" >&2
  exit 1
fi

echo "test-shell-quote-non-ascii: PASS (cwd=$PROJECT_DIR)"
