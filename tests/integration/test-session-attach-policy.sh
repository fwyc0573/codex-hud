#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
FAKE_BIN_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$FAKE_BIN_DIR"
}
trap cleanup EXIT

cat > "$FAKE_BIN_DIR/codex" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/node" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "v20.0.0"
  exit 0
fi
exit 0
FAKE

cat > "$FAKE_BIN_DIR/npm" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/tput" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == "lines" ]]; then
  echo "24"
  exit 0
fi
if [[ "${1:-}" == "cols" ]]; then
  echo "80"
  exit 0
fi
echo "0"
FAKE

chmod +x "$FAKE_BIN_DIR/codex" "$FAKE_BIN_DIR/node" "$FAKE_BIN_DIR/npm" "$FAKE_BIN_DIR/tput"

export PATH="$FAKE_BIN_DIR:$FAKE_TMUX_DIR:$PATH"
export CODEX_HUD_HEIGHT="5"
export CODEX_HUD_HEIGHT_AUTO="0"

hash_cwd() {
  local cwd="$1"
  if command -v md5sum >/dev/null 2>&1; then
    printf "%s" "$cwd" | md5sum | awk '{print $1}' | cut -c1-8
    return
  fi
  if command -v md5 >/dev/null 2>&1; then
    printf "%s" "$cwd" | md5 -q 2>/dev/null | cut -c1-8
    return
  fi
  printf "%s" "$cwd" | shasum -a 256 | awk '{print $1}' | cut -c1-8
}

session_prefix="codex-hud-$(hash_cwd "$PWD")"
existing_session="${session_prefix}-20260209093000-4242"

prepare_tmux_env() {
  local log_file="$1"
  export TMUX_LOG_FILE="$log_file"
  export TMUX_MAIN_PANE_ID="%1"
  export TMUX_PANE_ID="%2"
  export TMUX_PANES=$'%1\n%2'
  export TMUX_SPLIT_PANE_ID="%2"
  export TMUX_BASE_HEIGHT="5"
  export TMUX_HEIGHT="5"
  export TMUX_HEIGHT_MIN="5"
  export TMUX_HEIGHT_MAX="12"
  export TMUX_AUTO="0"
  export TMUX_PANE_WIDTH="120"
  export TMUX_PANE_HEIGHT="5"
  export TMUX_MAIN_PANE_IN_MODE="0"
  export TMUX_REJECT_TARGET_0="1"
}

run_and_assert_new_session() {
  local label="$1"
  shift
  local log_file
  log_file="$(mktemp)"
  prepare_tmux_env "$log_file"
  export TMUX_SESSION_LIST="$existing_session"

  "$ROOT_DIR/bin/codex-hud" "$@" >/tmp/codex-hud-test.log 2>&1

  if ! grep -q '^new-session ' "$log_file"; then
    echo "[$label] expected new-session command" >&2
    cat "$log_file" >&2
    exit 1
  fi
  if grep -q "attach-session -t $existing_session" "$log_file"; then
    echo "[$label] should not attach existing session" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

run_and_assert_attach_existing() {
  local label="$1"
  shift
  local log_file
  log_file="$(mktemp)"
  prepare_tmux_env "$log_file"
  export TMUX_SESSION_LIST="$existing_session"

  "$ROOT_DIR/bin/codex-hud" "$@" >/tmp/codex-hud-test.log 2>&1

  if grep -q '^new-session ' "$log_file"; then
    echo "[$label] should not create new session" >&2
    cat "$log_file" >&2
    exit 1
  fi
  if ! grep -q "attach-session -t $existing_session" "$log_file"; then
    echo "[$label] expected attach to existing session" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

unset CODEX_HUD_AUTO_ATTACH
unset CODEX_HUD_NO_ATTACH
run_and_assert_new_session "default-new-session"

export CODEX_HUD_AUTO_ATTACH="1"
run_and_assert_attach_existing "env-auto-attach"
unset CODEX_HUD_AUTO_ATTACH

run_and_assert_attach_existing "cli-attach" --attach

export CODEX_HUD_AUTO_ATTACH="1"
run_and_assert_new_session "cli-new-session-overrides" --new-session
unset CODEX_HUD_AUTO_ATTACH

invalid_log="$(mktemp)"
prepare_tmux_env "$invalid_log"
export TMUX_SESSION_LIST="$existing_session"
export CODEX_HUD_AUTO_ATTACH="maybe"
set +e
"$ROOT_DIR/bin/codex-hud" >/tmp/codex-hud-test.log 2>&1
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  echo "[invalid-boolean] expected non-zero exit" >&2
  exit 1
fi
if ! grep -q 'CODEX_HUD_AUTO_ATTACH must be one of' /tmp/codex-hud-test.log; then
  echo "[invalid-boolean] expected validation error message" >&2
  cat /tmp/codex-hud-test.log >&2
  exit 1
fi
unset CODEX_HUD_AUTO_ATTACH

echo "test-session-attach-policy: PASS"
