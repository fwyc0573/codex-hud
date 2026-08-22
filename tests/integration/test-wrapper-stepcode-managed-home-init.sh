#!/usr/bin/env bash
set -euo pipefail

# Verify that StepCode's managed CODEX_HOME exists before the first tmux pane
# is created, so the HUD renderer can resolve it during initial startup.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-stepcode-home-init-XXXXXX)"
FAKE_BIN="$TEST_ROOT/bin"
HOME_DIR="$TEST_ROOT/home"
MANAGED_HOME="$HOME_DIR/.stepcode/codex"
MANAGED_SESSIONS="$HOME_DIR/.codex/sessions"
TMUX_LOG="$TEST_ROOT/tmux.log"
OUTPUT_LOG="$TEST_ROOT/wrapper.log"

mkdir -p "$FAKE_BIN" "$HOME_DIR"

cat > "$FAKE_BIN/stepcode" <<'FAKE_STEPCODE'
#!/usr/bin/env bash
exit 0
FAKE_STEPCODE

cat > "$FAKE_BIN/node" <<'FAKE_NODE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "v20.11.0"
fi
exit 0
FAKE_NODE

cat > "$FAKE_BIN/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
exit 0
FAKE_NPM

cat > "$FAKE_BIN/tput" <<'FAKE_TPUT'
#!/usr/bin/env bash
case "${1:-}" in
  lines) echo 24 ;;
  cols) echo 80 ;;
  *) echo 0 ;;
esac
FAKE_TPUT

cat > "$FAKE_BIN/tmux" <<'FAKE_TMUX'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "new-session" || "${1:-}" == "split-window" ]]; then
  if [[ ! -d "${EXPECTED_MANAGED_HOME:?}" ]]; then
    echo "managed CODEX_HOME was absent before tmux command: $1" >&2
    exit 71
  fi
  if [[ ! -d "${EXPECTED_MANAGED_SESSIONS:?}" ]]; then
    echo "stable CODEX_SESSIONS_PATH was absent before tmux command: $1" >&2
    exit 71
  fi
fi

printf '%s\n' "$*" >> "${TMUX_LOG_FILE:?}"

case "${1:-}" in
  list-panes)
    printf '%s\n' '%1' '%2'
    ;;
  show-option)
    case "${@: -1}" in
      @codex_hud_main_pane) printf '%s\n' '%1' ;;
      @codex_hud_pane) printf '%s\n' '%2' ;;
      *) printf '\n' ;;
    esac
    ;;
  split-window)
    printf '%s\n' '%2'
    ;;
  *)
    :
    ;;
esac
FAKE_TMUX

chmod +x "$FAKE_BIN"/*

set +e
env \
  HOME="$HOME_DIR" \
  PATH="$FAKE_BIN:/usr/bin:/bin" \
  TMUX_LOG_FILE="$TMUX_LOG" \
  EXPECTED_MANAGED_HOME="$MANAGED_HOME" \
  EXPECTED_MANAGED_SESSIONS="$MANAGED_SESSIONS" \
  CODEX_HUD_UPDATE_CHECK=0 \
  CODEX_HUD_HEIGHT=5 \
  CODEX_HUD_HEIGHT_AUTO=0 \
  "$ROOT_DIR/bin/codex-hud" --stepcode --new-session >"$OUTPUT_LOG" 2>&1
status=$?
set -e

if [[ "$status" -ne 0 ]]; then
  echo "test-wrapper-stepcode-managed-home-init: FAIL - wrapper status=$status" >&2
  cat "$OUTPUT_LOG" >&2
  exit 1
fi

if [[ ! -d "$MANAGED_HOME" ]]; then
  echo "test-wrapper-stepcode-managed-home-init: FAIL - managed home was not created" >&2
  exit 1
fi

if [[ ! -d "$MANAGED_SESSIONS" ]]; then
  echo "test-wrapper-stepcode-managed-home-init: FAIL - managed sessions directory was not created" >&2
  exit 1
fi

echo "test-wrapper-stepcode-managed-home-init: PASS (managed_home_created=1, stable_codex_sessions_path_created=1, status=$status)"
