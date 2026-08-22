#!/usr/bin/env bash
set -euo pipefail

# Exercise Ctrl+C through a real isolated tmux server and PTY. An interrupted
# StepCode child must return control to the original terminal without waiting
# for an acknowledgement intended for ordinary failures.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER_PATH="${CODEX_HUD_WRAPPER:-$ROOT_DIR/bin/codex-hud}"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-stepcode-interrupt-XXXXXX)"
FAKE_BIN="$TEST_ROOT/bin"
TMUX_TMPDIR="$TEST_ROOT/tmux"
INPUT_FIFO="$TEST_ROOT/input.fifo"
DECOY_INPUT_FIFO="$TEST_ROOT/decoy-input.fifo"
PTY_LOG="$TEST_ROOT/pty.log"
DECOY_PTY_LOG="$TEST_ROOT/decoy-pty.log"
TRACE_FILE="$TEST_ROOT/stepcode.trace"
LAUNCHER="$TEST_ROOT/launch-wrapper.sh"
SENTINEL_SESSION="stepcode-interrupt-sentinel-$$"
DECOY_SESSION=""
SESSION_NAME=""
WRAPPER_PID=""
DECOY_PID=""

mkdir -p "$FAKE_BIN" "$TMUX_TMPDIR" "$TEST_ROOT/home"
mkfifo "$INPUT_FIFO" "$DECOY_INPUT_FIFO"

tmux_cmd() {
  TMUX= TMUX_TMPDIR="$TMUX_TMPDIR" tmux -f /dev/null "$@"
}

cleanup() {
  if [[ -n "$WRAPPER_PID" ]] && kill -0 "$WRAPPER_PID" 2>/dev/null; then
    kill "$WRAPPER_PID" 2>/dev/null || true
  fi
  if [[ -n "$DECOY_PID" ]] && kill -0 "$DECOY_PID" 2>/dev/null; then
    kill "$DECOY_PID" 2>/dev/null || true
  fi
  tmux_cmd kill-server >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "test-wrapper-stepcode-interrupt-exit: FAIL - $1" >&2
  echo "test_root=$TEST_ROOT" >&2
  echo "session=$SESSION_NAME" >&2
  echo "decoy_session=$DECOY_SESSION" >&2
  echo "--- PTY output ---" >&2
  cat "$PTY_LOG" >&2 2>/dev/null || true
  echo "--- Decoy PTY output ---" >&2
  cat "$DECOY_PTY_LOG" >&2 2>/dev/null || true
  echo "--- StepCode trace ---" >&2
  cat "$TRACE_FILE" >&2 2>/dev/null || true
  if [[ -n "$SESSION_NAME" ]]; then
    tmux_cmd capture-pane -p -t "$SESSION_NAME" >&2 2>/dev/null || true
  fi
  exit 1
}

cat > "$FAKE_BIN/stepcode" <<'FAKE_STEPCODE'
#!/usr/bin/env bash
set -u
printf 'stepcode_start pid=%s\n' "$$" >> "${TRACE:?}"
trap 'printf "stepcode_sigint pid=%s\n" "$$" >> "${TRACE:?}"; kill -INT "$PPID" 2>/dev/null || true; exit 130' INT
while :; do
  sleep 1
done
FAKE_STEPCODE

cat > "$FAKE_BIN/node" <<'FAKE_NODE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "v20.11.0"
  exit 0
fi
while :; do
  sleep 1
done
FAKE_NODE

cat > "$FAKE_BIN/tput" <<'FAKE_TPUT'
#!/usr/bin/env bash
case "${1:-}" in
  lines) echo 24 ;;
  cols) echo 100 ;;
  *) echo 0 ;;
esac
FAKE_TPUT

chmod +x "$FAKE_BIN/stepcode" "$FAKE_BIN/node" "$FAKE_BIN/tput"
: > "$PTY_LOG"
: > "$DECOY_PTY_LOG"
: > "$TRACE_FILE"

# Seed the isolated tmux server with the fake command environment before any
# pane is created. This keeps the test control plane separate from live tmux.
export PATH="$FAKE_BIN:$PATH"
export TRACE="$TRACE_FILE"
tmux_cmd new-session -d -s "$SENTINEL_SESSION" "sleep 60"
tmux_cmd set-environment -g TRACE "$TRACE_FILE"
tmux_cmd set-environment -g CODEX_HUD_UPDATE_CHECK 0
tmux_cmd set-environment -g CODEX_HUD_HEIGHT 5

cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH=$(printf '%q' "$FAKE_BIN"):\$PATH
export TMUX=
export TMUX_TMPDIR=$(printf '%q' "$TMUX_TMPDIR")
export HOME=$(printf '%q' "$TEST_ROOT/home")
export TRACE=$(printf '%q' "$TRACE_FILE")
export CODEX_HUD_UPDATE_CHECK=0
export CODEX_HUD_HEIGHT=5
export TERM=xterm-256color
cd $(printf '%q' "$TEST_ROOT")
exec bash $(printf '%q' "$WRAPPER_PATH") --stepcode --new-session
EOF
chmod +x "$LAUNCHER"

exec 3<>"$INPUT_FIFO"
exec 4<>"$DECOY_INPUT_FIFO"
script -qefc "bash $(printf '%q' "$LAUNCHER")" "$PTY_LOG" <&3 &
WRAPPER_PID=$!

for _ in $(seq 1 240); do
  SESSION_NAME="$(
    tmux_cmd list-sessions -F '#{session_name}' 2>/dev/null |
      grep '^codex-hud-stepcode-' |
      head -n1 || true
  )"
  [[ -n "$SESSION_NAME" ]] && break
  sleep 0.05
done
[[ -n "$SESSION_NAME" ]] || fail "wrapper did not create a StepCode HUD session"

for _ in $(seq 1 240); do
  grep -Fq "stepcode_start" "$TRACE_FILE" 2>/dev/null && break
  sleep 0.05
done
grep -Fq "stepcode_start" "$TRACE_FILE" ||
  fail "StepCode child did not reach its interruptible running state"

MAIN_PANE_ID="$(tmux_cmd show-option -t "$SESSION_NAME" -qv @codex_hud_main_pane 2>/dev/null || true)"
[[ -n "$MAIN_PANE_ID" ]] || fail "StepCode main pane identity was not recorded"
tmux_cmd list-clients -F '#{session_name}' 2>/dev/null |
  grep -Fqx "$SESSION_NAME" ||
  fail "wrapper did not keep a client attached before Ctrl+C"

# Attach another client to the same HUD session. Session-scoped teardown must
# return every client for this HUD session while leaving the sentinel intact.
DECOY_SESSION="$SESSION_NAME"
script -qefc \
  "env TERM=xterm-256color TMUX= TMUX_TMPDIR=$(printf '%q' "$TMUX_TMPDIR") tmux -f /dev/null attach-session -t $(printf '%q' "$DECOY_SESSION")" \
  "$DECOY_PTY_LOG" <&4 &
DECOY_PID=$!
for _ in $(seq 1 240); do
  if [[ "$(tmux_cmd list-clients -F '#{session_name}' 2>/dev/null |
    grep -Fc "$DECOY_SESSION" || true)" -ge 2 ]]; then
    break
  fi
  sleep 0.05
done
[[ "$(tmux_cmd list-clients -F '#{session_name}' 2>/dev/null |
  grep -Fc "$DECOY_SESSION" || true)" -ge 2 ]] ||
  fail "decoy tmux client did not attach before Ctrl+C"

# Send Ctrl+C through the attached terminal's input path. This models the
# user's terminal keypress, rather than bypassing the client with tmux
# send-keys directly to the main pane.
printf '\003' >&3

for _ in $(seq 1 240); do
  if ! kill -0 "$WRAPPER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.05
done
kill -0 "$WRAPPER_PID" 2>/dev/null &&
  fail "wrapper remained attached after Ctrl+C instead of returning to the terminal"

set +e
wait "$WRAPPER_PID"
WRAPPER_STATUS=$?
set -e
WRAPPER_PID=""

[[ "$WRAPPER_STATUS" -eq 130 ]] ||
  fail "wrapper returned status $WRAPPER_STATUS instead of interrupt status 130"
grep -Fq "stepcode_sigint" "$TRACE_FILE" ||
  fail "StepCode child did not receive SIGINT"
if grep -Fq "Press Enter to close" "$PTY_LOG"; then
  fail "interrupt path still displayed the ordinary failure acknowledgement prompt"
fi
if tmux_cmd has-session -t "$SESSION_NAME" >/dev/null 2>&1; then
  fail "interrupt path left its StepCode HUD session alive"
fi
tmux_cmd has-session -t "$SENTINEL_SESSION" ||
  fail "interrupt path affected the sentinel session"
if tmux_cmd list-clients -F '#{session_name}' 2>/dev/null |
  grep -Fqx "$SESSION_NAME"; then
  fail "the attached StepCode client remained after Ctrl+C"
fi

printf 'interrupt: PASS (status=%s, prompt_skipped=1, session_cleaned=1, sentinel_alive=1)\n' \
  "$WRAPPER_STATUS"
