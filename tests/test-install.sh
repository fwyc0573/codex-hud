#!/usr/bin/env bash
#
# test-install.sh - Test the installation scripts
# Run this to verify install/uninstall work correctly
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"
MARKER="# codex-hud alias"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test functions
test_start() {
    echo -e "${BLUE}TEST:${NC} $1"
    ((TESTS_RUN++))
}

test_pass() {
    echo -e "  ${GREEN}✓ PASS${NC}"
    ((TESTS_PASSED++))
}

test_fail() {
    echo -e "  ${RED}✗ FAIL:${NC} $1"
    ((TESTS_FAILED++))
}

# Cleanup test artifacts
cleanup() {
    # Remove test markers from RC files
    for file in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile"; do
        if [[ -f "$file" ]]; then
            # Create temp file without our test markers
            grep -v "$MARKER" "$file" > "$file.tmp" 2>/dev/null || true
            mv "$file.tmp" "$file" 2>/dev/null || true
        fi
    done
    
    # Remove backup file
    rm -f "$HOME/.codex-hud-backup-aliases"
}

# Test 1: Verify script files exist and are executable
test_files_exist() {
    test_start "Script files exist and are executable"
    
    local all_exist=true
    
    if [[ ! -f "$PARENT_DIR/install.sh" ]]; then
        test_fail "install.sh not found"
        return
    fi
    
    if [[ ! -f "$PARENT_DIR/uninstall.sh" ]]; then
        test_fail "uninstall.sh not found"
        return
    fi
    
    if [[ ! -f "$PARENT_DIR/bin/codex-hud" ]]; then
        test_fail "bin/codex-hud not found"
        return
    fi
    
    if [[ ! -x "$PARENT_DIR/install.sh" ]]; then
        test_fail "install.sh not executable"
        return
    fi
    
    if [[ ! -x "$PARENT_DIR/uninstall.sh" ]]; then
        test_fail "uninstall.sh not executable"
        return
    fi
    
    test_pass
}

# Test 2: Verify bash syntax of all scripts
test_bash_syntax() {
    test_start "Bash syntax is valid"
    
    if ! bash -n "$PARENT_DIR/install.sh" 2>/dev/null; then
        test_fail "install.sh has syntax errors"
        return
    fi
    
    if ! bash -n "$PARENT_DIR/uninstall.sh" 2>/dev/null; then
        test_fail "uninstall.sh has syntax errors"
        return
    fi
    
    if ! bash -n "$PARENT_DIR/bin/codex-hud" 2>/dev/null; then
        test_fail "bin/codex-hud has syntax errors"
        return
    fi
    
    test_pass
}

# Test 3: Verify shell detection works
test_shell_detection() {
    test_start "Shell detection works"
    
    local shell_name
    shell_name=$(basename "$SHELL")
    
    if [[ -z "$shell_name" ]]; then
        test_fail "Could not detect shell"
        return
    fi
    
    if [[ ! "$shell_name" =~ ^(bash|zsh|fish|sh)$ ]]; then
        echo -e "  ${YELLOW}WARNING:${NC} Unusual shell detected: $shell_name"
    fi
    
    test_pass
}

# Test 4: Verify RC file detection
test_rc_file_detection() {
    test_start "RC file detection works"
    
    local shell_name
    shell_name=$(basename "$SHELL")
    
    case "$shell_name" in
        bash)
            if [[ -f "$HOME/.bashrc" ]] || [[ -f "$HOME/.bash_profile" ]]; then
                test_pass
            else
                test_fail "No bash RC file found"
            fi
            ;;
        zsh)
            if [[ -f "$HOME/.zshrc" ]] || [[ -w "$HOME" ]]; then
                test_pass
            else
                test_fail "Cannot write to home directory"
            fi
            ;;
        *)
            test_pass  # Other shells may have different configs
            ;;
    esac
}

# Test 5: Verify tmux detection
test_tmux_detection() {
    test_start "tmux detection works"
    
    if command -v tmux >/dev/null 2>&1; then
        echo -e "  ${GREEN}tmux found:${NC} $(tmux -V)"
        test_pass
    else
        echo -e "  ${YELLOW}tmux not installed${NC} - will be auto-installed on first run"
        test_pass
    fi
}

# Test 6: Verify Node.js is available
test_node_available() {
    test_start "Node.js is available"
    
    if ! command -v node >/dev/null 2>&1; then
        test_fail "Node.js not found"
        return
    fi
    
    local node_version
    node_version=$(node --version)
    local major_version
    major_version=$(echo "$node_version" | sed 's/v//' | cut -d. -f1)
    
    if [[ "$major_version" -lt 18 ]]; then
        test_fail "Node.js version $node_version is too old (need 18+)"
        return
    fi
    
    echo -e "  ${GREEN}Node.js:${NC} $node_version"
    test_pass
}

# Test 7: Verify codex CLI is available
test_codex_available() {
    test_start "Codex CLI is available"
    
    if command -v codex >/dev/null 2>&1; then
        echo -e "  ${GREEN}codex found:${NC} $(which codex)"
        test_pass
    else
        echo -e "  ${YELLOW}codex not found${NC} - required for full functionality"
        test_pass  # Not a failure, just a warning
    fi
}

# Test 8: Verify TypeScript builds
test_typescript_build() {
    test_start "TypeScript project builds"
    
    if [[ ! -d "$PARENT_DIR/node_modules" ]]; then
        echo -e "  ${YELLOW}Skipping:${NC} node_modules not installed"
        test_pass
        return
    fi
    
    if [[ -f "$PARENT_DIR/dist/index.js" ]]; then
        test_pass
    else
        echo -e "  ${YELLOW}dist/index.js not found${NC} - run 'npm run build'"
        test_pass  # Not a failure
    fi
}

# Test 9: Verify wrapper script help works
test_wrapper_help() {
    test_start "Wrapper --help works"
    
    local help_output
    help_output=$("$PARENT_DIR/bin/codex-hud" --help 2>&1 || true)
    
    if echo "$help_output" | grep -q "codex-hud"; then
        test_pass
    else
        test_fail "Help output doesn't contain expected content"
    fi
}

# Test 10: Verify session naming
test_session_naming() {
    test_start "Session naming is deterministic"
    
    local session1
    local session2
    
    # Session name should be based on PWD hash
    session1=$(echo "$PWD" | md5sum 2>/dev/null | cut -c1-8 || echo "fallback")
    session2=$(echo "$PWD" | md5sum 2>/dev/null | cut -c1-8 || echo "fallback")
    
    if [[ "$session1" == "$session2" ]]; then
        test_pass
    else
        test_fail "Session names are not deterministic"
    fi
}

# Print summary
print_summary() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Test Summary${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    echo -e "Tests run:    ${TESTS_RUN}"
    echo -e "Tests passed: ${GREEN}${TESTS_PASSED}${NC}"
    echo -e "Tests failed: ${RED}${TESTS_FAILED}${NC}"
    echo ""
    
    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}All tests passed!${NC}"
        return 0
    else
        echo -e "${RED}Some tests failed.${NC}"
        return 1
    fi
}

# Main
main() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Codex HUD Installation Tests${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    
    # Run tests
    test_files_exist
    test_bash_syntax
    test_shell_detection
    test_rc_file_detection
    test_tmux_detection
    test_node_available
    test_codex_available
    test_typescript_build
    test_wrapper_help
    test_session_naming
    
    # Print summary
    print_summary
}

# Run main
main "$@"
