#!/usr/bin/env bash
set -euo pipefail

# Native HUD launches must copy the wrapper CODEX_HOME onto the tmux pane
# command. Otherwise an already-running tmux server keeps a different home.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-native-home-XXXXXX)"
BIN_DIR="$TEST_ROOT/bin"
HOME_DIR="$TEST_ROOT/home"
CHATGPT_HOME="$TEST_ROOT/codex-home-chatgpt"
ORDINARY_HOME="$TEST_ROOT/ordinary-codex-home"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$BIN_DIR" "$HOME_DIR" "$CHATGPT_HOME" "$ORDINARY_HOME"

cat > "$BIN_DIR/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
exit 0
FAKE_CODEX

cat > "$BIN_DIR/stepcode" <<'FAKE_STEPCODE'
#!/usr/bin/env bash
exit 0
FAKE_STEPCODE

cat > "$BIN_DIR/node" <<'FAKE_NODE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  printf 'v20.11.0\n'
fi
exit 0
FAKE_NODE

cat > "$BIN_DIR/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
exit 0
FAKE_NPM

cat > "$BIN_DIR/tput" <<'FAKE_TPUT'
#!/usr/bin/env bash
case "${1:-}" in
  lines) printf '24\n' ;;
  cols) printf '80\n' ;;
  *) printf '0\n' ;;
esac
FAKE_TPUT

chmod +x "$BIN_DIR"/*

common_env=(
  "HOME=$HOME_DIR"
  "PATH=$BIN_DIR:$SCRIPT_DIR/fake-tmux:/usr/bin:/bin"
  "CODEX_HUD_UPDATE_CHECK=0"
  "CODEX_HUD_HEIGHT=5"
  "CODEX_HUD_HEIGHT_AUTO=0"
  "TMUX_MAIN_PANE_ID=%1"
  "TMUX_PANE_ID=%2"
  $'TMUX_PANES=%1\n%2'
  "TMUX_SPLIT_PANE_ID=%2"
  "TMUX_BASE_HEIGHT=5"
  "TMUX_HEIGHT=5"
  "TMUX_HEIGHT_MIN=5"
  "TMUX_HEIGHT_MAX=12"
  "TMUX_AUTO=0"
  "TMUX_PANE_WIDTH=120"
  "TMUX_PANE_HEIGHT=5"
)

run_wrapper() {
  local log_file="$1"
  local output_file="$2"
  shift 2
  env -i "${common_env[@]}" TMUX_LOG_FILE="$log_file" "$@" \
    "$ROOT_DIR/bin/codex-hud" --new-session -p chatgpt \
    >"$output_file" 2>&1
}

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

assert_absent() {
  local value="$1"
  local unexpected="$2"
  local label="$3"
  if [[ "$value" == *"$unexpected"* ]]; then
    echo "$label unexpectedly contains: $unexpected" >&2
    echo "$value" >&2
    exit 1
  fi
}

PASSTHROUGH_LOG="$TEST_ROOT/passthrough.tmux.log"
PASSTHROUGH_OUT="$TEST_ROOT/passthrough.wrapper.log"
run_wrapper "$PASSTHROUGH_LOG" "$PASSTHROUGH_OUT" \
  "CODEX_HOME=$CHATGPT_HOME"

passthrough_launch="$(grep -m1 '^respawn-pane ' "$PASSTHROUGH_LOG" || true)"
passthrough_hud="$(grep -m1 '^split-window ' "$PASSTHROUGH_LOG" || true)"
if [[ -z "$passthrough_launch" || -z "$passthrough_hud" ]]; then
  echo "test-wrapper-native-codex-home-passthrough: missing native pane commands" >&2
  cat "$PASSTHROUGH_LOG" >&2
  exit 1
fi

assert_contains "$passthrough_launch" "CODEX_HOME='$CHATGPT_HOME'" "native main-pane wrapper CODEX_HOME"
assert_contains "$passthrough_hud" "CODEX_HOME='$CHATGPT_HOME'" "native HUD-pane wrapper CODEX_HOME"
assert_contains "$passthrough_launch" "'-p' 'chatgpt'" "forwarded chatgpt profile flag"
assert_absent "$passthrough_launch" "$ORDINARY_HOME" "native launch ordinary home leak"
assert_absent "$passthrough_hud" "$ORDINARY_HOME" "HUD pane ordinary home leak"

UNSET_LOG="$TEST_ROOT/unset.tmux.log"
UNSET_OUT="$TEST_ROOT/unset.wrapper.log"
run_wrapper "$UNSET_LOG" "$UNSET_OUT"

unset_launch="$(grep -m1 '^respawn-pane ' "$UNSET_LOG" || true)"
unset_hud="$(grep -m1 '^split-window ' "$UNSET_LOG" || true)"
if [[ -z "$unset_launch" || -z "$unset_hud" ]]; then
  echo "test-wrapper-native-codex-home-passthrough: missing unset-home pane commands" >&2
  cat "$UNSET_LOG" >&2
  exit 1
fi

assert_absent "$unset_launch" "CODEX_HOME=" "unset native launch must not invent CODEX_HOME"
assert_absent "$unset_hud" "CODEX_HOME=" "unset HUD pane must not invent CODEX_HOME"

echo "test-wrapper-native-codex-home-passthrough: PASS (native_passthrough=1, unset_no_inject=1, chatgpt_profile=1)"
