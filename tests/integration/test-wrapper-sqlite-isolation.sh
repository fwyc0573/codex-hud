#!/usr/bin/env bash
set -euo pipefail

# Verify that SQLite isolation is opt-in and that concurrent opt-in HUD
# launches receive independent SQLite homes while persistent Codex metadata
# remains reachable from the stable profile.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-sqlite-isolation-XXXXXX)"
FAKE_BIN_DIR="$TEST_ROOT/fake-bin"
HOME_DIR="$TEST_ROOT/home"
LOG_FILE_1="$TEST_ROOT/tmux-1.log"
LOG_FILE_2="$TEST_ROOT/tmux-2.log"
OUTPUT_FILE_1="$TEST_ROOT/wrapper-1.log"
OUTPUT_FILE_2="$TEST_ROOT/wrapper-2.log"
DEFAULT_LOG_FILE="$TEST_ROOT/tmux-default.log"
DEFAULT_OUTPUT_FILE="$TEST_ROOT/wrapper-default.log"
MANAGED_CODEX_HOME="$HOME_DIR/.stepcode/codex"
SQLITE_ROOT="$MANAGED_CODEX_HOME/.codex-hud-sqlite"

mkdir -p "$FAKE_BIN_DIR" "$MANAGED_CODEX_HOME"
touch \
  "$MANAGED_CODEX_HOME/state_5.sqlite" \
  "$MANAGED_CODEX_HOME/goals_1.sqlite" \
  "$MANAGED_CODEX_HOME/memories_1.sqlite"

cat > "$FAKE_BIN_DIR/stepcode" <<'FAKE_STEPCODE'
#!/usr/bin/env bash
exit 0
FAKE_STEPCODE

cat > "$FAKE_BIN_DIR/node" <<'FAKE_NODE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  printf 'v20.11.0\n'
fi
exit 0
FAKE_NODE

cat > "$FAKE_BIN_DIR/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
exit 0
FAKE_NPM

cat > "$FAKE_BIN_DIR/tput" <<'FAKE_TPUT'
#!/usr/bin/env bash
case "${1:-}" in
  lines) printf '24\n' ;;
  cols) printf '80\n' ;;
  *) printf '0\n' ;;
esac
FAKE_TPUT

