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
UPDATE_HELPER_PATH="$SCRIPT_DIR/bin/codex-hud-update.mjs"
BACKUP_FILE="$HOME/.codex-hud-backup-aliases"
MARKER="# codex-hud alias"
SOURCE_MARKER="# codex-hud: load bashrc"
MODE="install"
UPGRADE_TRANSACTION_ROOT=""
UPGRADE_WORKTREE=""
UPGRADE_BACKUP_ROOT=""
UPGRADE_ORIGINAL_HEAD=""
UPGRADE_ARTIFACTS_ACTIVATED="0"
UPGRADE_NEW_NODE_MODULES="0"
UPGRADE_NEW_DIST="0"
UPGRADE_HAD_NODE_MODULES="0"
UPGRADE_HAD_DIST="0"

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

show_help() {
    cat << EOF
Codex HUD installer / sync / upgrade utility

Usage:
  ./install.sh              Install or refresh codex-hud in the current checkout
  ./install.sh --sync       Rebuild and refresh aliases for the current checkout
  ./install.sh --upgrade    Build the fetched update in staging, then fast-forward and sync
  ./install.sh --help       Show this help message

Quick command wrappers:
  ./bin/codex-hud-install
  ./bin/codex-hud-sync
  ./bin/codex-hud-upgrade
  ./bin/codex-hud-uninstall

Launch aliases (bash/zsh):
  codex, cx, codex-resume
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
    local alias_names=(
        "codex"
        "cx"
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
        grep -Ev "^alias (codex|cx|codex-resume|codex-hud-install|codex-hud-sync|codex-hud-upgrade|codex-hud-uninstall)[= ]" "$rc_file" > "$temp_file" || true
        mv "$temp_file" "$rc_file"
    fi
}

write_aliases() {
    local rc_file="$1"
    local shell_name="$2"

    if [[ "$shell_name" == "fish" ]]; then
        echo "alias codex '$WRAPPER_PATH'  $MARKER" >> "$rc_file"
        echo "alias cx '$WRAPPER_PATH'  $MARKER" >> "$rc_file"
        echo "alias codex-resume '$WRAPPER_PATH resume'  $MARKER" >> "$rc_file"
        echo "alias codex-hud-install '$INSTALL_CMD_PATH'  $MARKER" >> "$rc_file"
        echo "alias codex-hud-sync '$SYNC_CMD_PATH'  $MARKER" >> "$rc_file"
        echo "alias codex-hud-upgrade '$UPGRADE_CMD_PATH'  $MARKER" >> "$rc_file"
        echo "alias codex-hud-uninstall '$UNINSTALL_CMD_PATH'  $MARKER" >> "$rc_file"
        return 0
    fi

    echo "alias codex='$WRAPPER_PATH'  $MARKER" >> "$rc_file"
    echo "alias cx='$WRAPPER_PATH'  $MARKER" >> "$rc_file"
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

# Build the project at an explicit checkout path.
build_project_at() {
    local project_dir="$1"
    step "Installing Node.js dependencies..."
    (cd "$project_dir" && npm install) || return 1
    
    step "Building TypeScript project..."
    (cd "$project_dir" && npm run build) || return 2
    
    info "Build complete"
}

build_project() {
    local status=0
    build_project_at "$SCRIPT_DIR" || status=$?
    case "$status" in
        0) return 0 ;;
        1) error "Failed to install dependencies" ;;
        2) error "Failed to build project" ;;
        *) error "Unexpected build failure" ;;
    esac
}

