#!/usr/bin/env bash
#
# install.sh - Install codex-hud with automatic shell alias configuration
#

set -e

# Colors
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
NC=$'\033[0m'

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER_PATH="$SCRIPT_DIR/bin/codex-hud"
BACKUP_FILE="$HOME/.codex-hud-backup-aliases"
MARKER="# codex-hud alias"
SOURCE_MARKER="# codex-hud: load bashrc"

# Print functions
error() { echo -e "${RED}Error:${NC} $1" >&2; exit 1; }
warn() { echo -e "${YELLOW}Warning:${NC} $1" >&2; }
info() { echo -e "${GREEN}[OK]${NC} $1"; }
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
            echo "$HOME/.bashrc"
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

# Backup existing codex aliases if present
backup_existing_aliases() {
    local rc_file="$1"
    
    if [[ ! -f "$rc_file" ]]; then
        return 0
    fi
    
    local existing_aliases=""
    local codex_alias
    local resume_alias
    codex_alias=$(grep "^alias codex=" "$rc_file" 2>/dev/null | grep -v "$MARKER" || true)
    resume_alias=$(grep "^alias codex-resume=" "$rc_file" 2>/dev/null | grep -v "$MARKER" || true)
    
    if [[ -n "$codex_alias" ]]; then
        existing_aliases+="$codex_alias"$'\n'
    fi
    if [[ -n "$resume_alias" ]]; then
        existing_aliases+="$resume_alias"$'\n'
    fi
    
    if [[ -n "$existing_aliases" ]]; then
        warn "Found existing codex alias entries in $rc_file"
        echo "$existing_aliases" >> "$BACKUP_FILE"
        info "Backed up to $BACKUP_FILE"
        
        local temp_file
        temp_file=$(mktemp)
        grep -v "^alias codex=" "$rc_file" | grep -v "^alias codex-resume=" > "$temp_file" || true
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
    
    # Backup existing aliases
    backup_existing_aliases "$rc_file"
    
    # Add our alias
    echo "" >> "$rc_file"
    
    if [[ "$shell_name" == "fish" ]]; then
        # Fish uses different alias syntax
        echo "alias codex '$WRAPPER_PATH'  $MARKER" >> "$rc_file"
        echo "alias codex-resume '$WRAPPER_PATH resume'  $MARKER" >> "$rc_file"
    else
        # Bash/Zsh syntax
        echo "alias codex='$WRAPPER_PATH'  $MARKER" >> "$rc_file"
        echo "alias codex-resume='$WRAPPER_PATH resume'  $MARKER" >> "$rc_file"
    fi
    
    info "Added alias to $rc_file"
}

# Ensure bash login shells load ~/.bashrc
ensure_bashrc_sourced() {
    local bash_profile="$HOME/.bash_profile"
    local bashrc="$HOME/.bashrc"

    if [[ ! -f "$bash_profile" ]]; then
        touch "$bash_profile"
    fi

    if grep -q "$SOURCE_MARKER" "$bash_profile" 2>/dev/null; then
        return 0
    fi

    echo "" >> "$bash_profile"
    echo "$SOURCE_MARKER" >> "$bash_profile"
    echo "if [ -f \"$bashrc\" ]; then" >> "$bash_profile"
    echo "  . \"$bashrc\"" >> "$bash_profile"
    echo "fi" >> "$bash_profile"
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
    if [[ -f "$SCRIPT_DIR/bin/codex-hud-resize" ]]; then
        chmod +x "$SCRIPT_DIR/bin/codex-hud-resize"
    fi
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
    
    # Detect shell and configure aliases for bash and zsh
    local shell_name
    shell_name=$(detect_shell)
    step "Detected shell: $shell_name"
    
    local bash_rc="$HOME/.bashrc"
    local bash_profile="$HOME/.bash_profile"
    local zsh_rc
    zsh_rc=$(get_zsh_rc_file)
    
    step "Configuring aliases in $bash_rc..."
    add_alias "$bash_rc" "bash"

    step "Ensuring bash login shells load $bash_rc..."
    ensure_bashrc_sourced

    if [[ -f "$bash_profile" ]]; then
        step "Configuring aliases in $bash_profile..."
        add_alias "$bash_profile" "bash"
    fi
    
    step "Configuring aliases in $zsh_rc..."
    add_alias "$zsh_rc" "zsh"
    
    header "Installation Complete!"
    echo "To start using codex-hud, either:"
    echo ""
    echo "  1. Open a new terminal, or"
    echo "  2. Run: ${CYAN}source $bash_rc${NC} (bash)"
    echo "     or: ${CYAN}source $zsh_rc${NC} (zsh)"
    echo ""
    echo "Then just type ${GREEN}codex${NC} to start Codex with the HUD!"
    echo "Or use ${GREEN}codex-resume${NC} to resume with the HUD wrapper."
    echo ""
    echo "Configuration options:"
    echo "  ${CYAN}CODEX_HUD_POSITION=top${NC}    - Put HUD on top"
    echo "  ${CYAN}CODEX_HUD_HEIGHT=5${NC}       - Taller HUD pane"
    echo ""
    echo "To uninstall: ${YELLOW}./uninstall.sh${NC}"
}

# Run main
main "$@"
