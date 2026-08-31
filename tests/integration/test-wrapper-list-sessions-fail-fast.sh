#!/usr/bin/env bash
set -euo pipefail

# Verify that a tmux server/socket failure is surfaced by --list instead of
# being reported as an empty session set.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-list-fail-fast-XXXXXX)"
FAKE_BIN_DIR="$TEST_ROOT/bin"
OUTPUT_LOG="$TEST_ROOT/output.log"

mkdir -p "$FAKE_BIN_DIR"
cat > "$FAKE_BIN_DIR/tmux" <<'FAKE_TMUX'
#!/usr/bin/env bash
if [[ "${1:-}" == "list-sessions" ]]; then
  printf 'simulated tmux socket failure\n' >&2
  exit 23
fi
exit 0
FAKE_TMUX
chmod +x "$FAKE_BIN_DIR/tmux"

set +e
env -i \
  HOME="$TEST_ROOT/home" \
  PATH="$FAKE_BIN_DIR:/usr/bin:/bin" \
  "$ROOT_DIR/bin/codex-hud" --list >"$OUTPUT_LOG" 2>&1
status=$?
set -e

if [[ "$status" -eq 0 ]]; then
  echo "test-wrapper-list-sessions-fail-fast: FAIL - tmux error was swallowed" >&2
  cat "$OUTPUT_LOG" >&2
  exit 1
fi
if ! grep -Fq 'simulated tmux socket failure' "$OUTPUT_LOG"; then
  echo "test-wrapper-list-sessions-fail-fast: FAIL - tmux error was not surfaced" >&2
  cat "$OUTPUT_LOG" >&2
  exit 1
fi

echo "test-wrapper-list-sessions-fail-fast: PASS (status=$status, error_visible=1)"
