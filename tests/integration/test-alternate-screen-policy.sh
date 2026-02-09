#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
FAKE_BIN_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$FAKE_BIN_DIR"
}
trap cleanup EXIT

cat > "$FAKE_BIN_DIR/codex" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/node" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "v20.0.0"
  exit 0
fi
exit 0
FAKE

cat > "$FAKE_BIN_DIR/npm" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/tput" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == "lines" ]]; then
  echo "24"
  exit 0
fi
if [[ "${1:-}" == "cols" ]]; then
  echo "80"
  exit 0
fi
echo "0"
FAKE

chmod +x "$FAKE_BIN_DIR/codex" "$FAKE_BIN_DIR/node" "$FAKE_BIN_DIR/npm" "$FAKE_BIN_DIR/tput"

export PATH="$FAKE_BIN_DIR:$FAKE_TMUX_DIR:$PATH"
export CODEX_HUD_HEIGHT="5"
export CODEX_HUD_HEIGHT_AUTO="0"

prepare_tmux_env() {
  local log_file="$1"
  export TMUX_LOG_FILE="$log_file"
  export TMUX_SESSION_LIST=""
  export TMUX_MAIN_PANE_ID="%1"
  export TMUX_PANE_ID="%2"
  export TMUX_PANES=$'%1\n%2'
  export TMUX_SPLIT_PANE_ID="%2"
  export TMUX_BASE_HEIGHT="5"
  export TMUX_HEIGHT="5"
  export TMUX_HEIGHT_MIN="5"
  export TMUX_HEIGHT_MAX="12"
  export TMUX_AUTO="0"
  export TMUX_PANE_WIDTH="120"
  export TMUX_PANE_HEIGHT="5"
  export TMUX_MAIN_PANE_IN_MODE="0"
  export TMUX_REJECT_TARGET_0="1"
}

assert_window_option() {
  local label="$1"
  local expected="$2"
  local log_file
  log_file="$(mktemp)"

  prepare_tmux_env "$log_file"
  "$ROOT_DIR/bin/codex-hud" >/tmp/codex-hud-alt-screen.log 2>&1

  if ! grep -q "window:alternate-screen=${expected}" "$log_file"; then
    echo "[$label] expected alternate-screen=${expected}" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

unset CODEX_HUD_ALTERNATE_SCREEN
assert_window_option "default-off" "off"

export CODEX_HUD_ALTERNATE_SCREEN="1"
assert_window_option "explicit-on" "on"
unset CODEX_HUD_ALTERNATE_SCREEN

log_file_invalid="$(mktemp)"
prepare_tmux_env "$log_file_invalid"
export CODEX_HUD_ALTERNATE_SCREEN="maybe"
set +e
"$ROOT_DIR/bin/codex-hud" >/tmp/codex-hud-alt-screen.log 2>&1
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  echo "[invalid-alternate-screen] expected non-zero exit" >&2
  exit 1
fi
if ! grep -q 'CODEX_HUD_ALTERNATE_SCREEN must be one of' /tmp/codex-hud-alt-screen.log; then
  echo "[invalid-alternate-screen] expected validation error message" >&2
  cat /tmp/codex-hud-alt-screen.log >&2
  exit 1
fi
unset CODEX_HUD_ALTERNATE_SCREEN

echo "test-alternate-screen-policy: PASS"
