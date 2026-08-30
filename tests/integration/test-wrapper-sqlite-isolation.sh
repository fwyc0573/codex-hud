#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-sqlite-isolation-XXXXXX)"
FAKE_BIN_DIR="$TEST_ROOT/fake-bin"
HOME_DIR="$TEST_ROOT/home"
LOG_FILE="$TEST_ROOT/tmux.log"
OUTPUT_FILE="$TEST_ROOT/wrapper.log"
MANAGED_CODEX_HOME="$HOME_DIR/.stepcode/codex"
SQLITE_HOME="$MANAGED_CODEX_HOME/.codex-hud-sqlite"

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
  >"$OUTPUT_FILE" 2>&1

launch_line="$(grep -m1 '^respawn-pane ' "$LOG_FILE" || true)"
hud_line="$(grep -m1 '^split-window ' "$LOG_FILE" || true)"

if [[ -z "$launch_line" || -z "$hud_line" ]]; then
  echo "Expected StepCode and HUD pane launch commands." >&2
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

assert_contains "$launch_line" "CODEX_SQLITE_HOME='$SQLITE_HOME'" "StepCode sqlite home"
assert_contains "$hud_line" "CODEX_SQLITE_HOME='$SQLITE_HOME'" "HUD sqlite home"

for database in state_5.sqlite goals_1.sqlite memories_1.sqlite; do
  link="$SQLITE_HOME/$database"
  if [[ ! -L "$link" ]]; then
    echo "Expected $link to be a symlink to the existing state database." >&2
    exit 1
  fi
  if [[ "$(readlink -f "$link")" != "$MANAGED_CODEX_HOME/$database" ]]; then
    echo "Unexpected target for $link: $(readlink "$link")" >&2
    exit 1
  fi
done

if [[ -L "$SQLITE_HOME/logs_2.sqlite" ]]; then
  echo "The large shared logs database must stay out of the new sqlite home." >&2
  exit 1
fi

echo "test-wrapper-sqlite-isolation: PASS"
