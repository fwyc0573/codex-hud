#!/usr/bin/env bash
#
# install.sh - Install codex-hud with automatic shell alias configuration
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
WRAPPER_PATH="$SCRIPT_DIR/bin/codex-hud"
BACKUP_FILE="$HOME/.codex-hud-backup-aliases"
MARKER="# codex-hud alias"

# Print functions
error() { echo -e "${RED}Error:${NC} $1" >&2; exit 1; }
warn() { echo -e "${YELLOW}Warning:${NC} $1" >&2; }
info() { echo -e "${GREEN}✓${NC} $1"; }
step() { echo -e "${BLUE}==>${NC} $1"; }
header() { echo -e "\n${BOLD}${CYAN}$1${NC}\n"; }

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Detect OS for package manager
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ -f /etc/debian_version ]]; then
        echo "debian"
    elif [[ -f /etc/redhat-release ]]; then
        echo "redhat"
    elif [[ -f /etc/arch-release ]]; then
        echo "arch"
    elif [[ -f /etc/alpine-release ]]; then
        echo "alpine"
    else
        echo "unknown"
    fi
}

# Install tmux automatically
install_tmux() {
    local os
    os=$(detect_os)
    
    step "Installing tmux..."
    
    case "$os" in
        macos)
            if command_exists brew; then
                brew install tmux
            else
                error "Homebrew not found. Please install Homebrew first: https://brew.sh"
            fi
            ;;
        debian)
            if command_exists sudo; then
                sudo apt-get update && sudo apt-get install -y tmux
            else
                apt-get update && apt-get install -y tmux
            fi
            ;;
        redhat)
            if command_exists sudo; then
                sudo yum install -y tmux || sudo dnf install -y tmux
            else
                yum install -y tmux || dnf install -y tmux
            fi
            ;;
        arch)
            if command_exists sudo; then
                sudo pacman -S --noconfirm tmux
            else
                pacman -S --noconfirm tmux
            fi
            ;;
        alpine)
            if command_exists sudo; then
                sudo apk add tmux
            else
                apk add tmux
            fi
            ;;
        *)
            error "Could not detect OS for automatic tmux installation.

Please install tmux manually:
  Linux (Debian/Ubuntu): sudo apt install tmux
  Linux (RHEL/CentOS):   sudo yum install tmux
  Linux (Arch):          sudo pacman -S tmux
  macOS:                 brew install tmux"
            ;;
    esac
    
    # Verify installation
    if command_exists tmux; then
        info "tmux installed successfully!"
    else
        error "tmux installation failed. Please install manually."
    fi
}

# Check and install dependencies
check_dependencies() {
    step "Checking dependencies..."
    
    # Check Node.js
    if ! command_exists node; then
        error "Node.js is required but not installed.
        
Install Node.js 18+ from: https://nodejs.org/"
    fi
    
    local node_version
    node_version=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ "$node_version" -lt 18 ]]; then
        error "Node.js 18+ is required (found v$node_version)"
    fi
    info "Node.js $(node --version)"
    
    # Check npm
    if ! command_exists npm; then
        error "npm is required but not installed."
    fi
    info "npm $(npm --version)"
    
    # Check tmux - offer to install if missing
    if ! command_exists tmux; then
        warn "tmux is not installed."
        echo ""
        read -p "Would you like to install tmux automatically? [Y/n] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            install_tmux
        else
            warn "tmux is required for the HUD display. You can install it later."
        fi
    else
        info "tmux $(tmux -V)"
    fi
    
    # Check codex (optional)
    if command_exists codex; then
        info "codex CLI found"
    else
        warn "codex CLI not found in PATH. Install from: https://github.com/openai/codex"
    fi
}

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

