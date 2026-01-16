# Codex HUD v0.5.0 Release Notes

**Release Date:** January 17, 2026

## Overview

Codex HUD is a real-time statusline HUD (Heads-Up Display) for OpenAI Codex CLI, providing a tmux-based split-pane interface that displays live status information during Codex sessions.

> Inspired by [claude-hud](https://github.com/jarrodwatts/claude-hud) for Claude Code.

---

## Features

### Display Features

| Feature | Description |
|---------|-------------|
| **Model Display** | Shows current model from `~/.codex/config.toml` |
| **Git Status** | Branch name, dirty state indicator, ahead/behind counts |
| **Project Info** | Current directory and project name |
| **Session Timer** | Time elapsed since session started |
| **MCP Servers** | Count of configured MCP servers |
| **Approval Policy** | Current approval policy setting |
| **AGENTS.md Detection** | Count of AGENTS.md files in project |
| **Token Usage** | Real-time token consumption with visual progress bar |
| **Tool Activity** | Recent tool calls count and total session calls |
| **Sandbox Mode** | Current sandbox mode (if configured) |

### Core Capabilities

- **Session Auto-Detection**: Automatically finds active Codex sessions in `~/.codex/sessions/`
- **File Watching**: Event-driven updates using chokidar (watches config.toml and rollout files)
- **Automatic tmux Installation**: Installs tmux if not present (supports macOS, Debian, RHEL, Arch, Alpine)
- **Shell Alias Integration**: `codex` command automatically launches with HUD
- **Unique Sessions by Default**: Each terminal run creates a new tmux session
- **Configurable HUD Position**: Top or bottom placement
- **One-Command Install/Uninstall**: Simple setup and removal

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CODEX_HUD_POSITION` | HUD pane position: `bottom`, `top` | `bottom` |
| `CODEX_HUD_HEIGHT` | HUD pane height in lines | `3` |
| `CODEX_HUD_NO_ATTACH` | If set, always create new session | (unset) |
| `CODEX_HUD_SESSION_MODE` | Session mode: `unique`, `shared` | `unique` |
| `CODEX_HUD_BYPASS` | If set, run original Codex without HUD | (unset) |

---

## Installation

### Quick Install

```bash
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
./install.sh
```

---

## Display Format

```
[gpt-5.2:medium] ░░░░░░░░░░░░ 100% left ⏱️  28m @openai
codex-hud git:(v0.5 *) !1 ?1 | 3 cfg | Appr:on-req
Tokens: 39.1K (38.6K in, 29.7K cache, 556 out) | Ctx: 100% left (8.4K/258.4K)
Dir: ...ethanfeng/Documents/GitHub/codex-hud | Session: 019bc7f3...
◑ exec_command | ✓ exec_command ×9 | (11 total)
```

---

## Getting Started

1. **Install**: Run the installation script to set up Codex HUD
2. **Configure**: Set environment variables as needed (see Environment Variables section)
3. **Use**: Run `codex` command as usual; HUD will automatically display
