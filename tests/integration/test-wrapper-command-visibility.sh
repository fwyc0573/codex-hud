#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
FAKE_BIN_ROOT="$(mktemp -d)"
FAKE_BIN_DIR="$FAKE_BIN_ROOT/codex dir;\$(marker)"
LOG_FILE="$(mktemp)"
OUTPUT_FILE="$(mktemp)"
NODE_LOG_FILE="$(mktemp)"

cleanup() {
  rm -rf "$FAKE_BIN_ROOT"
  rm -f "$LOG_FILE" "$OUTPUT_FILE" "$NODE_LOG_FILE"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN_DIR"

cat > "$FAKE_BIN_DIR/codex" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/node" <<'FAKE'
#!/usr/bin/env bash
if [[ -n "${NODE_LOG_FILE:-}" ]]; then
  printf '%s\n' "$*" >> "$NODE_LOG_FILE"
fi
if [[ "${1:-}" == "--version" ]]; then
  echo "v20.11.0"
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

export PATH="$FAKE_BIN_DIR:$FAKE_TMUX_DIR:$PATH"
export CODEX_HUD_UPDATE_CHECK=1
export CODEX_HUD_SHELL_PATH="/bin/zsh"
export NODE_LOG_FILE
export CODEX_HUD_HEIGHT=5
export CODEX_HUD_HEIGHT_AUTO=0
export TMUX_LOG_FILE="$LOG_FILE"
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

set +e
"$ROOT_DIR/bin/codex-hud" --new-session >"$OUTPUT_FILE" 2>&1
wrapper_status=$?
set -e

if [[ "$wrapper_status" -ne 0 ]]; then
  echo "wrapper failed unexpectedly: status=$wrapper_status" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if grep -q '^send-keys .*@codex_hud_client_attached' "$LOG_FILE"; then
  echo "Codex launch is still injected into the interactive shell with send-keys." >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

launch_line="$(grep -m1 '^respawn-pane ' "$LOG_FILE" || true)"
if [[ -z "$launch_line" ]]; then
  echo "Expected a direct respawn-pane launch command." >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

for required in '@codex_hud_client_attached' 'zsh' '-ilc' 'codex'; do
  if [[ "$launch_line" != *"$required"* ]]; then
    echo "respawn-pane launch is missing required component: $required" >&2
    echo "$launch_line" >&2
    exit 1
  fi
done

if ! grep -F -- '-ilc' "$LOG_FILE" >/dev/null; then
  echo "Codex launch was not routed through an interactive login zsh." >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

escaped_codex_path="$(printf '%q' "$FAKE_BIN_DIR/codex")"
double_escaped_codex_path="$(printf '%q' "$escaped_codex_path")"
if [[ "$launch_line" != *"$double_escaped_codex_path"* ]]; then
  echo "Codex executable path was not shell-quoted in the respawn command." >&2
  echo "expected=$double_escaped_codex_path" >&2
  echo "$launch_line" >&2
  exit 1
fi

if ! grep -F -- "check --checkout $ROOT_DIR" "$NODE_LOG_FILE" >/dev/null; then
  echo "Update check did not use the codex-hud checkout." >&2
  cat "$NODE_LOG_FILE" >&2
  exit 1
fi

echo "test-wrapper-command-visibility: PASS"
