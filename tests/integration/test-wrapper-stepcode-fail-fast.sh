#!/usr/bin/env bash
set -euo pipefail

# Verify that StepCode mode rejects missing launch prerequisites before it
# creates a tmux session or starts any pane process.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER_PATH="${CODEX_HUD_WRAPPER:-$ROOT_DIR/bin/codex-hud}"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-stepcode-fail-fast-XXXXXX)"
COMMON_BIN="$TEST_ROOT/bin"
HOME_DIR="$TEST_ROOT/home"
TMUX_LOG="$TEST_ROOT/tmux.log"
mkdir -p "$COMMON_BIN" "$HOME_DIR"

cat > "$COMMON_BIN/tmux" <<'FAKE_TMUX'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${TMUX_LOG_FILE:?}"
exit 0
FAKE_TMUX

cat > "$COMMON_BIN/stepcode" <<'FAKE_STEPCODE'
#!/usr/bin/env bash
exit 0
FAKE_STEPCODE

cat > "$COMMON_BIN/node" <<'FAKE_NODE'
#!/usr/bin/env bash
exit 0
FAKE_NODE

chmod +x "$COMMON_BIN/tmux" "$COMMON_BIN/stepcode" "$COMMON_BIN/node"

assert_failure() {
  local label="$1"
  local expected="$2"
  shift 2
  local output_file="$TEST_ROOT/${label}.log"
  local status

  set +e
  "$@" >"$output_file" 2>&1
  status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    echo "[$label] expected a non-zero exit status" >&2
    cat "$output_file" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" "$output_file"; then
    echo "[$label] expected error text was not observed: $expected" >&2
    cat "$output_file" >&2
    exit 1
  fi
  if [[ -s "$TMUX_LOG" ]]; then
    echo "[$label] tmux was contacted before the prerequisite failure" >&2
    cat "$TMUX_LOG" >&2
    exit 1
  fi
  printf '%s: PASS (status=%s)\n' "$label" "$status"
}

: > "$TMUX_LOG"
assert_failure \
  "missing-home" \
  "HOME is required for the selected Codex launch profile." \
  env -u HOME \
    PATH="$COMMON_BIN:/usr/bin:/bin" \
    TMUX_LOG_FILE="$TMUX_LOG" \
    CODEX_HUD_UPDATE_CHECK=0 \
    "$WRAPPER_PATH" --stepcode --new-session

: > "$TMUX_LOG"
MISSING_STEPCODE_BIN="$TEST_ROOT/missing-stepcode-bin"
mkdir -p "$MISSING_STEPCODE_BIN"
cp "$COMMON_BIN/tmux" "$MISSING_STEPCODE_BIN/tmux"
cp "$COMMON_BIN/node" "$MISSING_STEPCODE_BIN/node"
chmod +x "$MISSING_STEPCODE_BIN/tmux" "$MISSING_STEPCODE_BIN/node"
assert_failure \
  "missing-stepcode" \
  "stepcode CLI is not found as an executable in PATH." \
  env \
    HOME="$HOME_DIR" \
    PATH="$MISSING_STEPCODE_BIN:/usr/bin:/bin" \
    TMUX_LOG_FILE="$TMUX_LOG" \
    CODEX_HUD_UPDATE_CHECK=0 \
    "$WRAPPER_PATH" --stepcode --new-session

if [[ -e "$HOME_DIR/.stepcode/codex" ]]; then
  echo "[missing-stepcode] managed CODEX_HOME was created before the executable check" >&2
  exit 1
fi

MISSING_NODE_HOME="$TEST_ROOT/missing-node-home"
MISSING_NODE_BIN="$TEST_ROOT/missing-node-bin"
mkdir -p "$MISSING_NODE_HOME" "$MISSING_NODE_BIN"
cp "$COMMON_BIN/tmux" "$MISSING_NODE_BIN/tmux"
cp "$COMMON_BIN/stepcode" "$MISSING_NODE_BIN/stepcode"
chmod +x "$MISSING_NODE_BIN/tmux" "$MISSING_NODE_BIN/stepcode"
: > "$TMUX_LOG"
assert_failure \
  "missing-node" \
  "Node.js is required but not installed." \
  env \
    HOME="$MISSING_NODE_HOME" \
    PATH="$MISSING_NODE_BIN:/usr/bin:/bin" \
    TMUX_LOG_FILE="$TMUX_LOG" \
    CODEX_HUD_UPDATE_CHECK=0 \
    "$WRAPPER_PATH" --stepcode --new-session

if [[ -e "$MISSING_NODE_HOME/.stepcode/codex" ]]; then
  echo "[missing-node] managed CODEX_HOME was created before the Node.js check" >&2
  exit 1
fi

echo "test-wrapper-stepcode-fail-fast: PASS"
