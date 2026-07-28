#!/usr/bin/env bash
#
# End-to-end test for codex-hud
# Tests installation, wrapper functionality, and Codex CLI compatibility
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WRAPPER="$PROJECT_DIR/bin/codex-hud"
TMUX_SOCKET="codexhud-legacy-e2e-$$"
TMUX_SENTINEL="legacy-e2e-sentinel-$$"

cleanup() {
    TMUX= tmux -L "$TMUX_SOCKET" -f /dev/null kill-server >/dev/null 2>&1 || true
}
trap cleanup EXIT

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${BLUE}==>${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local name="$1"
    local cmd="$2"
    
    if eval "$cmd" >/dev/null 2>&1; then
        pass "$name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        warn "FAILED: $name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

echo ""
echo "========================================"
echo "  Codex HUD End-to-End Test Suite"
echo "========================================"
echo ""

# Bind every wrapper call to a dedicated tmux server, even when this test is
# launched from an existing tmux pane.
info "Creating isolated tmux fixture..."
TMUX= tmux -L "$TMUX_SOCKET" -f /dev/null new-session -d -s "$TMUX_SENTINEL" "sleep 60"
socket_path=$(TMUX= tmux -L "$TMUX_SOCKET" -f /dev/null display-message -p -t "$TMUX_SENTINEL" '#{socket_path}')
session_id=$(TMUX= tmux -L "$TMUX_SOCKET" -f /dev/null display-message -p -t "$TMUX_SENTINEL" '#{session_id}')
export TMUX="$socket_path,$$,${session_id#\$}"

# Test 1: Wrapper script exists and is executable
info "Test 1: Wrapper script"
run_test "Wrapper exists" "[[ -f '$WRAPPER' ]]"
run_test "Wrapper is executable" "[[ -x '$WRAPPER' ]]"

# Test 2: Help option works
info "Test 2: Help option"
run_test "--help returns success" "$WRAPPER --help"
run_test "--help contains usage info" "$WRAPPER --help | grep -q 'Usage:'"

# Test 3: List option works
info "Test 3: List option"
run_test "--list returns success" "$WRAPPER --list"

# Test 4: Find real codex
info "Test 4: Real Codex CLI detection"
REAL_CODEX=$("$SCRIPT_DIR/test-find-codex.sh" 2>/dev/null | grep "Found real codex" | awk '{print $NF}')
if [[ -n "$REAL_CODEX" ]]; then
    pass "Found real codex at: $REAL_CODEX"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    warn "Could not find real codex CLI"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 5: Real codex --help works
info "Test 5: Real Codex CLI functionality"
if [[ -n "$REAL_CODEX" ]]; then
    run_test "Real codex --help works" "$REAL_CODEX --help"
    run_test "Real codex --version works" "$REAL_CODEX --version"
fi

# Test 6: HUD renderer works
info "Test 6: HUD renderer"
run_test "dist/index.js exists" "[[ -f '$PROJECT_DIR/dist/index.js' ]]"

# Test 7: Node.js can load the HUD
info "Test 7: HUD module loads"
run_test "HUD module syntax valid" "node --check '$PROJECT_DIR/dist/index.js'"

# Summary
echo ""
echo "========================================"
echo "  Test Summary"
echo "========================================"
echo -e "  ${GREEN}Passed:${NC} $TESTS_PASSED"
echo -e "  ${RED}Failed:${NC} $TESTS_FAILED"
echo ""

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi

echo -e "${GREEN}All tests passed!${NC}"
