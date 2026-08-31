#!/usr/bin/env bash
set -euo pipefail

# Verify profile precedence and the legacy environment contract at the wrapper
# boundary. This test uses a logger tmux so no real session is created.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-launch-contract-XXXXXX)"
BIN_DIR="$TEST_ROOT/bin"
HOME_DIR="$TEST_ROOT/home"
LOG_FILE="$TEST_ROOT/tmux.log"
OUTPUT_FILE="$TEST_ROOT/output.log"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$BIN_DIR" "$HOME_DIR"

cat > "$BIN_DIR/stepcode" <<'FAKE_STEPCODE'
#!/usr/bin/env bash
exit 0
FAKE_STEPCODE

cat > "$BIN_DIR/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
exit 0
FAKE_CODEX

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
  "TMUX_LOG_FILE=$LOG_FILE"
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

# An explicit profile flag must ignore stale legacy variables, including an
# invalid shell path, and resolve the StepCode executable from PATH.
set +e
env -i "${common_env[@]}" \
  CODEX_HUD_CLI_PATH="$TEST_ROOT/missing-cli" \
  CODEX_HUD_SESSION_PREFIX='invalid prefix' \
  CODEX_HUD_SHELL_PATH="$TEST_ROOT/missing-shell" \
  "$ROOT_DIR/bin/codex-hud" --stepcode --new-session >"$OUTPUT_FILE" 2>&1
status=$?
set -e
if [[ "$status" -ne 0 ]]; then
  echo "test-wrapper-launch-contract: explicit --stepcode was affected by stale legacy env (status=$status)" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

launch_line="$(grep -m1 '^respawn-pane ' "$LOG_FILE" || true)"
if [[ "$launch_line" != *"'$BIN_DIR/stepcode' 'codex'"* ]]; then
  echo "test-wrapper-launch-contract: explicit StepCode executable vector was not selected" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi
if [[ "$launch_line" == *"missing-cli"* || "$launch_line" == *"invalid prefix"* || "$launch_line" == *"missing-shell"* ]]; then
  echo "test-wrapper-launch-contract: stale legacy values leaked into explicit launch" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

echo "test-wrapper-launch-contract: PASS (explicit_precedence=1, native_shell_override=covered_by_existing_contract)"
