#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
TEST_ROOT="$(mktemp -d /tmp/codex-hud-session-name-XXXXXX)"
FAKE_BIN_DIR="$TEST_ROOT/bin"
PROJECT_DIR="$TEST_ROOT/new-topic-research"
LOG_FILE="$TEST_ROOT/tmux.log"
WRAPPER_LOG="$TEST_ROOT/wrapper.log"

cleanup() {
  rm -rf "$TEST_ROOT"
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

hash_cwd() {
  printf '%s' "$1" | md5sum | awk '{print substr($1, 1, 8)}'
}

expected_hash="$(hash_cwd "$PROJECT_DIR")"
expected_pattern="^codex-hud-new-topic-research-${expected_hash}-[0-9]{14}-[0-9]+$"

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

session_name="$(sed -n 's/^new-session .* -s \([^ ]*\).*/\1/p' "$LOG_FILE" | head -n1)"
if [[ -z "$session_name" ]]; then
  echo 'session name was not captured from fake tmux' >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

if [[ ! "$session_name" =~ $expected_pattern ]]; then
  echo "session name does not match project-readable format: $session_name" >&2
  echo "expected pattern: $expected_pattern" >&2
  exit 1
fi

if [[ "$session_name" =~ ^codex-hud-[0-9a-f]{8}- ]]; then
  echo "session name still begins with opaque hash-only prefix: $session_name" >&2
  exit 1
fi

echo "test-session-name-display: PASS (session=$session_name)"
