#!/usr/bin/env bash
#
# Test script for codex-hud tmux integration
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ISOLATED_SOCKET="codexhud-management-$$"

cleanup() {
    TMUX= tmux -L "$ISOLATED_SOCKET" -f /dev/null kill-server >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Testing codex-hud tmux integration"
echo ""

# Test 1: Check nested tmux attachment through the dedicated integration test
echo "Test 1: Detecting tmux environment"
if [[ -n "${TMUX:-}" ]]; then
    echo "  ✓ Currently inside tmux (TMUX=$TMUX)"
    echo "  Nested client behavior is covered by the isolated integration fixture."
else
    echo "  ✓ Not inside tmux"
fi

"$SCRIPT_DIR/integration/test-nested-tmux-launch.sh"

echo ""

# Test 2: List sessions on an isolated tmux server
echo "Test 2: Listing sessions on an isolated tmux server"
if command -v md5sum >/dev/null 2>&1; then
    session_hash=$(printf "%s" "$PROJECT_DIR" | md5sum | awk '{print $1}')
elif command -v md5 >/dev/null 2>&1; then
    session_hash=$(printf "%s" "$PROJECT_DIR" | md5 -q 2>/dev/null || printf "%s" "$PROJECT_DIR" | md5 | awk '{print $NF}')
elif command -v shasum >/dev/null 2>&1; then
    session_hash=$(printf "%s" "$PROJECT_DIR" | shasum -a 256 | awk '{print $1}')
else
    echo "No supported hash command is available for the isolated session fixture." >&2
    exit 1
fi
project_slug="$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//')"
session_name="codex-hud-${project_slug}-${session_hash:0:8}-integration"
TMUX= tmux -L "$ISOLATED_SOCKET" -f /dev/null new-session -d -s "$session_name" "sleep 60"
socket_path=$(TMUX= tmux -L "$ISOLATED_SOCKET" -f /dev/null display-message -p -t "$session_name" '#{socket_path}')
session_id=$(TMUX= tmux -L "$ISOLATED_SOCKET" -f /dev/null display-message -p -t "$session_name" '#{session_id}')
isolated_tmux="$socket_path,$$,$session_id"

list_output=$(cd "$PROJECT_DIR" && TMUX="$isolated_tmux" "$PROJECT_DIR/bin/codex-hud" --list)
if [[ "$list_output" != *"$session_name"* ]]; then
    echo "The isolated codex-hud session was not listed." >&2
    printf '%s\n' "$list_output" >&2
    exit 1
fi
printf '%s\n' "$list_output"
echo ""

# Test 3: Kill only the matching session on the isolated tmux server
echo "Test 3: Cleaning up the isolated session"
(cd "$PROJECT_DIR" && TMUX="$isolated_tmux" "$PROJECT_DIR/bin/codex-hud" --kill)
if TMUX= tmux -L "$ISOLATED_SOCKET" -f /dev/null has-session -t "$session_name" 2>/dev/null; then
    echo "The isolated codex-hud session was not killed." >&2
    exit 1
fi
echo ""

echo "==> All tests passed!"
echo ""
echo "To test actual codex integration:"
echo "  1. Exit tmux if you're in it: tmux detach"
echo "  2. Run: codex-hud"
echo "  3. You should see codex CLI in the main pane"
echo "  4. HUD status should appear at the bottom"
