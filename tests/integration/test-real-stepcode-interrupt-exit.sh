#!/usr/bin/env bash
set -euo pipefail

# Exercise Ctrl+C through the installed StepCode process, its script wrapper,
# and a fake Codex child inside an isolated tmux server and PTY.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER_PATH="${CODEX_HUD_WRAPPER:-$ROOT_DIR/bin/codex-hud}"
STEPCODE_BIN="${STEPCODE_BIN:-/home/i-fengyicheng/.local/bin/stepcode}"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-real-stepcode-interrupt-XXXXXX)"
FAKE_BIN="$TEST_ROOT/bin"
HOME_DIR="$TEST_ROOT/home"
TMUX_TMPDIR="$TEST_ROOT/tmux"
INPUT_FIFO="$TEST_ROOT/input.fifo"
PTY_LOG="$TEST_ROOT/pty.log"
TRACE_FILE="$TEST_ROOT/process.trace"
LAUNCHER="$TEST_ROOT/launch-wrapper.sh"
SENTINEL_SESSION="real-stepcode-interrupt-sentinel-$$"
SESSION_NAME=""
WRAPPER_PID=""

mkdir -p "$FAKE_BIN" "$HOME_DIR/.stepcode" "$HOME_DIR/.codex" "$TMUX_TMPDIR"
mkfifo "$INPUT_FIFO"

tmux_cmd() {
  TMUX= TMUX_TMPDIR="$TMUX_TMPDIR" tmux -f /dev/null "$@"
}

cleanup() {
  if [[ -n "$WRAPPER_PID" ]] && kill -0 "$WRAPPER_PID" 2>/dev/null; then
    kill "$WRAPPER_PID" 2>/dev/null || true
  fi
  tmux_cmd kill-server >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "test-real-stepcode-interrupt-exit: FAIL - $1" >&2
  echo "test_root=$TEST_ROOT" >&2
  echo "session=$SESSION_NAME" >&2
  echo "--- PTY output ---" >&2
  sed -n '1,260p' "$PTY_LOG" >&2 2>/dev/null || true
  echo "--- process trace ---" >&2
  sed -n '1,260p' "$TRACE_FILE" >&2 2>/dev/null || true
  if [[ -n "$SESSION_NAME" ]]; then
    echo "--- tmux process tree ---" >&2
    tmux_cmd list-panes -a -F '#{session_name} #{pane_id} #{pane_pid} #{pane_current_command}' >&2 2>/dev/null || true
    echo "--- tmux pane capture ---" >&2
    tmux_cmd capture-pane -p -t "$SESSION_NAME" >&2 2>/dev/null || true
  fi
  exit 1
}

[[ -x "$STEPCODE_BIN" ]] || fail "real StepCode executable is unavailable: $STEPCODE_BIN"

cat > "$FAKE_BIN/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
set -u

trace="${STEPCODE_TRACE:?}"

if [[ "${1:-}" == "--version" ]]; then
  printf 'codex_version_probe pid=%s ppid=%s pgid=%s sid=%s tty=%s args=' \
    "$$" "$PPID" "$(ps -o pgid= -p "$$" | tr -d ' ')" \
    "$(ps -o sid= -p "$$" | tr -d ' ')" "$(tty 2>/dev/null || true)" >>"$trace"
  printf '<%s> ' "$@" >>"$trace"
  printf '\n' >>"$trace"
  printf 'codex-cli 0.144.4\n'
  exit 0
fi

printf 'codex_start pid=%s ppid=%s pgid=%s sid=%s tty=%s args=' \
  "$$" "$PPID" "$(ps -o pgid= -p "$$" | tr -d ' ')" \
  "$(ps -o sid= -p "$$" | tr -d ' ')" "$(tty 2>/dev/null || true)" >>"$trace"
printf '<%s> ' "$@" >>"$trace"
printf '\n' >>"$trace"

trap 'printf "codex_sigint pid=%s ppid=%s pgid=%s sid=%s\n" "$$" "$PPID" "$(ps -o pgid= -p "$$" | tr -d " ")" "$(ps -o sid= -p "$$" | tr -d " ")" >>"$trace"; exit 130' INT
trap 'printf "codex_sigterm pid=%s\n" "$$" >>"$trace"; exit 143' TERM
printf 'fake-codex-running pid=%s\n' "$$"
printf 'codex_running pid=%s ppid=%s pgid=%s sid=%s tty=%s\n' \
  "$$" "$PPID" "$(ps -o pgid= -p "$$" | tr -d ' ')" \
  "$(ps -o sid= -p "$$" | tr -d ' ')" "$(tty 2>/dev/null || true)" >>"$trace"
while :; do
  sleep 1
done
FAKE_CODEX

cat > "$FAKE_BIN/tput" <<'FAKE_TPUT'
#!/usr/bin/env bash
case "${1:-}" in
  lines) echo 24 ;;
  cols) echo 100 ;;
  *) echo 0 ;;
esac
FAKE_TPUT

chmod +x "$FAKE_BIN/codex" "$FAKE_BIN/tput"

