# Product Overview

Codex HUD is a real-time statusline HUD (Heads-Up Display) for OpenAI Codex CLI. It provides a tmux-based split-pane interface that displays live status information while using Codex CLI.

## Core Purpose

- Display real-time status information alongside Codex CLI sessions
- Monitor token usage, tool activity, and session progress
- Show git status, project info, and configuration details

## Key Features

- **Model Display**: Current model from `~/.codex/config.toml`
- **Git Status**: Branch name, dirty state, ahead/behind counts
- **Token Usage**: Real-time consumption with visual progress bar
- **Tool Activity**: Monitors and displays tool invocations
- **Session Auto-Detection**: Finds active Codex sessions in `~/.codex/sessions/`
- **File Watching**: Event-driven updates using chokidar

## Target Users

Developers using OpenAI Codex CLI who want visibility into their AI coding sessions.

## Inspiration

Inspired by [claude-hud](https://github.com/jarrodwatts/claude-hud) for Claude Code.
