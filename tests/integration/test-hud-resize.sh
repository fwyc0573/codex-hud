#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"

export PATH="$FAKE_TMUX_DIR:$PATH"

run_case() {
  local width="$1"
  local expected="$2"
  local log_file
  log_file="$(mktemp)"

  export TMUX_LOG_FILE="$log_file"
  export TMUX_PANE_ID="%1"
  export TMUX_BASE_HEIGHT="5"
  export TMUX_HEIGHT="5"
  export TMUX_AUTO=""
  export TMUX_HEIGHT_MIN="5"
  export TMUX_HEIGHT_MAX="12"
  export TMUX_PANE_WIDTH="$width"
  export TMUX_PANE_HEIGHT="5"
  export CODEX_HUD_HEIGHT_AUTO="1"

  "$ROOT_DIR/bin/codex-hud-resize" "session-1"

  if ! grep -q "@codex_hud_height=${expected}" "$log_file"; then
    echo "Expected height ${expected} for width ${width}, log:" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

run_case 120 5
run_case 90 6
run_case 70 7
run_case 50 8

echo "test-hud-resize: PASS"
