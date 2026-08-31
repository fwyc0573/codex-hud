#!/usr/bin/env bash
set -euo pipefail

# Verify the legacy Bash stepcode() environment contract still selects the
# StepCode launch profile when the caller has not migrated to --stepcode.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-legacy-stepcode-XXXXXX)"
FAKE_BIN_DIR="$TEST_ROOT/bin"
HOME_DIR="$TEST_ROOT/home"
ORDINARY_CODEX_HOME="$TEST_ROOT/ordinary-codex-home"
ORDINARY_SESSIONS_PATH="$TEST_ROOT/ordinary-sessions"
MANAGED_CODEX_HOME="$HOME_DIR/.stepcode/codex"
MANAGED_SESSIONS_PATH="$HOME_DIR/.codex/sessions"
SQLITE_ROOT="$MANAGED_CODEX_HOME/.codex-hud-sqlite"
WRAPPER_LOG="$TEST_ROOT/wrapper.log"
TMUX_LOG="$TEST_ROOT/tmux.log"
OUTPUT_LOG="$TEST_ROOT/output.log"
ZDOTDIR_DIR="$TEST_ROOT/zsh"

mkdir -p "$FAKE_BIN_DIR" "$HOME_DIR" "$ORDINARY_CODEX_HOME" "$ORDINARY_SESSIONS_PATH"

cat > "$FAKE_BIN_DIR/sptecode-codex" <<'FAKE_SPTECODE_CODEX'
#!/usr/bin/env bash
printf 'argc=%s\n' "$#" >> "${LEGACY_CLI_LOG:?}"
for arg in "$@"; do
  printf 'arg=<%s>\n' "$arg" >> "${LEGACY_CLI_LOG:?}"
done
exit 0
FAKE_SPTECODE_CODEX

cat > "$FAKE_BIN_DIR/codex" <<'FAKE_NATIVE_CODEX'
#!/usr/bin/env bash
printf 'native-codex\n' >> "${NATIVE_CLI_LOG:?}"
exit 0
FAKE_NATIVE_CODEX

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

cat > "$FAKE_BIN_DIR/tmux" <<'FAKE_TMUX'
#!/usr/bin/env bash
set -e

# Delegate normal lifecycle calls to the shared fake. Execute only the command
# passed to respawn-pane so the regression observes the real legacy argv.
if [[ "${1:-}" == "respawn-pane" && "${TMUX_EXECUTE_RESPAWN:-0}" == "1" ]]; then
  "${FAKE_TMUX_BASE:?}" "$@"
  respawn_command="${@: -1}"
  bash -c "$respawn_command"
  exit $?
fi
exec "${FAKE_TMUX_BASE:?}" "$@"
FAKE_TMUX
chmod +x "$FAKE_BIN_DIR/tmux"

# Restore the fixture PATH after the system login profile so the real zsh
# route still resolves the isolated fake tmux command.
mkdir -p "$ZDOTDIR_DIR"
printf 'export PATH=%q:$PATH\n' "$FAKE_BIN_DIR" > "$ZDOTDIR_DIR/.zprofile"

cat > "$TEST_ROOT/bash-fixture" <<'FIXTURE'
set -euo pipefail

stepcode() {
    if [[ "${1:-}" == "codex" ]]; then
        shift
        CODEX_HUD_CLI_PATH="$HOME/.local/bin/sptecode-codex" \
        CODEX_HUD_SESSION_PREFIX="stepcode-codex-hud" \
        CODEX_HUD_SHELL_PATH="/bin/zsh" \
        "$WRAPPER_PATH" \
            --new-session \
            --sandbox danger-full-access \
            --ask-for-approval never \
            "$@"
        return $?
    fi
    command stepcode "$@"
}

stepcode codex --legacy-route-probe
FIXTURE

mkdir -p "$HOME_DIR/.local/bin"
ln -s "$FAKE_BIN_DIR/sptecode-codex" "$HOME_DIR/.local/bin/sptecode-codex"