rollback_upgrade_artifacts() {
    if [[ "$UPGRADE_ARTIFACTS_ACTIVATED" == "1" ]]; then
        return 0
    fi
    if [[ "$UPGRADE_NEW_NODE_MODULES" == "1" && -e "$SCRIPT_DIR/node_modules" ]]; then
        rm -rf "$SCRIPT_DIR/node_modules"
    fi
    if [[ "$UPGRADE_HAD_NODE_MODULES" == "1" && -e "$UPGRADE_BACKUP_ROOT/node_modules" ]]; then
        mv "$UPGRADE_BACKUP_ROOT/node_modules" "$SCRIPT_DIR/node_modules"
    fi
    if [[ "$UPGRADE_NEW_DIST" == "1" && -e "$SCRIPT_DIR/dist" ]]; then
        rm -rf "$SCRIPT_DIR/dist"
    fi
    if [[ "$UPGRADE_HAD_DIST" == "1" && -e "$UPGRADE_BACKUP_ROOT/dist" ]]; then
        mv "$UPGRADE_BACKUP_ROOT/dist" "$SCRIPT_DIR/dist"
    fi
    UPGRADE_NEW_NODE_MODULES="0"
    UPGRADE_NEW_DIST="0"
}

cleanup_upgrade_transaction() {
    if [[ -z "$UPGRADE_TRANSACTION_ROOT" ]]; then
        return 0
    fi
    rollback_upgrade_artifacts || true
    if [[ -n "$UPGRADE_WORKTREE" ]]; then
        git -C "$SCRIPT_DIR" worktree remove --force "$UPGRADE_WORKTREE" >/dev/null 2>&1 || true
    fi
    rm -rf "$UPGRADE_TRANSACTION_ROOT"
    UPGRADE_TRANSACTION_ROOT=""
    UPGRADE_WORKTREE=""
    UPGRADE_BACKUP_ROOT=""
}

stage_upgrade_artifacts() {
    if [[ ! -d "$UPGRADE_WORKTREE/node_modules" || ! -d "$UPGRADE_WORKTREE/dist" ]]; then
        return 1
    fi

    mkdir -p "$UPGRADE_BACKUP_ROOT"
    if [[ -e "$SCRIPT_DIR/node_modules" ]]; then
        mv "$SCRIPT_DIR/node_modules" "$UPGRADE_BACKUP_ROOT/node_modules" || return 1
        UPGRADE_HAD_NODE_MODULES="1"
    fi
    if ! mv "$UPGRADE_WORKTREE/node_modules" "$SCRIPT_DIR/node_modules"; then
        rollback_upgrade_artifacts
        return 1
    fi
    UPGRADE_NEW_NODE_MODULES="1"

    if [[ -e "$SCRIPT_DIR/dist" ]]; then
        if ! mv "$SCRIPT_DIR/dist" "$UPGRADE_BACKUP_ROOT/dist"; then
            rollback_upgrade_artifacts
            return 1
        fi
        UPGRADE_HAD_DIST="1"
    fi
    if ! mv "$UPGRADE_WORKTREE/dist" "$SCRIPT_DIR/dist"; then
        rollback_upgrade_artifacts
        return 1
    fi
    UPGRADE_NEW_DIST="1"
}

