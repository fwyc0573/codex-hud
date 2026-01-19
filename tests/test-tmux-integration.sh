#!/usr/bin/env bash
#
# Test script for codex-hud tmux integration
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Testing codex-hud tmux integration"
echo ""

# Test 1: Check if we can detect being inside tmux
echo "Test 1: Detecting tmux environment"
if [[ -n "${TMUX:-}" ]]; then
    echo "  ✓ Currently inside tmux (TMUX=$TMUX)"
    echo "  Testing error handling..."
    
    # Should fail with error message
    if "$PROJECT_DIR/bin/codex-hud" --help >/dev/null 2>&1; then
        echo "  ✓ Help works inside tmux"
    fi
    
    # Try to run (should fail gracefully)
    if "$PROJECT_DIR/bin/codex-hud" 2>&1 | grep -q "cannot be run from inside"; then
        echo "  ✓ Correctly prevents nested sessions"
    else
        echo "  ✗ Failed to prevent nested sessions"
        exit 1
    fi
else
    echo "  ✓ Not inside tmux"
fi

echo ""

# Test 2: List sessions
echo "Test 2: Listing sessions"
"$PROJECT_DIR/bin/codex-hud" --list
echo ""

# Test 3: Kill all sessions
echo "Test 3: Cleaning up sessions"
"$PROJECT_DIR/bin/codex-hud" --kill-all
echo ""

echo "==> All tests passed!"
echo ""
echo "To test actual codex integration:"
echo "  1. Exit tmux if you're in it: tmux detach"
echo "  2. Run: codex-hud"
echo "  3. You should see codex CLI in the main pane"
echo "  4. HUD status should appear at the bottom"
