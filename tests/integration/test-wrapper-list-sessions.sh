#!/usr/bin/env bash
set -euo pipefail

# Verify that --list discovers every HUD-owned session, including sessions
# created through the legacy StepCode route, without listing unrelated tmux
# sessions.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-list-sessions-XXXXXX)"
FAKE_BIN_DIR="$TEST_ROOT/bin"
TMUX_LOG="$TEST_ROOT/tmux.log"
OUTPUT_LOG="$TEST_ROOT/output.log"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN_DIR"
cat > "$FAKE_BIN_DIR/tmux" <<'FAKE_TMUX'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${TMUX_LOG_FILE:?}"
if [[ "${1:-}" == "list-sessions" ]]; then
  # The marker column models tmux's #{session_name} #{ @codex_hud_session }
  # output. The current implementation ignores it and therefore fails this
  # regression for StepCode and arbitrary legacy prefixes.
  printf '%b\n' "${TMUX_SESSION_LIST:?}"
fi
FAKE_TMUX
chmod +x "$FAKE_BIN_DIR/tmux"

export PATH="$FAKE_BIN_DIR:/usr/bin:/bin"
export HOME="$TEST_ROOT/home"
export TMUX_LOG_FILE="$TMUX_LOG"
export TMUX_SESSION_LIST=$'codex-hud-project-abc-20260831190000-1 1\nstepcode-codex-hud-project-abc-20260831190001-2 1\ncustom-legacy-project-abc-20260831190002-3 1\nunrelated-session 0'

"$ROOT_DIR/bin/codex-hud" --list >"$OUTPUT_LOG" 2>&1

for expected in \
  'codex-hud-project-abc-20260831190000-1' \
  'stepcode-codex-hud-project-abc-20260831190001-2' \
  'custom-legacy-project-abc-20260831190002-3'; do
  if ! grep -Fqx "$expected" "$OUTPUT_LOG"; then
    echo "test-wrapper-list-sessions: missing HUD session: $expected" >&2
    cat "$OUTPUT_LOG" >&2
    exit 1
  fi
done

if grep -Fqx 'unrelated-session' "$OUTPUT_LOG"; then
  echo "test-wrapper-list-sessions: unrelated tmux session was listed" >&2
  cat "$OUTPUT_LOG" >&2
  exit 1
fi

echo "test-wrapper-list-sessions: PASS (native=1, stepcode=1, custom_marker=1, unrelated=0)"
