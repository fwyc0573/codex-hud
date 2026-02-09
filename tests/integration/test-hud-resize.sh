#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"

export PATH="$FAKE_TMUX_DIR:$PATH"

run_case() {
  local width="$1"
  local expected="$2"
  local auto_setting="$3"
  local env_auto_setting="$4"
  local main_in_mode="$5"
  local focus_main="$6"
  local stored_main="$7"

  local log_file
  log_file="$(mktemp)"

  export TMUX_LOG_FILE="$log_file"
  export TMUX_MAIN_PANE_ID="%1"
  export TMUX_STORED_MAIN_PANE="$stored_main"
  export TMUX_PANE_ID="%2"
  export TMUX_PANES=$'%1\n%2'
  export TMUX_BASE_HEIGHT="5"
  export TMUX_HEIGHT="5"
  export TMUX_AUTO="$auto_setting"
  export TMUX_HEIGHT_MIN="5"
  export TMUX_HEIGHT_MAX="12"
  export TMUX_PANE_WIDTH="$width"
  export TMUX_PANE_HEIGHT="5"
  export TMUX_MAIN_PANE_IN_MODE="$main_in_mode"
  export TMUX_FOCUS_MAIN="$focus_main"

  if [[ -n "$env_auto_setting" ]]; then
    export CODEX_HUD_HEIGHT_AUTO="$env_auto_setting"
  else
    unset CODEX_HUD_HEIGHT_AUTO
  fi

  "$ROOT_DIR/bin/codex-hud-resize" "session-1"

  if [[ "$main_in_mode" == "1" ]]; then
    if grep -q "@codex_hud_height=" "$log_file"; then
      echo "Expected no resize/update when main pane is in copy-mode, log:" >&2
      cat "$log_file" >&2
      exit 1
    fi
    if grep -q "select-pane -t %1" "$log_file"; then
      echo "Expected no focus change when main pane is in copy-mode, log:" >&2
      cat "$log_file" >&2
      exit 1
    fi
    return
  fi

  if ! grep -q "@codex_hud_height=${expected}" "$log_file"; then
    echo "Expected height ${expected} for width ${width}, log:" >&2
    cat "$log_file" >&2
    exit 1
  fi

  if [[ "$focus_main" == "1" ]]; then
    if ! grep -q "select-pane -t %1" "$log_file"; then
      echo "Expected focus to return to main pane, log:" >&2
      cat "$log_file" >&2
      exit 1
    fi
  else
    if grep -q "select-pane -t %1" "$log_file"; then
      echo "Did not expect focus change when focus_main=0, log:" >&2
      cat "$log_file" >&2
      exit 1
    fi
  fi
}

# Default behavior (auto unset) should keep base height and refocus main pane.
run_case 70 5 "" "" "0" "1" "%1"

# Explicit auto mode keeps existing adaptive behavior.
run_case 120 5 "1" "" "0" "1" "%1"
run_case 90 6 "1" "" "0" "1" "%1"
run_case 70 7 "1" "" "0" "1" "%1"
run_case 50 8 "1" "" "0" "1" "%1"

# Copy-mode guard: no resize and no focus hop while main pane is in copy-mode.
run_case 50 8 "1" "" "1" "1" "%1"

# Focus guard can be disabled explicitly.
run_case 70 5 "" "" "0" "0" "%1"

# If stored main pane is stale, fallback still finds and focuses the real main pane.
run_case 70 5 "" "" "0" "1" "%9"

echo "test-hud-resize: PASS"
