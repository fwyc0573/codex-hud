#!/usr/bin/env bash
# Fix ~/.codex/config.toml MCP server command format
# Codex CLI expects command as string, not array

CONFIG_FILE="$HOME/.codex/config.toml"

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Error: $CONFIG_FILE not found"
    exit 1
fi

# Create backup
cp "$CONFIG_FILE" "${CONFIG_FILE}.backup.$(date +%Y%m%d%H%M%S)"

# Read and fix the config
python3 << 'PYTHON_SCRIPT'
import re

config_path = "$HOME/.codex/config.toml".replace("$HOME", __import__("os").environ["HOME"])

with open(config_path, 'r') as f:
    content = f.read()

# Fix array-style commands to string format
# Pattern: command = ["arg1", "arg2", ...]
def fix_command(match):
    args = match.group(1)
    # Parse the array elements
    elements = re.findall(r'"([^"]*)"', args)
    # Join with spaces
    return f'command = "{" ".join(elements)}"'

# Replace array commands with string commands
fixed = re.sub(r'command\s*=\s*\[([^\]]+)\]', fix_command, content)

with open(config_path, 'w') as f:
    f.write(fixed)

print("Fixed config.toml - converted array commands to string format")
PYTHON_SCRIPT
