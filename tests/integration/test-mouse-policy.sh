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
  export TMUX_STORED_MAIN_PANE="%1"
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

assert_mouse_setting() {
  local label="$1"
  local expected="$2"
  local log_file
  log_file="$(mktemp)"

  prepare_tmux_env "$log_file"
  "$ROOT_DIR/bin/codex-hud" >/tmp/codex-hud-mouse.log 2>&1

  if ! grep -q "mouse=${expected}" "$log_file"; then
    echo "[$label] expected mouse=${expected}" >&2
    cat "$log_file" >&2
    exit 1
  fi

  if [[ "$expected" == "on" ]]; then
    if ! grep -q "wheel-scroll-lines=1" "$log_file"; then
      echo "[$label] expected wheel-scroll-lines=1 when mouse is on" >&2
      cat "$log_file" >&2
      exit 1
    fi
  fi
}

unset CODEX_HUD_MOUSE
assert_mouse_setting "default-on" "on"

export CODEX_HUD_MOUSE="0"
assert_mouse_setting "explicit-off" "off"
unset CODEX_HUD_MOUSE

invalid_log="$(mktemp)"
prepare_tmux_env "$invalid_log"
export CODEX_HUD_MOUSE="maybe"
set +e
"$ROOT_DIR/bin/codex-hud" >/tmp/codex-hud-mouse.log 2>&1
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  echo "[invalid-mouse] expected non-zero exit" >&2
  exit 1
fi
if ! grep -q 'CODEX_HUD_MOUSE must be one of' /tmp/codex-hud-mouse.log; then
  echo "[invalid-mouse] expected validation error message" >&2
  cat /tmp/codex-hud-mouse.log >&2
  exit 1
fi
unset CODEX_HUD_MOUSE

echo "test-mouse-policy: PASS"
