#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAKE_BIN_DIR="$(mktemp -d)"
TMUX_DIR="$(mktemp -d)"

cleanup() {
  TMUX_TMPDIR="$TMUX_DIR" tmux kill-server >/dev/null 2>&1 || true
  rm -rf "$FAKE_BIN_DIR" "$TMUX_DIR"
}
trap cleanup EXIT

cat > "$FAKE_BIN_DIR/codex" <<'FAKE'
#!/usr/bin/env bash
echo fake-codex
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

TMUX_TMPDIR="$TMUX_DIR" tmux -f /dev/null new-session -d -s bootstrap "sleep 30"
TMUX_TMPDIR="$TMUX_DIR" tmux -f /dev/null set-option -g base-index 1

set +e
output=$(TMUX_TMPDIR="$TMUX_DIR" PATH="$FAKE_BIN_DIR:$PATH" CODEX_HUD_HEIGHT=5 CODEX_HUD_HEIGHT_AUTO=0 "$ROOT_DIR/bin/codex-hud" 2>&1)
status=$?
set -e

if grep -q "no such window" <<<"$output"; then
  echo "Unexpected no such window error:" >&2
  echo "$output" >&2
  exit 1
fi

# Non-interactive shell cannot attach tmux client; this is expected here.
if ! grep -q "open terminal failed: not a terminal" <<<"$output"; then
  echo "Expected non-interactive attach error was not observed:" >&2
  echo "$output" >&2
  exit 1
fi

if [[ "$status" -eq 0 ]]; then
  echo "Expected non-zero exit in non-interactive shell" >&2
  exit 1
fi

echo "test-wrapper-base-index-smoke: PASS"
