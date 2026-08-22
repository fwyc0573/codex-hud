#!/usr/bin/env bash
set -euo pipefail

# Exercise StepCode mode through a real isolated tmux server and PTY. The
# success path must close its own session, while the failure path must retain
# the diagnostic until acknowledgement and return the original status.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER_PATH="${CODEX_HUD_WRAPPER:-$ROOT_DIR/bin/codex-hud}"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-stepcode-lifecycle-XXXXXX)"
FAKE_BIN="$TEST_ROOT/bin"
TMUX_TMPDIR="$TEST_ROOT/tmux"
SENTINEL_SESSION="stepcode-lifecycle-sentinel-$$"
mkdir -p "$FAKE_BIN" "$TMUX_TMPDIR"

WRAPPER_PID=""
CURRENT_SESSION=""

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
  echo "test-wrapper-stepcode-lifecycle: FAIL - $1" >&2
  echo "test_root=$TEST_ROOT" >&2
  echo "session=$CURRENT_SESSION" >&2
  if [[ -n "$CURRENT_SESSION" ]]; then
    tmux_cmd capture-pane -p -t "$CURRENT_SESSION" >&2 2>/dev/null || true
  fi
  exit 1
}

cat > "$FAKE_BIN/stepcode" <<'FAKE_STEPCODE'
#!/usr/bin/env bash
set -euo pipefail
printf 'home=%s\n' "${CODEX_HOME:-}" >> "${STEPCODE_TRACE:?}"
printf 'sessions=%s\n' "${CODEX_SESSIONS_PATH:-}" >> "${STEPCODE_TRACE:?}"
printf 'cwd=%s\n' "$PWD" >> "${STEPCODE_TRACE:?}"
printf 'arg=<%s>\n' "$@" >> "${STEPCODE_TRACE:?}"
mkdir -p "${CODEX_HOME:?}/sessions" "${CODEX_SESSIONS_PATH:?}"
if [[ -d "${CODEX_HOME}/sessions" && ! -L "${CODEX_HOME}/sessions" ]]; then
  rmdir "${CODEX_HOME}/sessions"
  ln -s "${CODEX_SESSIONS_PATH}" "${CODEX_HOME}/sessions"
fi
if [[ -n "${STEPCODE_MARKER:-}" ]]; then
  printf '[fake-stepcode] marker: %s\n' "$STEPCODE_MARKER" >&2
fi
exit "${STEPCODE_EXIT:?}"
FAKE_STEPCODE

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
  cols) echo 100 ;;
  *) echo 0 ;;
esac
FAKE_TPUT

chmod +x "$FAKE_BIN/stepcode" "$FAKE_BIN/node" "$FAKE_BIN/tput"

tmux_cmd new-session -d -s "$SENTINEL_SESSION" "sleep 60"

find_stepcode_session() {
  tmux_cmd list-sessions -F '#{session_name}' 2>/dev/null |
    while IFS= read -r session_name; do
      if [[ "$session_name" == codex-hud-stepcode-* ]]; then
        printf '%s\n' "$session_name"
        break
      fi
    done
}

wait_for_stepcode_session() {
  local found=""
  for _ in $(seq 1 200); do
    found="$(find_stepcode_session || true)"
    if [[ -n "$found" ]]; then
      CURRENT_SESSION="$found"
      return 0
    fi
    sleep 0.05
  done
  return 1
}

session_is_alive() {
  [[ -n "$CURRENT_SESSION" ]] &&
    tmux_cmd has-session -t "$CURRENT_SESSION" >/dev/null 2>&1
}

capture_main_pane() {
  local pane_id
  pane_id="$(tmux_cmd show-option -t "$CURRENT_SESSION" -qv @codex_hud_main_pane 2>/dev/null || true)"
  [[ -n "$pane_id" ]] || return 1
  tmux_cmd capture-pane -p -t "$pane_id" 2>/dev/null
}

run_wrapper_in_pty() {
  local case_root="$1"
  local exit_code="$2"
  local trace_file="$3"
  local input_path="$4"
  local output_path="$5"
  local wrapper_launcher="$case_root/launch.sh"

  cat > "$wrapper_launcher" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH=$(printf '%q' "$FAKE_BIN"):\$PATH
export TMUX=
export TMUX_TMPDIR=$(printf '%q' "$TMUX_TMPDIR")
export HOME=$(printf '%q' "$case_root/home")
export CODEX_HUD_UPDATE_CHECK=0
export CODEX_HUD_HEIGHT=5
export CODEX_HUD_HEIGHT_AUTO=0
export TERM=xterm-256color
export STEPCODE_TRACE=$(printf '%q' "$trace_file")
export STEPCODE_EXIT=$(printf '%q' "$exit_code")
export STEPCODE_MARKER=$(printf '%q' "${STEPCODE_MARKER:-}")
cd $(printf '%q' "$case_root")
exec bash $(printf '%q' "$WRAPPER_PATH") --stepcode --new-session \
  --sandbox danger-full-access \
  --ask-for-approval never \
  -c model_reasoning_effort=high \
  -c model_auto_compact_token_limit=200000 \
  -- custom-prompt
EOF
  chmod +x "$wrapper_launcher"
  mkdir -p "$case_root/home"
  tmux_cmd set-environment -g STEPCODE_TRACE "$trace_file"
  tmux_cmd set-environment -g STEPCODE_EXIT "$exit_code"
  tmux_cmd set-environment -g STEPCODE_MARKER "${STEPCODE_MARKER:-}"

  script -qefc "bash $(printf '%q' "$wrapper_launcher")" "$output_path" <"$input_path" &
  WRAPPER_PID=$!
}