set +e
env \
  HOME="$HOME_DIR" \
  ZDOTDIR="$ZDOTDIR_DIR" \
  PATH="$FAKE_BIN_DIR:$FAKE_TMUX_DIR:/usr/bin:/bin" \
  FAKE_TMUX_BASE="$FAKE_TMUX_DIR/tmux" \
  WRAPPER_PATH="$ROOT_DIR/bin/codex-hud" \
  LEGACY_CLI_LOG="$TEST_ROOT/legacy-cli.log" \
  NATIVE_CLI_LOG="$TEST_ROOT/native-cli.log" \
  CODEX_HOME="$ORDINARY_CODEX_HOME" \
  CODEX_SESSIONS_PATH="$ORDINARY_SESSIONS_PATH" \
  CODEX_HUD_UPDATE_CHECK=0 \
  CODEX_HUD_SQLITE_ISOLATION=1 \
  CODEX_SQLITE_HOME= \
  CODEX_HUD_HEIGHT=5 \
  CODEX_HUD_HEIGHT_AUTO=0 \
  TMUX_LOG_FILE="$TMUX_LOG" \
  TMUX_MAIN_PANE_ID="%1" \
  TMUX_PANE_ID="%2" \
  TMUX_PANES=$'%1\n%2' \
  TMUX_SPLIT_PANE_ID="%2" \
  TMUX_BASE_HEIGHT=5 \
  TMUX_HEIGHT=5 \
  TMUX_HEIGHT_MIN=5 \
  TMUX_HEIGHT_MAX=12 \
  TMUX_AUTO=0 \
  TMUX_PANE_WIDTH=120 \
  TMUX_PANE_HEIGHT=5 \
  TMUX_EXECUTE_RESPAWN=1 \
  TMUX_SHOW_OPTION_DEFAULT=1 \
  bash --noprofile --norc -f "$TEST_ROOT/bash-fixture" >"$OUTPUT_LOG" 2>&1
status=$?
set -e

if [[ "$status" -ne 0 ]]; then
  echo "test-wrapper-legacy-stepcode-env: FAIL - fixture status=$status" >&2
  cat "$OUTPUT_LOG" >&2
  cat "$TMUX_LOG" >&2 || true
  exit 1
fi

launch_line="$(grep -m1 '^respawn-pane ' "$TMUX_LOG" || true)"
hud_line="$(grep -m1 '^split-window ' "$TMUX_LOG" || true)"
if [[ -z "$launch_line" || -z "$hud_line" ]]; then
  echo "test-wrapper-legacy-stepcode-env: FAIL - missing pane launch trace" >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

assert_contains() {
  local value="$1"
  local expected="$2"
  local label="$3"
  if [[ "$value" != *"$expected"* ]]; then
    echo "test-wrapper-legacy-stepcode-env: FAIL - $label missing: $expected" >&2
    echo "$value" >&2
    exit 1
  fi
}

assert_contains "$launch_line" "$HOME_DIR/.local/bin/sptecode-codex" "legacy CLI executable"
assert_contains "$launch_line" "$MANAGED_CODEX_HOME" "managed StepCode CODEX_HOME"
assert_contains "$launch_line" "$MANAGED_SESSIONS_PATH" "managed StepCode sessions path"
assert_contains "$launch_line" "$SQLITE_ROOT/" "launch-local SQLite home"
assert_contains "$launch_line" "/bin/zsh -ilc" "legacy shell path"
assert_contains "$hud_line" "CODEX_HOME='$MANAGED_CODEX_HOME'" "HUD managed CODEX_HOME"
assert_contains "$hud_line" "CODEX_SESSIONS_PATH='$MANAGED_SESSIONS_PATH'" "HUD managed sessions path"
assert_contains "$hud_line" "CODEX_SQLITE_HOME='$SQLITE_ROOT/" "HUD launch-local SQLite home"

if [[ ! -s "$TEST_ROOT/legacy-cli.log" ]]; then
  echo "test-wrapper-legacy-stepcode-env: FAIL - legacy executable was not run" >&2
  exit 1
fi
expected_legacy_argv=$'argc=5\narg=<--sandbox>\narg=<danger-full-access>\narg=<--ask-for-approval>\narg=<never>\narg=<--legacy-route-probe>'
if [[ "$(<"$TEST_ROOT/legacy-cli.log")" != "$expected_legacy_argv" ]]; then
  echo "test-wrapper-legacy-stepcode-env: FAIL - legacy executable argv changed" >&2
  cat "$TEST_ROOT/legacy-cli.log" >&2
  exit 1
fi

session_line="$(grep -m1 'Starting Codex with HUD' "$OUTPUT_LOG" || true)"
assert_contains "$session_line" "stepcode-codex-hud-" "legacy session prefix"

if [[ -s "$TEST_ROOT/native-cli.log" ]]; then
  echo "test-wrapper-legacy-stepcode-env: FAIL - native codex was selected" >&2
  cat "$TEST_ROOT/native-cli.log" >&2
  exit 1
fi

sqlite_home="${hud_line#*CODEX_SQLITE_HOME=\'}"
sqlite_home="${sqlite_home%%\'*}"
for database in state_5.sqlite goals_1.sqlite memories_1.sqlite; do
  link="$sqlite_home/$database"
  if [[ ! -L "$link" ]]; then
    echo "test-wrapper-legacy-stepcode-env: FAIL - missing metadata link: $link" >&2
    exit 1
  fi
  if [[ "$(readlink -f "$link")" != "$MANAGED_CODEX_HOME/$database" ]]; then
    echo "test-wrapper-legacy-stepcode-env: FAIL - metadata target mismatch: $link" >&2
    exit 1
  fi
done

echo "test-wrapper-legacy-stepcode-env: PASS (bash_route=stepcode, legacy_prefix=1, zsh_shell=1, native_route=0)"
