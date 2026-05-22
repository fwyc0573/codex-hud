## Modification History

| Date       | Summary of Changes |
|------------|--------------------|
| 2026-05-22 | Documented Windows current-branch download, self-check, and WSL launch flow with screenshots. |
| 2026-05-22 | Switched Windows default launch policy to WSL-only and marked native PowerShell HUD as unsupported. |
| 2026-05-22 | Documented explicit Windows launch-mode flags and Bash installer dependency guidance. |
| 2026-05-21 | Documented completed Windows PowerShell, cmd, and WSL dual-entry behavior. |

<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
  <a href="./README.zh.md"><img src="https://img.shields.io/badge/lang-中文-red.svg" alt="中文"></a>
  <a href="./README.ja.md"><img src="https://img.shields.io/badge/lang-日本語-green.svg" alt="日本語"></a>
  <a href="./README.ko.md"><img src="https://img.shields.io/badge/lang-한국어-orange.svg" alt="한국어"></a>
</p>

# Codex HUD

Real-time statusline HUD for [OpenAI Codex CLI](https://github.com/openai/codex). Lightweight, zero-config, works inside tmux.

> This branch documents the Windows WSL-first build: Windows `codex` launches the WSL HUD by default, native PowerShell HUD is not a supported user launch mode, and Linux/macOS keep the existing Bash flow.

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

### Windows Current Branch (WSL Default)

This branch uses WSL as the supported Windows HUD runtime. PowerShell and cmd are launcher shells; the HUD itself runs in Ubuntu WSL with Bash and tmux.

1. Download and switch to this branch:

```powershell
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
git switch feature/windows-support-dual-entry
.\bin\codex-hud-install.ps1
```

2. Open a new PowerShell or cmd window, then check the WSL runtime:

```powershell
codex --self-check
```

![Windows WSL self-check](./doc/fig/wsl-self-check.png)

3. Run Codex HUD:

```powershell
codex
```

![Windows WSL launch](./doc/fig/windows-wsl.png)

Notes:

- `codex` launches the WSL HUD by default on Windows.
- `codex --wsl ...` explicitly requests the same WSL HUD path and strips the wrapper flag before forwarding Codex CLI args.
- Native PowerShell HUD is currently unsupported as a user launch mode; legacy native-mode requests fail fast with an unsupported-mode error.
- `codex-hud-wsl` is the explicit full-HUD command for WSL Ubuntu.
- `cmd.exe` users get managed `.cmd` shims that invoke the same PowerShell entrypoints with `ExecutionPolicy Bypass`.

`codex-hud-install.ps1` automatically:

- install Node.js LTS on Windows if needed
- reinstall `@openai/codex` globally on Windows
- ensure Ubuntu WSL is available when possible
- provision WSL with `tmux`, Node.js LTS, `npm`, and `@openai/codex`
- fail fast with exact manual WSL commands if root or passwordless `sudo` is unavailable

For Linux/macOS/Git Bash installs, `install.sh` now fails fast with exact checks and install guidance when required tools are missing. The main required checks are `command -v node`, `node --version`, `command -v npm`, `npm --version`, `command -v tmux`, and `tmux -V`.

#### Windows Default Path

```powershell
. $PROFILE.CurrentUserAllHosts
codex
codex --wsl
codex --self-check
codex-resume
```

Use `codex` when you want the normal Windows entry. It uses WSL HUD by default. Use `codex --wsl` when you want to be explicit about the WSL path. Legacy native-mode requests are intentionally rejected because native PowerShell HUD is not supported yet.

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
| `codex` | Default Windows entry: WSL HUD, then plain Windows codex fallback |
| `codex-resume` | Resume through the same Windows WSL entry |
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
codex --wsl --model gpt-5    # Explicit WSL HUD mode on Windows
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
| Windows PowerShell | Supported as launcher shell; native PowerShell HUD is unsupported |
| Windows cmd | Supported (managed `.cmd` shims) |
| Windows WSL Ubuntu | Supported (default Windows HUD path and `codex-hud-wsl` full HUD entry) |

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
| 2026-05-22 | Switch Windows default launch policy to WSL HUD only; reject legacy native PowerShell HUD requests as unsupported |
| 2026-05-22 | Add Windows launch-mode parsing experiments, a clear native-to-WSL fallback banner, and precise Bash installer dependency guidance |
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