chmod +x "$FAKE_BIN_DIR"/*

export HOME="$HOME_DIR"
export CODEX_HUD_UPDATE_CHECK=0
export CODEX_HUD_HEIGHT=5
export CODEX_HUD_HEIGHT_AUTO=0
export PATH="$FAKE_BIN_DIR:$FAKE_TMUX_DIR:$PATH"
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

# Keep this regression hermetic when the caller's shell has an explicit
# CODEX_SQLITE_HOME or another Codex home configured.
unset CODEX_SQLITE_HOME CODEX_HOME CODEX_SESSIONS_PATH

run_wrapper() {
  local log_file="$1"
  local output_file="$2"
  shift 2
  env "$@" TMUX_LOG_FILE="$log_file" "$ROOT_DIR/bin/codex-hud" \
    --stepcode \
    --new-session \
    --sandbox danger-full-access \
    --ask-for-approval never \
    >"$output_file" 2>&1
}

unset CODEX_HUD_SQLITE_ISOLATION
run_wrapper "$DEFAULT_LOG_FILE" "$DEFAULT_OUTPUT_FILE"

default_launch_line="$(grep -m1 '^respawn-pane ' "$DEFAULT_LOG_FILE" || true)"
default_hud_line="$(grep -m1 '^split-window ' "$DEFAULT_LOG_FILE" || true)"
if [[ -z "$default_launch_line" || -z "$default_hud_line" ]]; then
  echo "Expected default main and HUD pane launch commands." >&2
  exit 1
fi
if [[ "$default_launch_line" == *"CODEX_SQLITE_HOME="* || "$default_hud_line" == *"CODEX_SQLITE_HOME="* ]]; then
  echo "Default HUD launches must preserve the official SQLite home without injection." >&2
  exit 1
fi
if [[ -e "$SQLITE_ROOT" ]]; then
  echo "Default HUD launches must not create the managed SQLite isolation tree: $SQLITE_ROOT" >&2
  exit 1
fi

run_wrapper "$LOG_FILE_1" "$OUTPUT_FILE_1" CODEX_HUD_SQLITE_ISOLATION=1 &
wrapper_pid_1=$!
run_wrapper "$LOG_FILE_2" "$OUTPUT_FILE_2" CODEX_HUD_SQLITE_ISOLATION=1 &
wrapper_pid_2=$!

set +e
wait "$wrapper_pid_1"
status_1=$?
wait "$wrapper_pid_2"
status_2=$?
set -e
if [[ "$status_1" -ne 0 || "$status_2" -ne 0 ]]; then
  echo "Concurrent HUD launches failed: status_1=$status_1 status_2=$status_2" >&2
  cat "$OUTPUT_FILE_1" "$OUTPUT_FILE_2" >&2
  exit 1
fi

launch_line_1="$(grep -m1 '^respawn-pane ' "$LOG_FILE_1" || true)"
launch_line_2="$(grep -m1 '^respawn-pane ' "$LOG_FILE_2" || true)"
hud_line_1="$(grep -m1 '^split-window ' "$LOG_FILE_1" || true)"
hud_line_2="$(grep -m1 '^split-window ' "$LOG_FILE_2" || true)"

extract_sqlite_home() {
  local launch_line="$1"
  local suffix="${launch_line#*CODEX_SQLITE_HOME=\'}"
  if [[ "$suffix" == "$launch_line" ]]; then
    echo "Launch command is missing CODEX_SQLITE_HOME: $launch_line" >&2
    exit 1
  fi
  printf '%s' "${suffix%%\'*}"
}

for line in "$launch_line_1" "$launch_line_2" "$hud_line_1" "$hud_line_2"; do
  if [[ -z "$line" ]]; then
    echo "Expected StepCode and HUD pane launch commands for both launches." >&2
    exit 1
  fi
done

sqlite_home_1="$(extract_sqlite_home "$launch_line_1")"
sqlite_home_2="$(extract_sqlite_home "$launch_line_2")"

if [[ "$sqlite_home_1" == "$sqlite_home_2" ]]; then
  echo "Parallel HUD launches must not share one SQLite home: $sqlite_home_1" >&2
  exit 1
fi

for sqlite_home in "$sqlite_home_1" "$sqlite_home_2"; do
  if [[ "$sqlite_home" != "$SQLITE_ROOT/"* ]]; then
    echo "Launch SQLite home must be scoped below $SQLITE_ROOT: $sqlite_home" >&2
    exit 1
  fi
  for database in state_5.sqlite goals_1.sqlite memories_1.sqlite; do
    link="$sqlite_home/$database"
    if [[ ! -L "$link" ]]; then
      echo "Expected $link to be a symlink to the existing state database." >&2
      exit 1
    fi
    if [[ "$(readlink -f "$link")" != "$MANAGED_CODEX_HOME/$database" ]]; then
      echo "Unexpected target for $link: $(readlink "$link")" >&2
      exit 1
    fi
  done

  if [[ -L "$sqlite_home/logs_2.sqlite" ]]; then
    echo "The shared logs database must stay out of $sqlite_home." >&2
    exit 1
  fi
done

if [[ "$hud_line_1" != *"CODEX_SQLITE_HOME='$sqlite_home_1'"* ]]; then
  echo "HUD pane did not inherit the first launch SQLite home." >&2
  exit 1
fi
if [[ "$hud_line_2" != *"CODEX_SQLITE_HOME='$sqlite_home_2'"* ]]; then
  echo "HUD pane did not inherit the second launch SQLite home." >&2
  exit 1
fi

echo "test-wrapper-sqlite-isolation: PASS (default_injection=0, default_tree=0, concurrent_launches=2, distinct_homes=2, persistent_links=6, shared_log_links=0)"
