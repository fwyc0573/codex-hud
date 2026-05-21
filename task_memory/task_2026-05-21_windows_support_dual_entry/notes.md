## Modification History

| Date       | Summary of Changes |
|------------|--------------------|
| 2026-05-21 | Created notes from initial branch review and baseline verification. |

# Notes: Windows Dual Entry Support

## Baseline Review

- Branch: `feature/windows-support-dual-entry`.
- Upstream branch: `origin/feature/windows-support-dual-entry`.
- Worktree at review time: clean.
- Main branch delta includes Windows PowerShell scripts, WSL wrapper, runtime pane state collector, rollout parser changes, README updates, and tracked `node_modules/.bin` shim changes.
- Local `AGENTS.md` file is absent; user-provided AGENTS instructions are treated as active project rules.
- `serena` MCP tools are not available in this session, so retrieval uses `rg`, `git`, and direct file inspection.

## Baseline Verification

- `npm run build` failed on Windows PowerShell because `npm.ps1` is blocked by ExecutionPolicy.
- `npm.cmd run build` failed because `tsc` is not recognized.
- Direct TypeScript compiler command succeeded: `node node_modules/typescript/bin/tsc --pretty false`.
- Unit tests succeeded before implementation: 8 test scripts passed.
- Windows PowerShell harness succeeded before implementation.
- `wsl.exe` exists but no usable WSL distro is configured on this machine, so real WSL e2e is environment-blocked.
- Native `bash` and `tmux` commands are unavailable in the PowerShell host, so Bash integration tests are environment-blocked here unless WSL or Git Bash/tmux is installed.

## Root Causes Identified

- Windows build root cause: tracked `node_modules/.bin/tsc` and `node_modules/.bin/tsserver` are Unix shell shims without corresponding `.cmd` launchers, so `npm.cmd run build` cannot resolve `tsc`.
- First-run WSL/HUD risk: default missing `~/.codex/sessions` currently throws through `getSessionsDir()` when `HudFileWatcher` starts.
- WSL wrapper risk: `codex-hud-wsl.ps1` creates `*.wsltmp` beside repo scripts, which mutates the checkout and can fail on read-only or protected paths.
- WSL provisioning risk: installer runs `apt-get` without root/sudo handling and only warns on failure, which hides a broken WSL setup.
- Native runtime state risk: pane runtime state is collected only when rollout session is missing, so stale rollout data can override visible current mode/permission state.
- cmd support gap: installer creates PowerShell functions but no direct cmd shims for `cmd.exe` users.

## Implementation Notes

- Use TDD for behavior changes.
- Keep edits scoped to Windows entrypoints, path/session handling, runtime state, tests, and README.
- Do not add broad fallback logic. Expected initialization state is allowed; explicit invalid configuration remains fail-fast.
