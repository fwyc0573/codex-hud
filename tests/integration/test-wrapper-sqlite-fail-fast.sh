#!/usr/bin/env bash
set -euo pipefail

# Exercise the SQLite path ownership and preflight failures before tmux is
# contacted. The test intentionally leaves its temporary evidence directory in
# /data/ycfeng/tmp for post-run inspection.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-sqlite-fail-fast-XXXXXX)"
FAKE_BIN_DIR="$TEST_ROOT/bin"
HOME_DIR="$TEST_ROOT/home"
EXPLICIT_SQLITE_HOME="$TEST_ROOT/explicit sqlite home"
mkdir -p "$FAKE_BIN_DIR" "$HOME_DIR"

cat > "$FAKE_BIN_DIR/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
exit 0
FAKE_CODEX

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

chmod +x "$FAKE_BIN_DIR/codex" "$FAKE_BIN_DIR/node" "$FAKE_BIN_DIR/npm" "$FAKE_BIN_DIR/tput"

common_env=(
  "HOME=$HOME_DIR"
  "PATH=$FAKE_BIN_DIR:$FAKE_TMUX_DIR:/usr/bin:/bin"
  "CODEX_HUD_UPDATE_CHECK=0"
  "CODEX_HUD_SQLITE_ISOLATION=1"
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
  env -i "${common_env[@]}" "TMUX_LOG_FILE=$log_file" "$@" \
    "$ROOT_DIR/bin/codex-hud" --new-session >"$output_file" 2>&1
}

run_wrapper_allow_failure() {
  local log_file="$1"
  local output_file="$2"
  shift 2
  set +e
  env -i "${common_env[@]}" "TMUX_LOG_FILE=$log_file" "$@" \
    "$ROOT_DIR/bin/codex-hud" --new-session >"$output_file" 2>&1
  local status=$?
  set -e
  printf '%s\n' "$status"
}

assert_contains() {
  local file="$1"
  local expected="$2"
  local label="$3"
  if ! grep -Fq -- "$expected" "$file"; then
    echo "$label: expected text was not observed: $expected" >&2
    sed -n '1,120p' "$file" >&2 || true
    exit 1
  fi
}

assert_no_tmux() {
  local file="$1"
  if [[ -s "$file" ]]; then
    echo "tmux was contacted before SQLite preflight failed:" >&2
    sed -n '1,120p' "$file" >&2
    exit 1
  fi
}

# An explicit caller path remains authoritative and receives no managed
# metadata links.
EXPLICIT_LOG="$TEST_ROOT/explicit.tmux.log"
EXPLICIT_OUTPUT="$TEST_ROOT/explicit.output.log"
run_wrapper "$EXPLICIT_LOG" "$EXPLICIT_OUTPUT" \
  "CODEX_HUD_SQLITE_ISOLATION=1" \
  "CODEX_SQLITE_HOME=$EXPLICIT_SQLITE_HOME"
explicit_launch="$(grep -m1 '^respawn-pane ' "$EXPLICIT_LOG" || true)"
explicit_hud="$(grep -m1 '^split-window ' "$EXPLICIT_LOG" || true)"
assert_contains <(printf '%s\n' "$explicit_launch") "CODEX_SQLITE_HOME='$EXPLICIT_SQLITE_HOME'" "explicit main-pane path"
assert_contains <(printf '%s\n' "$explicit_hud") "CODEX_SQLITE_HOME='$EXPLICIT_SQLITE_HOME'" "explicit HUD path"
if [[ -e "$EXPLICIT_SQLITE_HOME" ]]; then
  echo "explicit CODEX_SQLITE_HOME was created by the HUD wrapper" >&2
  exit 1
fi

