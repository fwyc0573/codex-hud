#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-stepcode-launch-XXXXXX)"
FAKE_BIN_DIR="$TEST_ROOT/fake bin"
HOME_DIR="$TEST_ROOT/home"
LOG_FILE="$TEST_ROOT/tmux.log"
OUTPUT_FILE="$TEST_ROOT/wrapper.log"
ORDINARY_CODEX_HOME="$TEST_ROOT/ordinary-codex-home"
ORDINARY_SESSIONS_PATH="$TEST_ROOT/ordinary-sessions"
MANAGED_CODEX_HOME="$HOME_DIR/.stepcode/codex"
MANAGED_SESSIONS_PATH="$HOME_DIR/.codex/sessions"

mkdir -p "$FAKE_BIN_DIR" "$HOME_DIR" "$ORDINARY_CODEX_HOME" "$ORDINARY_SESSIONS_PATH"

cat > "$FAKE_BIN_DIR/stepcode" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/codex" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/node" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "v20.11.0"
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
  lines) echo 24 ;;
  cols) echo 80 ;;
  *) echo 0 ;;
esac
FAKE

chmod +x "$FAKE_BIN_DIR/stepcode" "$FAKE_BIN_DIR/codex" \
  "$FAKE_BIN_DIR/node" "$FAKE_BIN_DIR/npm" "$FAKE_BIN_DIR/tput"

export HOME="$HOME_DIR"
export CODEX_HOME="$ORDINARY_CODEX_HOME"
export CODEX_SESSIONS_PATH="$ORDINARY_SESSIONS_PATH"
export CODEX_HUD_UPDATE_CHECK=0
export CODEX_HUD_HEIGHT=5
export CODEX_HUD_HEIGHT_AUTO=0
export PATH="$FAKE_BIN_DIR:$FAKE_TMUX_DIR:$PATH"
export TMUX_LOG_FILE="$LOG_FILE"
export TMUX_MAIN_PANE_ID="%1"
export TMUX_PANE_ID="%2"
export TMUX_PANES=$'%1\n%2'
export TMUX_SPLIT_PANE_ID="%2"
export TMUX_BASE_HEIGHT=5
export TMUX_HEIGHT=5
export TMUX_HEIGHT_MIN=5
export TMUX_HEIGHT_MAX=12
export TMUX_AUTO=0
export TMUX_PANE_WIDTH=120
export TMUX_PANE_HEIGHT=5

"$ROOT_DIR/bin/codex-hud" \
  --stepcode \
  --new-session \
  --sandbox danger-full-access \
  --ask-for-approval never \
  -c 'model_reasoning_effort="high"' \
  -c model_auto_compact_token_limit=200000 \
  -c model_providers.stepcode-api.stream_idle_timeout_ms=600000 \
  >"$OUTPUT_FILE" 2>&1

launch_line="$(grep -m1 '^respawn-pane ' "$LOG_FILE" || true)"
hud_line="$(grep -m1 '^split-window ' "$LOG_FILE" || true)"

if [[ -z "$launch_line" ]]; then
  echo "Expected a direct StepCode launch command." >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

if [[ -z "$hud_line" ]]; then
  echo "Expected a HUD pane launch command." >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

assert_contains() {
  local value="$1"
  local expected="$2"
  local label="$3"
  if [[ "$value" != *"$expected"* ]]; then
    echo "$label is missing: $expected" >&2
    echo "$value" >&2
    exit 1
  fi
}

assert_contains "$launch_line" "CODEX_HOME='$MANAGED_CODEX_HOME'" "StepCode launcher managed CODEX_HOME"
assert_contains "$launch_line" "CODEX_SESSIONS_PATH='$MANAGED_SESSIONS_PATH'" "StepCode launcher stable sessions path"
assert_contains "$launch_line" "'$FAKE_BIN_DIR/stepcode' 'codex'" "StepCode launcher executable"
assert_contains "$launch_line" "CODEX_HOME='$MANAGED_CODEX_HOME'" "main-pane managed CODEX_HOME"
assert_contains "$launch_line" "CODEX_SESSIONS_PATH='$MANAGED_SESSIONS_PATH'" "main-pane stable sessions path"
assert_contains "$launch_line" "tmux detach-client -s '" "session-scoped exit teardown"
assert_contains "$hud_line" "CODEX_HOME='$MANAGED_CODEX_HOME'" "HUD-pane managed CODEX_HOME"
assert_contains "$hud_line" "CODEX_SESSIONS_PATH='$MANAGED_SESSIONS_PATH'" "HUD-pane stable sessions path"

for argument in \
  "'--sandbox' 'danger-full-access'" \
  "'--ask-for-approval' 'never'" \
  "'-c' 'model_reasoning_effort=\"high\"'" \
  "'-c' 'model_auto_compact_token_limit=200000'" \
  "'-c' 'model_providers.stepcode-api.stream_idle_timeout_ms=600000'"; do
  assert_contains "$launch_line" "$argument" "forwarded StepCode argument"
done

if [[ "$launch_line" == *"$FAKE_BIN_DIR/codex"* ]]; then
  echo "StepCode mode resolved the ordinary codex executable." >&2
  echo "$launch_line" >&2
  exit 1
fi

if [[ "$launch_line" == *"$ORDINARY_CODEX_HOME"* || "$hud_line" == *"$ORDINARY_CODEX_HOME"* ]]; then
  echo "StepCode mode leaked the ordinary CODEX_HOME." >&2
  echo "launch=$launch_line" >&2
  echo "hud=$hud_line" >&2
  exit 1
fi

if [[ "$launch_line" == *"$ORDINARY_SESSIONS_PATH"* || "$hud_line" == *"$ORDINARY_SESSIONS_PATH"* ]]; then
  echo "StepCode mode leaked the inherited CODEX_SESSIONS_PATH." >&2
  echo "launch=$launch_line" >&2
  echo "hud=$hud_line" >&2
  exit 1
fi

: > "$LOG_FILE"
stepcode_session="$(sed -n 's/.*session: \([^)]*\)).*/\1/p' "$OUTPUT_FILE" | head -n1)"
if [[ -z "$stepcode_session" ]]; then
  echo "Unable to extract the StepCode session identity from the launch output." >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi
export TMUX_SESSION_LIST="$stepcode_session"
"$ROOT_DIR/bin/codex-hud" --stepcode --kill >"$OUTPUT_FILE" 2>&1

if ! grep -q '^kill-session ' "$LOG_FILE"; then
  echo "StepCode management mode did not kill the selected StepCode session." >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

if grep -q '^new-session ' "$LOG_FILE"; then
  echo "StepCode management mode unexpectedly created a new session." >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

echo "test-wrapper-stepcode-launch: PASS (stepcode_management_kill=1)"
