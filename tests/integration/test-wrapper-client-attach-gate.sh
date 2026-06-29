#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
FAKE_BIN_DIR="$(mktemp -d)"
log_file=""
output_log=""

cleanup() {
  rm -rf "$FAKE_BIN_DIR"
  [[ -n "$log_file" ]] && rm -f "$log_file"
  [[ -n "$output_log" ]] && rm -f "$output_log"
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

log_file="$(mktemp)"
output_log="$(mktemp)"
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

"$ROOT_DIR/bin/codex-hud" >"$output_log" 2>&1

if ! grep -q '^set-hook .*client-attached.*@codex_hud_client_attached 1' "$log_file"; then
  echo "expected client-attached hook to set the launch gate" >&2
  cat "$log_file" >&2
  exit 1
fi

if ! grep -q '^send-keys .*@codex_hud_client_attached' "$log_file"; then
  echo "expected codex launch command to wait for the attach gate" >&2
  cat "$log_file" >&2
  exit 1
fi

echo "test-wrapper-client-attach-gate: PASS"
