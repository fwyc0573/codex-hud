#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
TEST_ROOT="$(mktemp -d /tmp/codex-hud-height-XXXXXX)"
FAKE_BIN_DIR="$TEST_ROOT/bin"

mkdir -p "$FAKE_BIN_DIR"

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
  lines) echo "60" ;;
  cols) echo "120" ;;
  *) echo "0" ;;
esac
FAKE

chmod +x "$FAKE_BIN_DIR/codex" "$FAKE_BIN_DIR/node" "$FAKE_BIN_DIR/npm" "$FAKE_BIN_DIR/tput"

run_case() {
  local label="$1"
  local expected="$2"
  local requested="$3"
  local log_file="$TEST_ROOT/${label}.tmux.log"
  local output_file="$TEST_ROOT/${label}.wrapper.log"

  local -a wrapper_env=(
    "PATH=$FAKE_BIN_DIR:$FAKE_TMUX_DIR:$PATH"
    "HOME=$TEST_ROOT/home"
    "CODEX_HOME=$TEST_ROOT/codex-home"
    "CODEX_HUD_UPDATE_CHECK=0"
    "CODEX_HUD_HEIGHT_AUTO=0"
    "TMUX_LOG_FILE=$log_file"
    "TMUX_MAIN_PANE_ID=%1"
    "TMUX_PANE_ID=%2"
    $'TMUX_PANES=%1\n%2'
    "TMUX_SPLIT_PANE_ID=%2"
    "TMUX_BASE_HEIGHT=$expected"
    "TMUX_HEIGHT=$expected"
    "TMUX_HEIGHT_MIN=5"
    "TMUX_HEIGHT_MAX=12"
    "TMUX_AUTO=0"
    "TMUX_PANE_WIDTH=120"
    "TMUX_PANE_HEIGHT=1"
    "TMUX_MAIN_PANE_IN_MODE=0"
  )

  if [[ -n "$requested" ]]; then
    wrapper_env+=("CODEX_HUD_HEIGHT=$requested")
  fi

  env -u CODEX_HUD_HEIGHT "${wrapper_env[@]}" \
    bash "$ROOT_DIR/bin/codex-hud" --new-session >"$output_file" 2>&1

  local split_line
  split_line="$(grep -m1 '^split-window ' "$log_file" || true)"
  if [[ "$split_line" != *" -l $expected "* ]]; then
    echo "Expected split-window height $expected for $label, log:" >&2
    cat "$log_file" >&2
    exit 1
  fi

  if ! grep -q "^resize=$expected$" "$log_file"; then
    echo "Expected resize-pane height $expected for $label, log:" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

run_case default 5 ""
run_case explicit 7 7

echo "test-default-hud-height: PASS (default=5 explicit=7)"
