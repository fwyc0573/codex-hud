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
INSTALL_CMD_PATH="$SCRIPT_DIR/bin/codex-hud-install"
SYNC_CMD_PATH="$SCRIPT_DIR/bin/codex-hud-sync"
UPGRADE_CMD_PATH="$SCRIPT_DIR/bin/codex-hud-upgrade"
UNINSTALL_CMD_PATH="$SCRIPT_DIR/bin/codex-hud-uninstall"
BACKUP_FILE="$HOME/.codex-hud-backup-aliases"
MARKER="# codex-hud alias"
SOURCE_MARKER="# codex-hud: load bashrc"
MODE="install"

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

print_node_guidance() {
    cat >&2 << EOF

Required checks:
  command -v node
  node --version

Install guidance:
  Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs
  macOS:         brew install node
  Windows Git Bash: run .\\bin\\codex-hud-install.ps1 from PowerShell, or install Node.js LTS from https://nodejs.org/
EOF
}

print_npm_guidance() {
    cat >&2 << EOF

Required checks:
  command -v npm
  npm --version

Install guidance:
  Reinstall Node.js LTS so npm is installed with node.
  Ubuntu/Debian: sudo apt-get install -y nodejs
  macOS:         brew install node
  Windows Git Bash: run .\\bin\\codex-hud-install.ps1 from PowerShell, or reinstall Node.js LTS from https://nodejs.org/
EOF
}

print_tmux_guidance() {
    cat >&2 << EOF

Required checks:
  command -v tmux
  tmux -V

Install guidance:
  Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y tmux
  RHEL/CentOS:   sudo dnf install -y tmux || sudo yum install -y tmux
  Arch:          sudo pacman -S tmux
  Alpine:        sudo apk add tmux
  macOS:         brew install tmux
  Windows Git Bash: run .\\bin\\codex-hud-install.ps1 from PowerShell to install tmux-windows, or install arndawg.tmux-windows with winget.
EOF
}

print_codex_guidance() {
    cat >&2 << EOF

Codex CLI guidance:
  npm install -g @openai/codex@latest
  codex --version
EOF
}

print_git_guidance() {
    cat >&2 << EOF

Required checks:
  command -v git
  git --version

Install guidance:
  Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y git
  macOS:         brew install git
  Windows Git Bash: install Git for Windows from https://git-scm.com/download/win
EOF
}

fail_missing_node() {
    echo -e "${RED}Error:${NC} Node.js 18+ is required, but node was not found in PATH." >&2
    print_node_guidance
    exit 1
}

fail_bad_node_version() {
    local version="$1"
    echo -e "${RED}Error:${NC} Node.js 18+ is required, but found ${version:-unknown}." >&2
    print_node_guidance
    exit 1
}

fail_missing_npm() {
    echo -e "${RED}Error:${NC} npm is required, but npm was not found in PATH." >&2
    print_npm_guidance
    exit 1
}

fail_missing_tmux() {
    local detail="${1:-}"
    echo -e "${RED}Error:${NC} tmux is required for Codex HUD, but tmux was not found in PATH." >&2
    if [[ -n "$detail" ]]; then
        echo "$detail" >&2
    fi
    print_tmux_guidance
    exit 1
}

fail_missing_git() {
    echo -e "${RED}Error:${NC} git is required for codex-hud upgrade, but git was not found in PATH." >&2
    print_git_guidance
    exit 1
}

fail_npm_install() {
    echo -e "${RED}Error:${NC} Failed to install Node.js dependencies with npm install." >&2
    cat >&2 << EOF

Diagnostics to run:
  cd "$SCRIPT_DIR"
  node --version
  npm --version
  npm install
EOF
    exit 1
}

fail_build_project() {
    echo -e "${RED}Error:${NC} Failed to build the TypeScript project." >&2
    cat >&2 << EOF

Diagnostics to run:
  cd "$SCRIPT_DIR"
  npm run build
  node ./node_modules/typescript/bin/tsc --pretty false
EOF
    exit 1
}