# A conflicting metadata symlink is rejected before session creation.
SYMLINK_HOME="$TEST_ROOT/symlink-home"
SYMLINK_MANAGED="$SYMLINK_HOME/.stepcode/codex"
mkdir -p "$SYMLINK_MANAGED"
touch "$SYMLINK_MANAGED/state_5.sqlite" "$SYMLINK_MANAGED/goals_1.sqlite" "$SYMLINK_MANAGED/memories_1.sqlite"
cat > "$FAKE_BIN_DIR/mkdir" <<'FAKE_MKDIR'
#!/usr/bin/env bash
set -euo pipefail
/usr/bin/mkdir "$@"
target="${@: -1}"
if [[ "${SQLITE_CONFLICT_MODE:-}" == "symlink" && "$target" == */.codex-hud-sqlite/* ]]; then
  /usr/bin/ln -s /unexpected/sqlite-target "$target/state_5.sqlite"
elif [[ "${SQLITE_CONFLICT_MODE:-}" == "file" && "$target" == */.codex-hud-sqlite/* ]]; then
  /usr/bin/touch "$target/state_5.sqlite"
fi
FAKE_MKDIR
chmod +x "$FAKE_BIN_DIR/mkdir"
SYMLINK_LOG="$TEST_ROOT/symlink.tmux.log"
SYMLINK_OUTPUT="$TEST_ROOT/symlink.output.log"
symlink_status="$(run_wrapper_allow_failure "$SYMLINK_LOG" "$SYMLINK_OUTPUT" \
  "HOME=$SYMLINK_HOME" "CODEX_HOME=$SYMLINK_MANAGED" "SQLITE_CONFLICT_MODE=symlink")"
if [[ "$symlink_status" -eq 0 ]]; then
  echo "conflicting SQLite symlink was accepted" >&2
  exit 1
fi
assert_contains "$SYMLINK_OUTPUT" "Conflicting Codex SQLite link:" "conflicting symlink"
assert_no_tmux "$SYMLINK_LOG"

# A conflicting regular metadata file is rejected before session creation.
FILE_HOME="$TEST_ROOT/file-home"
FILE_MANAGED="$FILE_HOME/.stepcode/codex"
mkdir -p "$FILE_MANAGED"
touch "$FILE_MANAGED/state_5.sqlite" "$FILE_MANAGED/goals_1.sqlite" "$FILE_MANAGED/memories_1.sqlite"
FILE_LOG="$TEST_ROOT/file.tmux.log"
FILE_OUTPUT="$TEST_ROOT/file.output.log"
file_status="$(run_wrapper_allow_failure "$FILE_LOG" "$FILE_OUTPUT" \
  "HOME=$FILE_HOME" "CODEX_HOME=$FILE_MANAGED" "SQLITE_CONFLICT_MODE=file")"
if [[ "$file_status" -eq 0 ]]; then
  echo "conflicting SQLite regular file was accepted" >&2
  exit 1
fi
assert_contains "$FILE_OUTPUT" "Refusing to replace an existing Codex SQLite file:" "conflicting regular file"
assert_no_tmux "$FILE_LOG"

# A failed metadata link operation remains visible and stops the launch.
LINK_HOME="$TEST_ROOT/link-home"
LINK_MANAGED="$LINK_HOME/.stepcode/codex"
mkdir -p "$LINK_MANAGED"
touch "$LINK_MANAGED/state_5.sqlite" "$LINK_MANAGED/goals_1.sqlite" "$LINK_MANAGED/memories_1.sqlite"
cat > "$FAKE_BIN_DIR/ln" <<'FAKE_LN'
#!/usr/bin/env bash
if [[ "${SQLITE_LINK_FAIL:-0}" == "1" && "${1:-}" == "-s" ]]; then
  printf 'simulated SQLite link failure\n' >&2
  exit 42
fi
exec /usr/bin/ln "$@"
FAKE_LN
chmod +x "$FAKE_BIN_DIR/ln"
LINK_LOG="$TEST_ROOT/link.tmux.log"
LINK_OUTPUT="$TEST_ROOT/link.output.log"
link_status="$(run_wrapper_allow_failure "$LINK_LOG" "$LINK_OUTPUT" \
  "HOME=$LINK_HOME" "CODEX_HOME=$LINK_MANAGED" "SQLITE_LINK_FAIL=1")"
if [[ "$link_status" -eq 0 ]]; then
  echo "failed SQLite link operation was accepted" >&2
  exit 1
fi
assert_contains "$LINK_OUTPUT" "Unable to link the existing Codex SQLite database:" "link failure"
assert_no_tmux "$LINK_LOG"

# A path collision at the launch-local directory boundary fails fast too.
DIR_HOME="$TEST_ROOT/dir-home"
DIR_MANAGED="$DIR_HOME/.stepcode/codex"
mkdir -p "$DIR_MANAGED"
touch "$DIR_MANAGED/state_5.sqlite" "$DIR_MANAGED/goals_1.sqlite" "$DIR_MANAGED/memories_1.sqlite"
printf 'occupied\n' > "$DIR_MANAGED/.codex-hud-sqlite"
DIR_LOG="$TEST_ROOT/dir.tmux.log"
DIR_OUTPUT="$TEST_ROOT/dir.output.log"
dir_status="$(run_wrapper_allow_failure "$DIR_LOG" "$DIR_OUTPUT" \
  "HOME=$DIR_HOME" "CODEX_HOME=$DIR_MANAGED")"
if [[ "$dir_status" -eq 0 ]]; then
  echo "SQLite directory collision was accepted" >&2
  exit 1
fi
assert_contains "$DIR_OUTPUT" "Unable to create the Codex SQLite home:" "directory collision"
assert_no_tmux "$DIR_LOG"

echo "test-wrapper-sqlite-fail-fast: PASS (explicit_owner=1, conflicting_symlink=1, conflicting_file=1, link_failure=1, directory_failure=1)"
