#!/usr/bin/env bash
set -euo pipefail

# Reproduces the user-visible startup failure with a real tmux server and PTY.
# A failed Codex process must leave its diagnostic visible until the attached
# user acknowledges it, then return the original Codex status to the wrapper.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER_PATH="${CODEX_HUD_WRAPPER:-$ROOT_DIR/bin/codex-hud}"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-failed-codex-XXXXXX)"
FAKE_BIN="$TEST_ROOT/bin"
TMUX_TMPDIR="$TEST_ROOT/tmux"
INPUT_FIFO="$TEST_ROOT/input.fifo"
PTY_LOG="$TEST_ROOT/pty.log"
LAUNCHER="$TEST_ROOT/launch-wrapper.sh"
FAILURE_MARKER="codex-hud-fake-failure-$$"
SESSION_NAME=""
WRAPPER_PID=""

mkdir -p "$FAKE_BIN" "$TMUX_TMPDIR"
mkfifo "$INPUT_FIFO"

cleanup() {
  if [[ -n "$WRAPPER_PID" ]] && kill -0 "$WRAPPER_PID" 2>/dev/null; then
    kill "$WRAPPER_PID" 2>/dev/null || true
  fi
  TMUX= TMUX_TMPDIR="$TMUX_TMPDIR" tmux -f /dev/null kill-server >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "test-wrapper-failed-codex-visible: FAIL - $1" >&2
  echo "--- session ---" >&2
  echo "$SESSION_NAME" >&2
  echo "--- captured PTY ---" >&2
  cat "$PTY_LOG" >&2 2>/dev/null || true
  if [[ -n "$SESSION_NAME" ]]; then
    TMUX= TMUX_TMPDIR="$TMUX_TMPDIR" tmux -f /dev/null capture-pane -p -t "$SESSION_NAME" >&2 2>/dev/null || true
  fi
  exit 1
}

tmux_cmd() {
  TMUX= TMUX_TMPDIR="$TMUX_TMPDIR" tmux -f /dev/null "$@"
}

find_codex_hud_session() {
  local candidate
  while IFS= read -r candidate; do
    if [[ "$candidate" == codex-hud-* ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(tmux_cmd list-sessions -F '#{session_name}' 2>/dev/null || true)
  return 1
}

session_is_alive() {
  [[ -n "$SESSION_NAME" ]] &&
    tmux_cmd has-session -t "$SESSION_NAME" >/dev/null 2>&1
}

capture_main_pane() {
  local pane_id
  pane_id="$(tmux_cmd show-option -t "$SESSION_NAME" -qv @codex_hud_main_pane 2>/dev/null || true)"
  [[ -n "$pane_id" ]] || return 1
  tmux_cmd capture-pane -p -t "$pane_id" 2>/dev/null
}

cat > "$FAKE_BIN/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
printf '[fake-codex] failure marker: %s\n' "${CODEX_FAILURE_MARKER:?}" >&2
exit 42
FAKE_CODEX

cat > "$FAKE_BIN/node" <<'FAKE_NODE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "v20.11.0"
  exit 0
fi
sleep 60
FAKE_NODE

cat > "$FAKE_BIN/tput" <<'FAKE_TPUT'
#!/usr/bin/env bash
case "${1:-}" in
  lines) echo 24 ;;
  cols) echo 80 ;;
  *) echo 0 ;;
esac
FAKE_TPUT

chmod +x "$FAKE_BIN/codex" "$FAKE_BIN/node" "$FAKE_BIN/tput"

cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH=$(printf '%q' "$FAKE_BIN"):\$PATH
export TMUX=
export TMUX_TMPDIR=$(printf '%q' "$TMUX_TMPDIR")
export CODEX_FAILURE_MARKER=$(printf '%q' "$FAILURE_MARKER")
export CODEX_HUD_UPDATE_CHECK=0
export CODEX_HUD_HEIGHT=5
export TERM=xterm-256color
cd $(printf '%q' "$TEST_ROOT")
exec bash $(printf '%q' "$WRAPPER_PATH") --new-session
EOF
chmod +x "$LAUNCHER"

exec 3<>"$INPUT_FIFO"
# `attach-session` requires a terminal. `script` supplies a real PTY while its
# input remains controllable through the fixture FIFO.
script -qefc "bash $(printf '%q' "$LAUNCHER")" "$PTY_LOG" <&3 &
WRAPPER_PID=$!

for _ in $(seq 1 200); do
  if SESSION_NAME="$(find_codex_hud_session || true)" && [[ -n "$SESSION_NAME" ]]; then
    break
  fi
  sleep 0.05
done
[[ -n "$SESSION_NAME" ]] || fail "wrapper did not create a codex-hud session"

first_capture=""
for _ in $(seq 1 200); do
  if session_is_alive; then
    first_capture="$(capture_main_pane || true)"
    if [[ "$first_capture" == *"$FAILURE_MARKER"* ]] &&
      [[ "$first_capture" == *"42"* ]]; then
      break
    fi
  fi
  sleep 0.05
done

[[ "$first_capture" == *"$FAILURE_MARKER"* ]] ||
  fail "Codex failure output was not visible in the main pane"
[[ "$first_capture" == *"42"* ]] ||
  fail "Codex exit status 42 was not visible in the main pane"
session_is_alive || fail "the failed session disappeared before acknowledgement"
kill -0 "$WRAPPER_PID" 2>/dev/null ||
  fail "the wrapper exited before the failure acknowledgement"

# A second observation closes the race window that the original unconditional
# kill-session created immediately after the Codex process exited.
sleep 0.5
session_is_alive || fail "the failed session did not remain alive for observation"
second_capture="$(capture_main_pane || true)"
[[ "$second_capture" == *"$FAILURE_MARKER"* ]] ||
  fail "the original Codex error was erased before acknowledgement"

printf '\n' >&3

for _ in $(seq 1 200); do
  if ! kill -0 "$WRAPPER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.05
done

set +e
wait "$WRAPPER_PID"
wrapper_status=$?
set -e
[[ "$wrapper_status" -eq 42 ]] ||
  fail "wrapper returned $wrapper_status instead of the original Codex status 42"

echo "test-wrapper-failed-codex-visible: PASS"