show_help() {
    cat << EOF
Codex HUD installer / sync / upgrade utility

Usage:
  ./install.sh              Install or refresh codex-hud in the current checkout
  ./install.sh --sync       Rebuild and refresh aliases for the current checkout
  ./install.sh --upgrade    Pull latest git changes, then sync
  ./install.sh --help       Show this help message

Quick command wrappers:
  ./bin/codex-hud-install
  ./bin/codex-hud-sync
  ./bin/codex-hud-upgrade
  ./bin/codex-hud-uninstall
EOF
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
        fail_missing_node
    fi
    
    local node_version
    node_version=$(node --version 2>/dev/null || true)
    if [[ ! "$node_version" =~ ^v?([0-9]+) ]]; then
        fail_bad_node_version "$node_version"
    fi

    local node_major="${BASH_REMATCH[1]}"
    if [[ "$node_major" -lt 18 ]]; then
        fail_bad_node_version "$node_version"
    fi
    info "Node.js $node_version"
    
    # Check npm
    if ! command_exists npm; then
        fail_missing_npm
    fi
    info "npm $(npm --version)"
    
    # Check tmux - offer to install if missing
    if ! command_exists tmux; then
        warn "tmux is not installed."
        if [[ ! -t 0 ]]; then
            fail_missing_tmux "Non-interactive shell detected; install tmux manually and re-run install.sh."
        fi

        echo ""
        read -p "Would you like to install tmux automatically? [Y/n] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            install_tmux
        else
            fail_missing_tmux "User declined automatic tmux installation."
        fi
    else
        info "tmux $(tmux -V)"
    fi
    
    # Check codex (optional)
    if command_exists codex; then
        info "codex CLI found"
    else
        warn "codex CLI not found in PATH. Install it before launching Codex HUD."
        print_codex_guidance
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
    local alias_names=(
        "codex"
        "codex-resume"
        "codex-hud-install"
        "codex-hud-sync"
        "codex-hud-upgrade"
        "codex-hud-uninstall"
    )
    local alias_name
    local alias_line
    for alias_name in "${alias_names[@]}"; do
        alias_line=$(grep "^alias ${alias_name}[= ]" "$rc_file" 2>/dev/null | grep -v "$MARKER" || true)
        if [[ -n "$alias_line" ]]; then
            existing_aliases+="$alias_line"$'\n'
        fi
    done
    
    if [[ -n "$existing_aliases" ]]; then
        warn "Found existing codex alias entries in $rc_file"
        echo "$existing_aliases" >> "$BACKUP_FILE"
        info "Backed up to $BACKUP_FILE"
        
        local temp_file
        temp_file=$(mktemp)
        grep -Ev "^alias (codex|codex-resume|codex-hud-install|codex-hud-sync|codex-hud-upgrade|codex-hud-uninstall)[= ]" "$rc_file" > "$temp_file" || true
        mv "$temp_file" "$rc_file"
    fi
}

write_aliases() {
    local rc_file="$1"
    local shell_name="$2"

    if [[ "$shell_name" == "fish" ]]; then
        echo "alias codex '$WRAPPER_PATH'  $MARKER" >> "$rc_file"
        echo "alias codex-resume '$WRAPPER_PATH resume'  $MARKER" >> "$rc_file"
        echo "alias codex-hud-install '$INSTALL_CMD_PATH'  $MARKER" >> "$rc_file"
        echo "alias codex-hud-sync '$SYNC_CMD_PATH'  $MARKER" >> "$rc_file"
        echo "alias codex-hud-upgrade '$UPGRADE_CMD_PATH'  $MARKER" >> "$rc_file"
        echo "alias codex-hud-uninstall '$UNINSTALL_CMD_PATH'  $MARKER" >> "$rc_file"
        return 0
    fi

    echo "alias codex='$WRAPPER_PATH'  $MARKER" >> "$rc_file"
    echo "alias codex-resume='$WRAPPER_PATH resume'  $MARKER" >> "$rc_file"
    echo "alias codex-hud-install='$INSTALL_CMD_PATH'  $MARKER" >> "$rc_file"
    echo "alias codex-hud-sync='$SYNC_CMD_PATH'  $MARKER" >> "$rc_file"
    echo "alias codex-hud-upgrade='$UPGRADE_CMD_PATH'  $MARKER" >> "$rc_file"
    echo "alias codex-hud-uninstall='$UNINSTALL_CMD_PATH'  $MARKER" >> "$rc_file"
}