cat > "$HOME_DIR/.stepcode/config.json" <<'STEPCODE_CONFIG'
{
  "apiKey": "task-owned-test-key",
  "baseUrl": "http://127.0.0.1:9",
  "updateCheckEnabled": false,
  "telemetryEnabled": false,
  "logUploadStrategy": "off",
  "agentModels": {
    "codex": {
      "model": "task-owned-test-model",
      "modelSupportApis": [
        {
          "id": "responses"
        }
      ]
    }
  }
}
STEPCODE_CONFIG

: >"$PTY_LOG"
: >"$TRACE_FILE"

export PATH="$FAKE_BIN:$PATH"
export STEPCODE_TRACE="$TRACE_FILE"
tmux_cmd new-session -d -s "$SENTINEL_SESSION" "sleep 60"
tmux_cmd set-environment -g HOME "$HOME_DIR"
tmux_cmd set-environment -g PATH "$PATH"
tmux_cmd set-environment -g STEPCODE_NO_PROMPT 1
tmux_cmd set-environment -g STEPCODE_TRACE "$TRACE_FILE"

cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH=$(printf '%q' "$FAKE_BIN"):\$PATH
export TMUX=
export TMUX_TMPDIR=$(printf '%q' "$TMUX_TMPDIR")
export HOME=$(printf '%q' "$HOME_DIR")
export STEPCODE_TRACE=$(printf '%q' "$TRACE_FILE")
export CODEX_HUD_UPDATE_CHECK=0
export CODEX_HUD_HEIGHT=5
export CODEX_HUD_HEIGHT_AUTO=0
export STEPCODE_NO_PROMPT=1
export TERM=xterm-256color
cd $(printf '%q' "$TEST_ROOT")
exec bash $(printf '%q' "$WRAPPER_PATH") --stepcode --new-session \
  --sandbox danger-full-access \
  --ask-for-approval never \
  -c model_reasoning_effort=high \
  -- real-stepcode-interrupt
EOF
chmod +x "$LAUNCHER"

exec 3<>"$INPUT_FIFO"
script -qefc "bash $(printf '%q' "$LAUNCHER")" "$PTY_LOG" <&3 >/dev/null 2>&1 &
WRAPPER_PID=$!

for _ in $(seq 1 400); do
  SESSION_NAME="$(
    tmux_cmd list-sessions -F '#{session_name}' 2>/dev/null |
      grep '^codex-hud-stepcode-' |
      head -n1 || true
  )"
  [[ -n "$SESSION_NAME" ]] && break
  sleep 0.05
done
[[ -n "$SESSION_NAME" ]] || fail "wrapper did not create a StepCode HUD session"

for _ in $(seq 1 400); do
  grep -Fq "codex_running" "$TRACE_FILE" 2>/dev/null && break
  sleep 0.05
done
grep -Fq "codex_running" "$TRACE_FILE" ||
  fail "real StepCode did not enter the fake Codex running state"
CODEX_PID="$(
  sed -n 's/^codex_running pid=\([0-9][0-9]*\).*/\1/p' "$TRACE_FILE" |
    tail -n1
)"
[[ -n "$CODEX_PID" ]] || fail "fake Codex running PID was not recorded"

MAIN_PANE_ID="$(tmux_cmd show-option -t "$SESSION_NAME" -qv @codex_hud_main_pane 2>/dev/null || true)"
[[ -n "$MAIN_PANE_ID" ]] || fail "StepCode main pane identity was not recorded"
tmux_cmd list-clients -F '#{session_name}' 2>/dev/null |
  grep -Fqx "$SESSION_NAME" ||
  fail "wrapper did not keep a client attached before Ctrl+C"

printf '\003' >&3

for _ in $(seq 1 400); do
  if ! kill -0 "$WRAPPER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.05
done
kill -0 "$WRAPPER_PID" 2>/dev/null &&
  fail "wrapper remained attached after Ctrl+C through real StepCode"

set +e
wait "$WRAPPER_PID"
WRAPPER_STATUS=$?
set -e
WRAPPER_PID=""

[[ "$WRAPPER_STATUS" -eq 130 ]] ||
  fail "wrapper returned status $WRAPPER_STATUS instead of interrupt status 130"
if kill -0 "$CODEX_PID" 2>/dev/null; then
  fail "fake Codex process $CODEX_PID remained alive after Ctrl+C"
fi
if grep -Fq "Press Enter to close" "$PTY_LOG"; then
  fail "real StepCode interrupt path displayed the ordinary failure acknowledgement"
fi
if tmux_cmd has-session -t "$SESSION_NAME" >/dev/null 2>&1; then
  fail "real StepCode interrupt path left its HUD session alive"
fi
tmux_cmd has-session -t "$SENTINEL_SESSION" ||
  fail "real StepCode interrupt path affected the sentinel session"

printf 'test-real-stepcode-interrupt-exit: PASS (status=%s, codex_process_gone=1, session_cleaned=1, sentinel_alive=1)\n' \
  "$WRAPPER_STATUS"
