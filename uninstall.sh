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

# Get zsh rc file location (respects ZDOTDIR when set)
get_zsh_rc_file() {
    if [[ -n "${ZDOTDIR:-}" ]]; then
        if [[ ! -d "$ZDOTDIR" ]]; then
            error "ZDOTDIR is set but does not exist: $ZDOTDIR"
        fi
        local rc_file="$ZDOTDIR/.zshrc"
        if [[ -e "$rc_file" ]] && [[ ! -w "$rc_file" ]]; then
            error "ZDOTDIR is set but rc file is not writable: $rc_file"
        fi
        echo "$rc_file"
        return 0
    fi
    echo "$HOME/.zshrc"
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
            get_zsh_rc_file
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
        
        # Also kill any panes running the HUD renderer
        step "Cleaning up HUD panes..."
        for session in $(tmux list-sessions -F "#{session_name}" 2>/dev/null || true); do
            # Find panes running the codex-hud node process
            for pane in $(tmux list-panes -t "$session" -F "#{pane_id}:#{pane_current_command}" 2>/dev/null || true); do
                if [[ "$pane" == *"node"* ]] || [[ "$pane" == *"codex-hud"* ]]; then
                    local pane_id="${pane%%:*}"
                    # Check if this pane is running our HUD
                    local pane_cmd
                    pane_cmd=$(tmux display-message -p -t "$pane_id" "#{pane_start_command}" 2>/dev/null || true)
                    if [[ "$pane_cmd" == *"codex-hud"* ]] || [[ "$pane_cmd" == *"dist/index.js"* ]]; then
                        tmux kill-pane -t "$pane_id" 2>/dev/null || true
                        info "Killed HUD pane: $pane_id"
                    fi
                fi
            done
        done
    fi
}

# Restore original codex alias from backup
restore_backup() {
    if [[ -f "$BACKUP_FILE" ]]; then
        step "Restoring original codex alias from backup..."
        
        local shell_name
        shell_name=$(detect_shell)
        local rc_file
        rc_file=$(get_rc_file "$shell_name")
        
        if [[ -n "$rc_file" ]] && [[ -f "$rc_file" ]]; then
            # Append the backed up aliases to the rc file
            echo "" >> "$rc_file"
            echo "# Restored codex alias from codex-hud backup" >> "$rc_file"
            cat "$BACKUP_FILE" >> "$rc_file"
            info "Restored original alias to $rc_file"
            
            # Remove the backup file after restoration
            rm -f "$BACKUP_FILE"
            info "Removed backup file: $BACKUP_FILE"
        fi
    fi
}

# Clean up any fish-specific configuration
cleanup_fish() {
    local fish_config="$HOME/.config/fish/config.fish"
    if [[ -f "$fish_config" ]]; then
        if grep -q "$MARKER" "$fish_config" 2>/dev/null; then
            step "Cleaning up fish configuration..."
            remove_alias "$fish_config"
        fi
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
    
    # Kill existing sessions first (before removing aliases)
    kill_sessions
    
    # Remove alias from main RC file
    if [[ -n "$rc_file" ]]; then
        step "Removing alias from $rc_file..."
        remove_alias "$rc_file"
    fi
    
    # Also check other common RC files
    local bash_rc="$HOME/.bashrc"
    local bash_profile="$HOME/.bash_profile"
    local zsh_rc
    zsh_rc=$(get_zsh_rc_file)
    
    local other_files=("$bash_rc" "$bash_profile" "$zsh_rc")
    for file in "${other_files[@]}"; do
        if [[ "$file" != "$rc_file" ]] && [[ -f "$file" ]]; then
            if grep -q "$MARKER" "$file" 2>/dev/null; then
                step "Also removing from $file..."
                remove_alias "$file"
            fi
        fi
    done
    
    # Clean up fish configuration if exists
    cleanup_fish
    
    # Restore original codex alias from backup
    restore_backup
    
    header "Uninstall Complete! 🧹"
    echo "The codex-hud alias has been removed."
    echo ""
    echo "To complete the uninstall, either:"
    echo "  1. Open a new terminal, or"
    echo "  2. Run: ${CYAN}source $rc_file${NC}"
    echo ""
    echo "The 'codex' command will now use the original Codex CLI."
    
    if [[ -f "$BACKUP_FILE" ]]; then
        echo ""
        echo "Note: Your original codex alias was backed up to:"
        echo "  ${CYAN}$BACKUP_FILE${NC}"
        echo ""
        echo "To restore it manually, copy the alias from that file to your shell config."
    fi
    
    echo ""
    echo "To completely remove codex-hud, you can delete this directory:"
    echo "  ${YELLOW}rm -rf $SCRIPT_DIR${NC}"
}

# Run main
main "$@"