# Add our alias to the RC file
add_alias() {
    local rc_file="$1"
    local shell_name="$2"
    
    # Create RC file if it doesn't exist
    if [[ ! -f "$rc_file" ]]; then
        touch "$rc_file"
    fi
    
    # Back up any user-owned aliases before we rewrite our managed block.
    if ! grep -q "$MARKER" "$rc_file" 2>/dev/null; then
        backup_existing_aliases "$rc_file"
    fi

    local temp_file
    temp_file=$(mktemp)
    grep -v "$MARKER" "$rc_file" > "$temp_file" || true
    mv "$temp_file" "$rc_file"

    echo "" >> "$rc_file"
    write_aliases "$rc_file" "$shell_name"

    info "Configured aliases in $rc_file"
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
    (cd "$SCRIPT_DIR" && npm install) || fail_npm_install
    
    step "Building TypeScript project..."
    (cd "$SCRIPT_DIR" && npm run build) || fail_build_project
    
    info "Build complete"
}

upgrade_checkout() {
    command_exists git || fail_missing_git

    (cd "$SCRIPT_DIR" && git rev-parse --is-inside-work-tree >/dev/null 2>&1) || error "Upgrade requires a git checkout: $SCRIPT_DIR"

    local worktree_status
    worktree_status=$(cd "$SCRIPT_DIR" && git status --short)
    if [[ -n "$worktree_status" ]]; then
        error "Upgrade requires a clean git worktree in $SCRIPT_DIR. Commit or stash local changes first."
    fi

    step "Pulling latest codex-hud changes..."
    (cd "$SCRIPT_DIR" && git pull --ff-only) || error "Failed to pull latest codex-hud changes"
    info "Repository updated"
}

# Make wrapper executable
setup_wrapper() {
    step "Setting up wrapper script..."
    chmod +x "$WRAPPER_PATH"
    chmod +x "$INSTALL_CMD_PATH" "$SYNC_CMD_PATH" "$UPGRADE_CMD_PATH" "$UNINSTALL_CMD_PATH"
    if [[ -f "$SCRIPT_DIR/bin/codex-hud-resize" ]]; then
        chmod +x "$SCRIPT_DIR/bin/codex-hud-resize"
    fi
    info "Wrapper is executable"
}

# Main installation
main() {
    case "$MODE" in
        install)
            header "Codex HUD Installer"
            ;;
        sync)
            header "Codex HUD Sync"
            ;;
        upgrade)
            header "Codex HUD Upgrade"
            ;;
        *)
            error "Unknown install mode: $MODE"
            ;;
    esac

    if [[ "$MODE" == "upgrade" ]]; then
        upgrade_checkout
    fi
    
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
    
    case "$MODE" in
        install)
            header "Installation Complete!"
            ;;
        sync)
            header "Sync Complete!"
            ;;
        upgrade)
            header "Upgrade Complete!"
            ;;
    esac
    echo "To start using codex-hud, either:"
    echo ""
    echo "  1. Open a new terminal, or"
    echo "  2. Run: ${CYAN}source $bash_rc${NC} (bash)"
    echo "     or: ${CYAN}source $zsh_rc${NC} (zsh)"
    echo ""
    echo "Then just type ${GREEN}codex${NC} to start Codex with the HUD!"
    echo "Or use ${GREEN}codex-resume${NC} to resume with the HUD wrapper."
    echo "Management commands: ${GREEN}codex-hud-sync${NC}, ${GREEN}codex-hud-upgrade${NC}, ${GREEN}codex-hud-uninstall${NC}"
    echo ""
    echo "Configuration options:"
    echo "  ${CYAN}CODEX_HUD_POSITION=top${NC}    - Put HUD on top"
    echo "  ${CYAN}CODEX_HUD_HEIGHT=5${NC}       - Taller HUD pane"
    echo ""
    echo "To uninstall from the repo root: ${YELLOW}./bin/codex-hud-uninstall${NC}"
}

# Parse flags first
case "${1:-}" in
    --help|-h)
        show_help
        exit 0
        ;;
    --sync)
        MODE="sync"
        shift
        ;;
    --upgrade)
        MODE="upgrade"
        shift
        ;;
    --install|"")
        MODE="install"
        [[ "${1:-}" == "--install" ]] && shift
        ;;
    *)
        error "Unknown option: $1"
        ;;
esac

# Run main
main "$@"
