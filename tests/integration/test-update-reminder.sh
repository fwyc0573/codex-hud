#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_BIN_DIR="$(mktemp -d)"
EVENT_LOG="$(mktemp)"
TMUX_LOG_FILE="$EVENT_LOG"

cleanup() {
  rm -rf "$FAKE_BIN_DIR"
  rm -f "$EVENT_LOG"
}
trap cleanup EXIT

cat > "$FAKE_BIN_DIR/codex" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/node" <<'FAKE'
#!/usr/bin/env bash
echo "node $*" >> "${EVENT_LOG:?}"
if [[ "${1:-}" == "--version" ]]; then
  echo "v20.11.0"
fi
if [[ "${FAKE_NODE_REGISTER_FAIL:-0}" == "1" && "$*" == *"register-session"* ]]; then
  echo 'simulated register-session failure' >&2
  exit 17
fi
exit 0
FAKE

cat > "$FAKE_BIN_DIR/npm" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/tput" <<'FAKE'
#!/usr/bin/env bash
case "${1:-}" in
  lines) echo 24 ;;
  cols) echo 80 ;;
  *) echo 0 ;;
esac
FAKE

chmod +x "$FAKE_BIN_DIR/codex" "$FAKE_BIN_DIR/node" "$FAKE_BIN_DIR/npm" "$FAKE_BIN_DIR/tput"

export EVENT_LOG
export PATH="$FAKE_BIN_DIR:$SCRIPT_DIR/fake-tmux:$PATH"
export TMUX_LOG_FILE="$EVENT_LOG"
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
export CODEX_HUD_HEIGHT=5
export CODEX_HUD_HEIGHT_AUTO=0
export CODEX_HUD_UPDATE_CHECK=1
unset CODEX_HUD_AUTO_ATTACH CODEX_HUD_NO_ATTACH

"$ROOT_DIR/bin/codex-hud" >/tmp/codex-hud-update-reminder-test.log 2>&1

check_line=$(grep -n 'node .*codex-hud-update\.mjs check --checkout' "$EVENT_LOG" | head -n1 | cut -d: -f1)
register_line=$(grep -n 'node .*codex-hud-update\.mjs register-session' "$EVENT_LOG" | head -n1 | cut -d: -f1)
new_line=$(grep -n '^new-session ' "$EVENT_LOG" | head -n1 | cut -d: -f1)
launch_line=$(grep -n '^respawn-pane ' "$EVENT_LOG" | head -n1 | cut -d: -f1)
if [[ -z "$check_line" || -z "$register_line" || -z "$new_line" || -z "$launch_line" ]]; then
  echo "expected check/register/new-session/respawn-pane events" >&2
  cat "$EVENT_LOG" >&2
  cat /tmp/codex-hud-update-reminder-test.log >&2
  exit 1
fi
if (( check_line >= new_line || new_line >= register_line || register_line >= launch_line )); then
  echo "unexpected event ordering: check=$check_line new=$new_line register=$register_line launch=$launch_line" >&2
  cat "$EVENT_LOG" >&2
  exit 1
fi

: > "$EVENT_LOG"
session_prefix="codex-hud-$(basename "$PWD")-$(printf '%s' "$PWD" | md5sum | awk '{print substr($1, 1, 8)}')"
export TMUX_SESSION_LIST="${session_prefix}-existing"
export CODEX_HUD_AUTO_ATTACH=1
"$ROOT_DIR/bin/codex-hud" >/tmp/codex-hud-update-reminder-attach.log 2>&1
if grep -q 'codex-hud-update\.mjs \(check\|register-session\)' "$EVENT_LOG"; then
  echo "attach path must not invoke update helper" >&2
  cat "$EVENT_LOG" >&2
  exit 1
fi

: > "$EVENT_LOG"
unset TMUX_SESSION_LIST CODEX_HUD_AUTO_ATTACH
export CODEX_HUD_UPDATE_CHECK=false
"$ROOT_DIR/bin/codex-hud" >/tmp/codex-hud-update-reminder-disabled.log 2>&1
if grep -q 'codex-hud-update\.mjs \(check\|register-session\)' "$EVENT_LOG"; then
  echo "disabled update checks must not invoke helper" >&2
  cat "$EVENT_LOG" >&2
  exit 1
fi

: > "$EVENT_LOG"
export CODEX_HUD_UPDATE_CHECK=1
export FAKE_NODE_REGISTER_FAIL=1
if ! "$ROOT_DIR/bin/codex-hud" >/tmp/codex-hud-update-reminder-register-failure.log 2>&1; then
  echo "register-session failure must not stop Codex startup" >&2
  cat /tmp/codex-hud-update-reminder-register-failure.log >&2
  exit 1
fi
if ! grep -q 'optional deferred update registration failed' /tmp/codex-hud-update-reminder-register-failure.log; then
  echo "expected visible advisory warning for register-session failure" >&2
  cat /tmp/codex-hud-update-reminder-register-failure.log >&2
  exit 1
fi
if ! grep -q 'node .*codex-hud-update\.mjs abort-session' "$EVENT_LOG"; then
  echo "registration failure must abort its pending state/record" >&2
  cat "$EVENT_LOG" >&2
  exit 1
fi
unset FAKE_NODE_REGISTER_FAIL

: > "$EVENT_LOG"
export TMUX_ATTACH_FAIL=1
export TMUX_HAS_SESSION=1
set +e
export CODEX_HUD_UPDATE_CHECK=1
TMUX= "$ROOT_DIR/bin/codex-hud" >/tmp/codex-hud-update-reminder-attach-failure.log 2>&1
attach_failure_status=$?
set -e
unset TMUX_ATTACH_FAIL TMUX_HAS_SESSION CODEX_HUD_UPDATE_CHECK
if [[ "$attach_failure_status" -eq 0 ]]; then
  echo "simulated attach failure unexpectedly succeeded" >&2
  exit 1
fi
if ! grep -q '^kill-session ' "$EVENT_LOG"; then
  echo "startup attach failure must clean the orphan session" >&2
  cat "$EVENT_LOG" >&2
  exit 1
fi
abort_line=$(grep -n 'node .*codex-hud-update\.mjs abort-session' "$EVENT_LOG" | head -n1 | cut -d: -f1)
kill_line=$(grep -n '^kill-session ' "$EVENT_LOG" | head -n1 | cut -d: -f1)
if [[ -z "$abort_line" || -z "$kill_line" || "$abort_line" -ge "$kill_line" ]]; then
  echo "startup attach failure must abort deferred registration before killing the orphan" >&2
  cat "$EVENT_LOG" >&2
  exit 1
fi

echo "test-update-reminder: PASS"