# Backup existing codex alias if present
backup_existing_alias() {
    local rc_file="$1"
    
    if [[ ! -f "$rc_file" ]]; then
        return 0
    fi
    
    # Check for existing codex alias (not ours)
    local existing_alias
    existing_alias=$(grep "^alias codex=" "$rc_file" 2>/dev/null | grep -v "$MARKER" || true)
    
    if [[ -n "$existing_alias" ]]; then
        warn "Found existing 'codex' alias in $rc_file"
        echo "$existing_alias" >> "$BACKUP_FILE"
        info "Backed up to $BACKUP_FILE"
        
        # Remove the old alias
        local temp_file
        temp_file=$(mktemp)
        grep -v "^alias codex=" "$rc_file" > "$temp_file" || true
        mv "$temp_file" "$rc_file"
    fi
}

# Add our alias to the RC file
add_alias() {
    local rc_file="$1"
    local shell_name="$2"
    
    # Create RC file if it doesn't exist
    if [[ ! -f "$rc_file" ]]; then
        touch "$rc_file"
    fi
    
    # Check if our alias already exists
    if grep -q "$MARKER" "$rc_file" 2>/dev/null; then
        info "Alias already configured in $rc_file"
        return 0
    fi
    
    # Backup existing alias
    backup_existing_alias "$rc_file"
    
    # Add our alias
    echo "" >> "$rc_file"
    
    if [[ "$shell_name" == "fish" ]]; then
        # Fish uses different alias syntax
        echo "alias codex '$WRAPPER_PATH'  $MARKER" >> "$rc_file"
    else
        # Bash/Zsh syntax
        echo "alias codex='$WRAPPER_PATH'  $MARKER" >> "$rc_file"
    fi
    
    info "Added alias to $rc_file"
}

# Build the project
build_project() {
    step "Installing Node.js dependencies..."
    (cd "$SCRIPT_DIR" && npm install) || error "Failed to install dependencies"
    
    step "Building TypeScript project..."
    (cd "$SCRIPT_DIR" && npm run build) || error "Failed to build project"
    
    info "Build complete"
}

# Make wrapper executable
setup_wrapper() {
    step "Setting up wrapper script..."
    chmod +x "$WRAPPER_PATH"
    info "Wrapper is executable"
}

# Main installation
main() {
    header "Codex HUD Installer"
    
    # Check dependencies
    check_dependencies
    
    # Build project
    build_project
    
    # Setup wrapper
    setup_wrapper
    
    # Detect shell and configure alias
    local shell_name
    shell_name=$(detect_shell)
    step "Detected shell: $shell_name"
    
    local rc_file
    rc_file=$(get_rc_file "$shell_name")
    
    if [[ -z "$rc_file" ]]; then
        warn "Unknown shell: $shell_name"
        warn "Please add this alias to your shell config manually:"
        echo ""
        echo "  alias codex='$WRAPPER_PATH'"
        echo ""
    else
        step "Configuring alias in $rc_file..."
        add_alias "$rc_file" "$shell_name"
    fi
    
    header "Installation Complete! 🎉"
    echo "To start using codex-hud, either:"
    echo ""
    echo "  1. Open a new terminal, or"
    echo "  2. Run: ${CYAN}source $rc_file${NC}"
    echo ""
    echo "Then just type ${GREEN}codex${NC} to start Codex with the HUD!"
    echo ""
    echo "Configuration options:"
    echo "  ${CYAN}CODEX_HUD_POSITION=top${NC}    - Put HUD on top"
    echo "  ${CYAN}CODEX_HUD_HEIGHT=5${NC}       - Taller HUD pane"
    echo "  ${CYAN}CODEX_HUD_SESSION_MODE=shared${NC} - Reuse session per directory"
    echo "  ${CYAN}CODEX_HUD_NO_ATTACH=1${NC}    - Always create a new session"
    echo "  ${CYAN}CODEX_HUD_BYPASS=1 codex${NC} - Run original codex without HUD"
    echo ""
    echo "To uninstall: ${YELLOW}./uninstall.sh${NC}"
}

# Run main
main "$@"
