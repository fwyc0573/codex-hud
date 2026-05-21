## Modification History

| Date       | Summary of Changes |
|------------|--------------------|
| 2026-05-21 | Documented completed Windows PowerShell, cmd, and WSL dual-entry behavior. |

<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
  <a href="./README.zh.md"><img src="https://img.shields.io/badge/lang-中文-red.svg" alt="中文"></a>
  <a href="./README.ja.md"><img src="https://img.shields.io/badge/lang-日本語-green.svg" alt="日本語"></a>
  <a href="./README.ko.md"><img src="https://img.shields.io/badge/lang-한국어-orange.svg" alt="한국어"></a>
</p>

# Codex HUD

Real-time statusline HUD for [OpenAI Codex CLI](https://github.com/openai/codex). Lightweight, zero-config, works inside tmux.

> This branch documents the Windows dual-entry build: native PowerShell is the default entry, WSL is the explicit full-HUD entry, and Linux/macOS keep the existing Bash flow.

> Inspired by [claude-hud](https://github.com/jarrodwatts/claude-hud) for Claude Code.

![Codex HUD — Single Session](./doc/fig/2a00eaf0-496a-4039-a0ce-87a9453df30d.png)

## Why Codex HUD?

**Q: Codex CLI already works. Why do I need a HUD?**

Because you're flying blind without one. Codex HUD gives you a persistent dashboard at the bottom of your terminal:

- **Branch, model, permissions** — at a glance, no guessing
- **Token usage (including cache)** — know exactly how much context you've burned
- **Context window fill bar** — see when you're about to hit the wall
- **MCP server status & tool calls** — watch what Codex is actually doing
- **Reasoning effort level** — see the current thinking depth

**Q: I run multiple Codex sessions. Can I monitor them all?**

Yes. Toggle to **multi-session overview** (`Ctrl+T`) and see every active session with its context usage — all in one place.

![Codex HUD — Multi-Session Overview](./doc/fig/6d0edbdd-19b5-4038-b9a3-ca5341fd39d1.png)

**Q: Do I need to set up tmux manually?**

No. Codex HUD auto-activates tmux for you. Just type `codex` and the HUD appears. If tmux isn't installed, the installer handles that too.

## Quick Start

```bash
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
./bin/codex-hud-install

# Refresh your shell, then just type:
codex
```

### Windows (PowerShell + WSL Dual Entry)

This branch adds a Windows-first install and launch flow:

- `codex` tries native PowerShell HUD first.
- If native HUD cannot start or exits too quickly, it automatically retries with `codex-hud-wsl`.
- If both HUD paths are unavailable, it prints a warning and falls back to plain native `codex`.
- `codex-hud-wsl` is the explicit full-HUD command for WSL Ubuntu.
- `cmd.exe` users get managed `.cmd` shims that invoke the same PowerShell entrypoints with `ExecutionPolicy Bypass`.

```powershell
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
.\bin\codex-hud-install.ps1

# Reload profile, then:
codex            # Default: native PowerShell HUD, then WSL HUD fallback, then plain codex
codex-hud-wsl    # Explicit: full HUD in WSL (Ubuntu + tmux)
```

`codex-hud-install.ps1` will automatically:

- install Node.js LTS on Windows if needed
- reinstall `@openai/codex` globally on Windows
- install Windows native `tmux` via `winget` if needed
- ensure Ubuntu WSL is available when possible
- provision WSL with `tmux`, Node.js LTS, `npm`, and `@openai/codex`
- fail fast with exact manual WSL commands if root or passwordless `sudo` is unavailable

#### PowerShell Default Path

```powershell
. $PROFILE.CurrentUserAllHosts
codex
codex --self-check
codex-resume
```

Use this when you want the normal Windows entry. On this branch it is the default command path after install.

#### WSL Full HUD Path

```powershell
. $PROFILE.CurrentUserAllHosts
codex-hud-wsl
codex-hud-wsl "help me debug this"
```

Use this when you want the full Bash + tmux HUD inside WSL Ubuntu.

### Management Commands

After the first install, these are available in PowerShell and cmd:

| Command | Description |
|---------|-------------|
| `codex` | Default Windows entry: native HUD, then WSL fallback, then plain codex |
| `codex-resume` | Resume through the same Windows entry chain |
| `codex-hud-wsl` | Launch full HUD mode via WSL |
| `codex-hud-sync` | Rebuild and refresh aliases for the current checkout |
| `codex-hud-upgrade` | Pull latest changes, then rebuild |
| `codex-hud-uninstall` | Remove aliases and stop HUD sessions |

## What's on the HUD?

```
[gpt-5.4 xhigh] █████░░░░ 45% │ my-project git:(main ●) │ 12m
mode: dev | 3 extensions | 2 AGENTS.md | Approval: on-req | Sandbox: ws-write
Tokens: 50.2K (in: 35.0K, cache: 5.0K, out: 15.2K) | Ctx: ████░░░░ 45% (50.2K/128K) ↻2
Dir: ~/my-project | Session: abc12345 | CLI: 0.4.2
◐ Edit: file.ts | ✓ Read ×3
```

| Line | Shows |
|------|-------|
| **Header** | Model + effort, context bar, project, git branch, session timer |
| **Environment** | Config count, work mode, MCP servers, instruction files, approval/sandbox |
| **Tokens** | Total tokens with input/cache/output breakdown, context fill, compact count |
| **Session** | Working directory, session ID, CLI version |
| **Activity** | Running tool call, recent tool history |

## Usage

```bash
codex                        # Launch with HUD
codex --model gpt-5          # Pass any Codex CLI args
codex "help me debug this"   # With prompt
codex-resume                 # Resume last session
codex-hud-wsl                # Explicit full HUD in WSL (Windows only)
```

<details>
<summary>More commands</summary>

```bash
codex-hud --kill             # Kill session for current directory
codex-hud --list             # List all HUD sessions
codex-hud --attach           # Attach to existing session
codex-hud --new-session      # Force a new session
codex-hud --self-check       # Run diagnostics
```
</details>

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_HUD_POSITION` | `bottom` | HUD pane position (`top` / `bottom`) |
| `CODEX_HUD_HEIGHT` | 1/6 terminal | HUD height in lines |
| `CODEX_HUD_MOUSE` | `1` | Enable mouse/trackpad scrolling |

<details>
<summary>All environment variables</summary>

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_HUD_HEIGHT_AUTO` | `0` | Auto-adjust height based on width |
| `CODEX_HUD_HEIGHT_MIN` | `CODEX_HUD_HEIGHT` | Min height in auto mode |
| `CODEX_HUD_HEIGHT_MAX` | `12` | Max height in auto mode |
| `CODEX_HUD_AUTO_ATTACH` | `0` | Auto-attach to latest session in same dir |
| `CODEX_HUD_ALTERNATE_SCREEN` | `0` | tmux alternate-screen for codex pane |
| `CODEX_HUD_CLEAR_SCROLLBACK` | `0` | Clear scrollback on first render |
| `CODEX_HUD_CWD` | (unset) | Override working directory |
| `CODEX_HOME` | `~/.codex` | Codex home directory |
| `CODEX_SESSIONS_PATH` | (unset) | Override sessions directory |

</details>

### config.toml

The HUD reads from `CODEX_HOME/config.toml`:

```toml
model = "gpt-5.2-codex"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[mcp_servers.my-server]
command = ["node", "server.js"]
enabled = true
```

## System Support

| Platform | Status |
|----------|--------|
| Linux | Supported |
| macOS (Apple Silicon) | Supported |
| macOS (Intel) | Testing pending |
| Windows PowerShell | Supported (default entry, native HUD first) |
| Windows cmd | Supported (managed `.cmd` shims) |
| Windows WSL Ubuntu | Supported (`codex-hud-wsl` full HUD entry) |

## Development

```bash
npm install && npm run build   # Build
npm run dev                    # Watch mode
node dist/index.js             # Run HUD directly
```

On Windows PowerShell, use `npm.cmd run build` if `npm.ps1` is blocked by ExecutionPolicy.

## Changelog

| Date | Change |
|------|--------|
| 2026-05-21 | Complete Windows dual-entry hardening: WSL temp wrappers, sudo-based WSL provisioning, cmd shims, first-run session handling, and runtime state precedence |
| 2026-04-20 | Make Windows PowerShell the default entry, add automatic WSL fallback, auto-install native tmux on install, and document Windows dual-mode usage |
| 2026-04-19 | Add Windows dual-entry support (`codex` native fallback + `codex-hud-wsl` full HUD), plus PowerShell installer/sync/upgrade/uninstall |
| 2026-04-09 | Add quick install/sync/upgrade/uninstall commands |
| 2026-04-09 | Bind HUD session to current tmux pane; display reasoning effort |
| 2026-02-09 | Keep Codex pane focused after resize; refine mouse-scroll defaults |
| 2026-02-09 | Update session attach defaults and scrollback config |

## License

MIT

## Credits

Inspired by [claude-hud](https://github.com/jarrodwatts/claude-hud) by Jarrod Watts. Built for [OpenAI Codex CLI](https://github.com/openai/codex).
