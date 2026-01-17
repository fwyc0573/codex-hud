# Codex HUD

Real-time statusline HUD for OpenAI Codex CLI.

> **Note**: This is a wrapper tool that runs alongside Codex CLI, inspired by [claude-hud](https://github.com/jarrodwatts/claude-hud) for Claude Code.

## Quick Start (One Command Install)

```bash
# Clone and install
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
./install.sh

# Now just type 'codex' - HUD appears automatically!
```

That's it! After installation, typing `codex` will automatically launch with the HUD display.


## Display Format

```
[gpt-5.2:medium] ░░░░░░░░░░░░ 100% left ⏱️  28m @openai
codex-hud git:(v0.5 *) !1 ?1 | 3 cfg | Appr:on-req
Tokens: 39.1K (38.6K in, 29.7K cache, 556 out) | Ctx: 100% left (8.4K/258.4K)
Dir: ...ethanfeng/Documents/GitHub/codex-hud | Session: 019bc7f3...
◑ exec_command | ✓ exec_command ×9 | (11 total)
```


## Features

### Phase 1 (Basic)
- **Model Display**: Shows current model from `~/.codex/config.toml`
- **Git Status**: Branch name and dirty state indicator
- **Project Info**: Current directory and project name
- **Session Timer**: Time since session started
- **MCP Servers**: Count of configured MCP servers
- **Approval Policy**: Current approval policy setting
- **AGENTS.md Detection**: Count of AGENTS.md files in project
- **Sandbox Mode**: Current sandbox mode (if configured)

### Phase 2 (Advanced) ✨ NEW
- **Token Usage**: Real-time token consumption with progress bar
  - Reads from session rollout files (`~/.codex/sessions/`)
  - Shows input/output token counts
  - Visual progress bar with color coding
- **Tool Activity Tracking**: Monitors tool invocations
  - Shows recent tool calls count
  - Displays total tool calls in session
  - Parses `function_call` entries from rollout logs
- **File Watching**: Event-driven updates using chokidar
  - Watches config.toml for changes
  - Watches active session rollout files
- **Session Auto-Detection**: Automatically finds active Codex sessions
  - Searches `~/.codex/sessions/` directory structure
  - Prioritizes recently modified sessions

### Phase 3 (Seamless Integration) ✨ NEW
- **Automatic tmux Installation**: Installs tmux if not present
- **Shell Alias Integration**: `codex` command automatically launches with HUD
- **Unique Sessions by Default**: Each terminal run creates a new tmux session
- **Configurable HUD Position**: Top or bottom (environment variable)
- **One-Command Install/Uninstall**: Simple setup and removal

## Requirements

- **Node.js** 18+
- **OpenAI Codex CLI** installed and in PATH
- **tmux** (auto-installed if missing)

## Installation

### Recommended: Automatic Installation

```bash
# Clone the repository
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud

# Run the installer
./install.sh
```

The installer will:
1. Install Node.js dependencies
2. Build the TypeScript project
3. Add a shell alias so `codex` → `codex-hud`
4. Prompt to install tmux if not present

See `RELEASE_NOTES_v0.5.0.md` for v0.5.0 release highlights.

### Manual Installation

```bash
# Clone or download this repository
cd codex-hud

# Install dependencies
npm install

# Build the project
npm run build

# Make the wrapper executable
chmod +x bin/codex-hud

# Add alias to your shell config (~/.bashrc or ~/.zshrc)
echo "alias codex='/path/to/codex-hud/bin/codex-hud'" >> ~/.bashrc
source ~/.bashrc
```

## Uninstallation

```bash
./uninstall.sh
```

This will:
- Remove the shell alias
- Kill any running codex-hud sessions
- Show location of backed-up original alias (if any)


### Additional Commands

```bash
# Kill existing session for current directory
codex-hud --kill

# List all codex-hud sessions
codex-hud --list

# Kill all codex-hud sessions
codex-hud --kill-all

# Show help
codex-hud --help
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CODEX_HUD_POSITION` | HUD pane position: `bottom`, `top` | `bottom` |
| `CODEX_HUD_HEIGHT` | HUD pane height in lines | `3` |
| `CODEX_HUD_NO_ATTACH` | If set, always create new session | (unset) |
| `CODEX_HUD_SESSION_MODE` | Session mode: `unique`, `shared` | `unique` |
| `CODEX_HUD_BYPASS` | If set, run original Codex without HUD | (unset) |

Example:
```bash
# Put HUD on top
CODEX_HUD_POSITION=top codex

# Taller HUD
CODEX_HUD_HEIGHT=5 codex

# Bypass HUD and run original Codex
CODEX_HUD_BYPASS=1 codex
```

## Configuration

The HUD reads configuration from `~/.codex/config.toml`.

### Supported Fields

```toml
# Model configuration
model = "gpt-5.2-codex"
model_provider = "openai"

# Approval policy
approval_policy = "on-request"

# Sandbox mode
sandbox_mode = "workspace-write"

# MCP servers
[mcp_servers]
[mcp_servers.my-server]
command = ["node", "server.js"]
enabled = true
```

## Data Sources

### Token Usage (Phase 2)
Token data is extracted from Codex session rollout files:
- Location: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- Format: JSONL with `event_msg` entries containing `token_count` events
- Fields: `input_tokens`, `output_tokens`, `cached_input_tokens`

### Tool Activity (Phase 2)
Tool invocations are tracked from rollout files:
- Type: `response_item` with `function_call` and `function_call_output`
- Tracked: Tool name, duration, success/failure status
- Display: Recent calls count and total session calls

## Architecture

```
codex-hud/
├── bin/
│   └── codex-hud              # Bash wrapper (creates tmux session)
├── src/
│   ├── index.ts               # Main entry point
│   ├── types.ts               # Type definitions
│   ├── collectors/
│   │   ├── codex-config.ts    # Parse ~/.codex/config.toml
│   │   ├── git.ts             # Git status collection
│   │   ├── project.ts         # Project info collection
│   │   ├── rollout.ts         # Parse session rollout files (Phase 2)
│   │   ├── session-finder.ts  # Find active sessions (Phase 2)
│   │   └── file-watcher.ts    # chokidar-based watchers (Phase 2)
│   └── render/
│       ├── colors.ts          # ANSI color utilities
│       ├── header.ts          # Status line rendering
│       └── index.ts           # Main renderer
├── dist/                      # Compiled JavaScript
├── package.json
└── tsconfig.json
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode (rebuild on changes)
npm run dev

# Run HUD directly (for testing)
node dist/index.js
```

## Known Limitations

1. **Token usage accuracy**: Depends on Codex session rollout format
2. **Requires tmux**: The split-pane display needs tmux
3. **Session detection delay**: Up to 5 seconds to detect new sessions

## Changelog

### v0.5.0 (Phase 3)
- Added automatic tmux installation
- Added shell alias integration for `codex`
- Added unique/shared session modes and bypass option
- Added sandbox mode display
- Added one-command install/uninstall

### v0.2.0 (Phase 2)
- Added token usage display with progress bar
- Added tool activity tracking
- Added session auto-detection
- Added file watching with chokidar
- Added rollout file parsing

### v0.1.0 (Phase 1)
- Initial release
- Basic model, git, project info display
- MCP servers and approval policy display
- tmux wrapper script

## License

MIT

## Credits

Inspired by [claude-hud](https://github.com/jarrodwatts/claude-hud) by Jarrod Watts.

Built for use with [OpenAI Codex CLI](https://github.com/openai/codex).
