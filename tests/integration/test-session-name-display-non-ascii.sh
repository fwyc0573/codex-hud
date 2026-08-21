#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
TEST_TMPDIR="${CODEX_HUD_TEST_TMPDIR:-${TMPDIR:-${XDG_RUNTIME_DIR:-$HOME/.cache}}}"
mkdir -p "$TEST_TMPDIR"
TEST_ROOT="$(mktemp -d "$TEST_TMPDIR/codex-hud-issue-16-XXXXXX")"
FAKE_BIN_DIR="$TEST_ROOT/bin"
PROJECT_DIR="$TEST_ROOT/业务熟悉"
LOG_FILE="$TEST_ROOT/tmux.log"
WRAPPER_LOG="$TEST_ROOT/wrapper.log"

cleanup() {
  find "$TEST_ROOT" -depth -delete
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN_DIR" "$PROJECT_DIR"

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

path_hash() {
  if command -v md5sum >/dev/null 2>&1; then
    printf "%s" "$1" | md5sum | awk '{print substr($1, 1, 8)}'
  elif command -v md5 >/dev/null 2>&1; then
    printf "%s" "$1" | md5 -q | cut -c1-8
  elif command -v shasum >/dev/null 2>&1; then
    printf "%s" "$1" | shasum -a 256 | awk '{print substr($1, 1, 8)}'
  else
    echo "No supported hash command is available" >&2
    exit 1
  fi
}

expected_hash="$(path_hash "$PROJECT_DIR")"
expected_prefix="codex-hud-proj-${expected_hash}-"

(
  cd "$PROJECT_DIR"
  set +e
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
  bash "$ROOT_DIR/bin/codex-hud" --new-session >"$WRAPPER_LOG" 2>&1
  wrapper_status=$?
  set -e
  if [[ "$wrapper_status" -ne 0 ]]; then
    cat "$WRAPPER_LOG" >&2
    cat "$LOG_FILE" >&2 || true
    exit "$wrapper_status"
  fi
)

if grep -q "Unable to derive a safe project name" "$WRAPPER_LOG"; then
  echo "wrapper still rejects a pure non-ASCII project name" >&2
  cat "$WRAPPER_LOG" >&2
  exit 1
fi

session_name="$(sed -n 's/^new-session .* -s \([^ ]*\).*/\1/p' "$LOG_FILE" | head -n1)"
if [[ -z "$session_name" ]]; then
  echo "session name was not captured from fake tmux" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

if [[ "$session_name" != "$expected_prefix"* ]]; then
  echo "session name does not use the path-hash fallback: $session_name" >&2
  echo "expected prefix: $expected_prefix" >&2
  exit 1
fi

if [[ "$session_name" =~ [^a-zA-Z0-9._-] ]]; then
  echo "session name contains unsafe characters: $session_name" >&2
  exit 1
fi

echo "test-session-name-display-non-ascii: PASS (session=$session_name, hash=$expected_hash)"
