#!/usr/bin/env bash
#
# Test script to verify find_real_codex function
#

WRAPPER_PATH="/Users/yichengfeng/codex-hud/bin/codex-hud"

find_real_codex() {
    local codex_path=""
    
    # Method 1: Check common installation paths directly
    local common_paths=(
        "/opt/homebrew/bin/codex"
        "/usr/local/bin/codex"
        "$HOME/.local/bin/codex"
        "/usr/bin/codex"
    )
    
    for path in "${common_paths[@]}"; do
        if [[ -x "$path" ]] && [[ "$path" != "$WRAPPER_PATH" ]]; then
            # Verify it's the real codex CLI (not another wrapper)
            if "$path" --version 2>/dev/null | grep -q "codex-cli"; then
                echo "$path"
                return 0
            fi
        fi
    done
    
    # Method 2: Search PATH entries, skipping our own directory
    local IFS=':'
    for dir in $PATH; do
        local candidate="$dir/codex"
        if [[ -x "$candidate" ]] && [[ "$candidate" != "$WRAPPER_PATH" ]] && [[ "$dir" != "$(dirname "$WRAPPER_PATH")" ]]; then
            # Verify it's the real codex CLI
            if "$candidate" --version 2>/dev/null | grep -q "codex-cli"; then
                echo "$candidate"
                return 0
            fi
        fi
    done
    
    return 1
}

echo "Testing find_real_codex function..."
result=$(find_real_codex)
if [[ -n "$result" ]]; then
    echo "✓ Found real codex at: $result"
    echo "  Version: $($result --version)"
else
    echo "✗ Failed to find real codex"
    exit 1
fi