upgrade_checkout_transactionally() {
    command_exists git || error "git is required for codex-hud upgrade."

    (cd "$SCRIPT_DIR" && git rev-parse --is-inside-work-tree >/dev/null 2>&1) || error "Upgrade requires a git checkout: $SCRIPT_DIR"

    local worktree_status
    worktree_status=$(cd "$SCRIPT_DIR" && git status --short)
    if [[ -n "$worktree_status" ]]; then
        error "Upgrade requires a clean git worktree in $SCRIPT_DIR. Commit or stash local changes first."
    fi

    local branch
    branch=$(git -C "$SCRIPT_DIR" symbolic-ref --quiet --short HEAD) || error "Upgrade requires a normal branch; detached HEAD is not supported."
    local upstream
    upstream=$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}') || error "Upgrade requires an upstream branch."
    local default_ref
    default_ref=$(git -C "$SCRIPT_DIR" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
    local default_branch="main"
    if [[ "$default_ref" == origin/* ]]; then
        default_branch="${default_ref#origin/}"
    fi
    if [[ "$branch" != "$default_branch" || "$upstream" != "origin/$default_branch" ]]; then
        error "Upgrade requires $default_branch tracking origin/$default_branch."
    fi

    UPGRADE_ORIGINAL_HEAD=$(git -C "$SCRIPT_DIR" rev-parse HEAD)
    step "Fetching the latest codex-hud target..."
    git -C "$SCRIPT_DIR" fetch --tags origin "$default_branch" || error "Failed to fetch origin/$default_branch"
    local target_commit
    target_commit=$(git -C "$SCRIPT_DIR" rev-parse "origin/$default_branch") || error "Unable to resolve origin/$default_branch"
    git -C "$SCRIPT_DIR" merge-base --is-ancestor "$UPGRADE_ORIGINAL_HEAD" "$target_commit" \
        || error "The fetched target is not a fast-forward of the active checkout."

    local checkout_parent
    checkout_parent=$(dirname "$SCRIPT_DIR")
    UPGRADE_TRANSACTION_ROOT=$(mktemp -d "$checkout_parent/.codex-hud-update-XXXXXX") \
        || error "Unable to create the upgrade staging directory."
    UPGRADE_WORKTREE="$UPGRADE_TRANSACTION_ROOT/candidate"
    UPGRADE_BACKUP_ROOT="$UPGRADE_TRANSACTION_ROOT/backup"
    trap cleanup_upgrade_transaction EXIT

    step "Creating an isolated upgrade worktree..."
    git -C "$SCRIPT_DIR" worktree add --detach "$UPGRADE_WORKTREE" "$target_commit" >/dev/null \
        || error "Failed to create the isolated upgrade worktree."

    local build_status=0
    build_project_at "$UPGRADE_WORKTREE" || build_status=$?
    case "$build_status" in
        0) ;;
        1) error "Failed to install dependencies in the isolated upgrade worktree; active checkout was not changed." ;;
        2) error "Failed to build the isolated upgrade worktree; active checkout was not changed." ;;
        *) error "Unexpected isolated build failure; active checkout was not changed." ;;
    esac

    if [[ "$(git -C "$SCRIPT_DIR" rev-parse HEAD)" != "$UPGRADE_ORIGINAL_HEAD" ]]; then
        error "Active checkout HEAD changed during staging; upgrade aborted."
    fi
    if [[ -n "$(git -C "$SCRIPT_DIR" status --short)" ]]; then
        error "Active checkout changed during staging; upgrade aborted."
    fi
    if [[ "$(git -C "$SCRIPT_DIR" symbolic-ref --quiet --short HEAD)" != "$branch" ]]; then
        error "Active checkout branch changed during staging; upgrade aborted."
    fi
    if [[ "$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')" != "$upstream" ]]; then
        error "Active checkout upstream changed during staging; upgrade aborted."
    fi

    step "Activating the verified build..."
    stage_upgrade_artifacts || error "Failed to stage verified runtime artifacts; active checkout was not changed."
    if ! git -C "$SCRIPT_DIR" merge --ff-only "$target_commit"; then
        rollback_upgrade_artifacts
        error "Failed to fast-forward the active checkout; runtime artifacts were restored."
    fi
    UPGRADE_ARTIFACTS_ACTIVATED="1"
    info "Repository updated"
    cleanup_upgrade_transaction
    trap - EXIT
}

# Make wrapper executable
setup_wrapper() {
    step "Setting up wrapper script..."
    chmod +x "$WRAPPER_PATH"
    chmod +x "$INSTALL_CMD_PATH" "$SYNC_CMD_PATH" "$UPGRADE_CMD_PATH" "$UNINSTALL_CMD_PATH"
    chmod +x "$UPDATE_HELPER_PATH"
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

    # Check dependencies
    check_dependencies

    if [[ "$MODE" == "upgrade" ]]; then
        upgrade_checkout_transactionally
    else
        # Build the active checkout for install and sync modes.
        build_project
    fi
    
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

    if [[ "$shell_name" == "fish" ]]; then
        local fish_rc="$HOME/.config/fish/config.fish"
        mkdir -p "$(dirname "$fish_rc")"
        step "Configuring aliases in $fish_rc..."
        add_alias "$fish_rc" "fish"
    fi
    
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
    echo "Then just type ${GREEN}codex${NC} or ${GREEN}cx${NC} to start Codex with the HUD!"
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