wait_for_process_exit() {
  for _ in $(seq 1 240); do
    if ! kill -0 "$WRAPPER_PID" 2>/dev/null; then
      return 0
    fi
    sleep 0.05
  done
  return 1
}

run_success_case() {
  local case_root="$TEST_ROOT/success"
  local trace_file="$case_root/stepcode.trace"
  local output_path="$case_root/pty.log"
  mkdir -p "$case_root"
  : > "$trace_file"
  : > "$output_path"
  : > "$case_root/input"
  CURRENT_SESSION=""
  unset STEPCODE_MARKER

  run_wrapper_in_pty "$case_root" 0 "$trace_file" "$case_root/input" "$output_path"
  wait_for_process_exit || fail "success wrapper did not exit"
  set +e
  wait "$WRAPPER_PID"
  local status=$?
  set -e
  WRAPPER_PID=""

  [[ "$status" -eq 0 ]] || fail "success wrapper returned status $status"
  grep -Fqx "home=$case_root/home/.stepcode/codex" "$trace_file" ||
    fail "success StepCode process did not receive the managed CODEX_HOME"
  grep -Fqx "sessions=$case_root/home/.codex/sessions" "$trace_file" ||
    fail "success StepCode process did not receive the stable CODEX_SESSIONS_PATH"
  grep -Fqx 'arg=<codex>' "$trace_file" ||
    fail "success StepCode process did not receive the codex subcommand"
  grep -Fqx 'arg=<custom-prompt>' "$trace_file" ||
    fail "success user argument was not forwarded"
  [[ -L "$case_root/home/.stepcode/codex/sessions" ]] ||
    fail "success StepCode session path was not replaced by a symlink"
  [[ "$(readlink -f "$case_root/home/.stepcode/codex/sessions")" == "$case_root/home/.codex/sessions" ]] ||
    fail "success StepCode session symlink resolved to the wrong stable path"
  session_is_alive && fail "success path left its StepCode HUD session alive"
  tmux_cmd has-session -t "$SENTINEL_SESSION" ||
    fail "success path affected the sentinel session"
  printf 'success: PASS (status=%s, session_cleaned=1, sentinel_alive=1)\n' "$status"
}

run_failure_case() {
  local case_root="$TEST_ROOT/failure"
  local trace_file="$case_root/stepcode.trace"
  local output_path="$case_root/pty.log"
  local input_fifo="$case_root/input.fifo"
  local marker="stepcode-failure-marker-$$"
  mkdir -p "$case_root"
  : > "$trace_file"
  : > "$output_path"
  mkfifo "$input_fifo"
  exec 3<>"$input_fifo"
  CURRENT_SESSION=""
  STEPCODE_MARKER="$marker"

  run_wrapper_in_pty "$case_root" 43 "$trace_file" "$input_fifo" "$output_path"
  wait_for_stepcode_session || fail "failure wrapper did not create a StepCode HUD session"

  local capture=""
  for _ in $(seq 1 240); do
    if session_is_alive; then
      capture="$(capture_main_pane || true)"
      if [[ "$capture" == *"$marker"* && "$capture" == *"43"* ]]; then
        break
      fi
    fi
    sleep 0.05
  done
  [[ "$capture" == *"$marker"* ]] ||
    fail "failure marker was not visible in the StepCode main pane"
  [[ "$capture" == *"43"* ]] ||
    fail "failure status was not visible in the StepCode main pane"
  session_is_alive || fail "failure session disappeared before acknowledgement"
  kill -0 "$WRAPPER_PID" 2>/dev/null ||
    fail "failure wrapper exited before acknowledgement"
  tmux_cmd has-session -t "$SENTINEL_SESSION" ||
    fail "failure path affected the sentinel session"

  printf '\n' >&3
  wait_for_process_exit || fail "failure wrapper did not exit after acknowledgement"
  set +e
  wait "$WRAPPER_PID"
  local status=$?
  set -e
  WRAPPER_PID=""
  exec 3>&-

  [[ "$status" -eq 43 ]] || fail "failure wrapper returned status $status instead of 43"
  session_is_alive && fail "failure path left its StepCode HUD session alive"
  tmux_cmd has-session -t "$SENTINEL_SESSION" ||
    fail "failure acknowledgement affected the sentinel session"
  grep -Fqx "home=$case_root/home/.stepcode/codex" "$trace_file" ||
    fail "failure StepCode process did not receive the managed CODEX_HOME"
  grep -Fqx "sessions=$case_root/home/.codex/sessions" "$trace_file" ||
    fail "failure StepCode process did not receive the stable CODEX_SESSIONS_PATH"
  grep -Fqx 'arg=<codex>' "$trace_file" ||
    fail "failure StepCode process did not receive the codex subcommand"
  [[ -L "$case_root/home/.stepcode/codex/sessions" ]] ||
    fail "failure StepCode session path was not replaced by a symlink"
  [[ "$(readlink -f "$case_root/home/.stepcode/codex/sessions")" == "$case_root/home/.codex/sessions" ]] ||
    fail "failure StepCode session symlink resolved to the wrong stable path"
  printf 'failure: PASS (status=%s, diagnostic_retained=1, session_cleaned=1, sentinel_alive=1)\n' "$status"
}

run_success_case
run_failure_case
echo "test-wrapper-stepcode-lifecycle: PASS"
