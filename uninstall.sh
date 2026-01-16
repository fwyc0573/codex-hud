#!/usr/bin/env bash
#
# uninstall.sh - Uninstall codex-hud and restore original configuration
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_FILE="$HOME/.codex-hud-backup-aliases"
MARKER="# codex-hud alias"

# Print functions
error() { echo -e "${RED}Error:${NC} $1" >&2; exit 1; }
warn() { echo -e "${YELLOW}Warning:${NC} $1" >&2; }
info() { echo -e "${GREEN}✓${NC} $1"; }
step() { echo -e "${BLUE}==>${NC} $1"; }
header() { echo -e "\n${BOLD}${CYAN}$1${NC}\n"; }

# Detect user's shell
detect_shell() {
    local shell_name
    shell_name=$(basename "$SHELL")
    echo "$shell_name"
}

# Get the RC file for a given shell
get_rc_file() {
    local shell_name="$1"
    case "$shell_name" in
        bash)
            if [[ -f "$HOME/.bashrc" ]]; then
                echo "$HOME/.bashrc"
            elif [[ -f "$HOME/.bash_profile" ]]; then
                echo "$HOME/.bash_profile"
            else
                echo "$HOME/.bashrc"
            fi
            ;;
        zsh)
            echo "$HOME/.zshrc"
            ;;
        fish)
            echo "$HOME/.config/fish/config.fish"
            ;;
        *)
            echo ""
            ;;
    esac
}

# Remove our alias from RC file
remove_alias() {
    local rc_file="$1"
    
    if [[ ! -f "$rc_file" ]]; then
        warn "RC file not found: $rc_file"
        return 0
    fi
    
    if ! grep -q "$MARKER" "$rc_file" 2>/dev/null; then
        info "No codex-hud alias found in $rc_file"
        return 0
    fi
    
    # Remove lines containing our marker
    local temp_file
    temp_file=$(mktemp)
    grep -v "$MARKER" "$rc_file" > "$temp_file" || true
    mv "$temp_file" "$rc_file"
    
    info "Removed codex-hud alias from $rc_file"
}

# Kill any existing codex-hud tmux sessions
kill_sessions() {
    if command -v tmux >/dev/null 2>&1; then
        local sessions
        sessions=$(tmux list-sessions 2>/dev/null | grep "^codex-hud-" | cut -d: -f1 || true)
        
        if [[ -n "$sessions" ]]; then
            step "Killing codex-hud tmux sessions..."
            for session in $sessions; do
                tmux kill-session -t "$session" 2>/dev/null || true
                info "Killed session: $session"
            done
        fi
    fi
}

# Show backup info
show_backup_info() {
    if [[ -f "$BACKUP_FILE" ]]; then
        echo ""
        echo "Note: Your original codex alias was backed up to:"
        echo "  ${CYAN}$BACKUP_FILE${NC}"
        echo ""
        echo "To restore it, copy the alias from that file to your shell config."
    fi
}

# Main uninstall
main() {
    header "Codex HUD Uninstaller"
    
    # Detect shell
    local shell_name
    shell_name=$(detect_shell)
    step "Detected shell: $shell_name"
    
    # Get RC file
    local rc_file
    rc_file=$(get_rc_file "$shell_name")
    
    # Kill existing sessions
    kill_sessions
    
    # Remove alias
    if [[ -n "$rc_file" ]]; then
        step "Removing alias from $rc_file..."
        remove_alias "$rc_file"
    fi
    
    # Also check other common RC files
    local other_files=("$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.zshrc")
    for file in "${other_files[@]}"; do
        if [[ "$file" != "$rc_file" ]] && [[ -f "$file" ]]; then
            if grep -q "$MARKER" "$file" 2>/dev/null; then
                step "Also removing from $file..."
                remove_alias "$file"
            fi
        fi
    done
    
    header "Uninstall Complete! 🧹"
    echo "The codex-hud alias has been removed."
    echo ""
    echo "To complete the uninstall, either:"
    echo "  1. Open a new terminal, or"
    echo "  2. Run: ${CYAN}source $rc_file${NC}"
    echo ""
    echo "The 'codex' command will now use the original Codex CLI."
    
    show_backup_info
    
    echo ""
    echo "To completely remove codex-hud, you can delete this directory:"
    echo "  ${YELLOW}rm -rf $SCRIPT_DIR${NC}"
}

# Run main
main "$@"
