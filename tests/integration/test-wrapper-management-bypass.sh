#!/usr/bin/env bash
set -euo pipefail

# Management commands must remain usable when a stale legacy launch profile
# points at an invalid CLI. Listing sessions does not launch a provider.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-management-bypass-XXXXXX)"
FAKE_BIN_DIR="$TEST_ROOT/bin"
OUTPUT_LOG="$TEST_ROOT/output.log"
HELP_LOG="$TEST_ROOT/help.log"

mkdir -p "$FAKE_BIN_DIR"
cat > "$FAKE_BIN_DIR/tmux" <<'FAKE_TMUX'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "list-sessions" ]]; then
  printf '%s\n' 'codex-hud-management-bypass-1 1'
  exit 0
fi
exit 0
FAKE_TMUX
chmod +x "$FAKE_BIN_DIR/tmux"

set +e
env -i \
  HOME="$TEST_ROOT/home" \
  PATH="$FAKE_BIN_DIR:/usr/bin:/bin" \
  CODEX_HUD_CLI_PATH="$TEST_ROOT/missing-cli" \
  CODEX_HUD_SESSION_PREFIX='legacy-prefix' \
  CODEX_HUD_SHELL_PATH='/bin/bash' \
  "$ROOT_DIR/bin/codex-hud" --list >"$OUTPUT_LOG" 2>&1
status=$?
set -e

if [[ "$status" -ne 0 ]]; then
  echo "test-wrapper-management-bypass: FAIL - --list depended on stale launch profile (status=$status)" >&2
  cat "$OUTPUT_LOG" >&2
  exit 1
fi
if ! grep -Fqx 'codex-hud-management-bypass-1' "$OUTPUT_LOG"; then
  echo "test-wrapper-management-bypass: FAIL - --list did not report the HUD session" >&2
  cat "$OUTPUT_LOG" >&2
  exit 1
fi

set +e
env -i \
  HOME="$TEST_ROOT/home" \
  PATH="$FAKE_BIN_DIR:/usr/bin:/bin" \
  CODEX_HUD_CLI_PATH="$TEST_ROOT/missing-cli" \
  CODEX_HUD_SESSION_PREFIX='legacy-prefix' \
  CODEX_HUD_SHELL_PATH='/bin/bash' \
  "$ROOT_DIR/bin/codex-hud" --help >"$HELP_LOG" 2>&1
help_status=$?
set -e

if [[ "$help_status" -ne 0 ]]; then
  echo "test-wrapper-management-bypass: FAIL - --help depended on stale launch profile (status=$help_status)" >&2
  cat "$HELP_LOG" >&2
  exit 1
fi
if ! grep -Fq 'Usage: codex-hud' "$HELP_LOG"; then
  echo "test-wrapper-management-bypass: FAIL - --help did not print usage" >&2
  cat "$HELP_LOG" >&2
  exit 1
fi

echo "test-wrapper-management-bypass: PASS (list_status=$status, help_status=$help_status, stale_profile_ignored=2)"
