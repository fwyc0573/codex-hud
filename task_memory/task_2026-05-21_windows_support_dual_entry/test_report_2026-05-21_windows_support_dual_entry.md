## Modification History

| Date       | Summary of Changes |
|------------|--------------------|
| 2026-05-21 | Created final verification report for Windows dual-entry implementation. |

# Test Report: Windows Dual Entry Support

**Date**: 2026-05-21  
**Environment**: Windows PowerShell, Node.js v22.19.0, npm 10.9.3  
**Branch**: `feature/windows-support-dual-entry`

## Test Script Information

- Build command:

```powershell
npm.cmd run build
```

- Unit test command:

```powershell
Get-ChildItem -Path tests\unit -Filter *.mjs | ForEach-Object { node $_.FullName }
```

- Windows entrypoint test command:

```powershell
npm.cmd run test:windows
```

- Environment probe command:

```powershell
node --version
npm.cmd --version
wsl.exe --list --quiet
Get-Command bash -ErrorAction SilentlyContinue
Get-Command tmux -ErrorAction SilentlyContinue
```

## Validation Criteria

- Windows build resolves `tsc` through npm script and exits 0.
- All unit tests pass, including:
  - missing default Codex session directory first-run behavior
  - explicit invalid `CODEX_SESSIONS_PATH` fail-fast behavior
  - runtime state precedence over stale rollout/config state
  - latest pane capture permission/mode parsing
  - rollout turn context parsing and existing regression coverage
- Windows harness passes, including:
  - native unavailable fallback to WSL/plain Codex
  - explicit WSL wrapper command construction
  - WSL `/tmp` temp wrapper behavior with no repo-local `.wsltmp`
  - CLI argument quoting with spaces and single quotes
  - native attach retry and orphan session cleanup
  - WSL provisioning command with sudo/root checks and Node.js LTS setup
  - PowerShell profile block management
  - cmd shim creation, invocation, argument forwarding, and uninstall cleanup
- Real WSL e2e is attempted only when a WSL distro is installed.
- Bash/tmux integration tests are run only when `bash` and `tmux` exist in the host environment.

## Test Results

| Test Suite | Result | Actual Count / Value |
|------------|--------|----------------------|
| Build | PASS | 1/1 command exited 0 |
| Unit tests | PASS | 9/9 `.mjs` scripts passed |
| Windows harness | PASS | 1/1 npm script exited 0 |
| WSL distro probe | BLOCKED | 0 usable distros; `wsl.exe --list --quiet` exited 1 |
| Host Bash probe | BLOCKED | 0 `bash` commands found |
| Host tmux probe | BLOCKED | 0 `tmux` commands found |

## Key Metrics

| Metric | Expected | Actual | Delta / Notes |
|--------|----------|--------|---------------|
| Node.js major version | >= 18 | 22 | +4 major versions |
| npm major version | >= 9 | 10 | +1 major version |
| Build exit code | 0 | 0 | PASS |
| Unit scripts passing | 9 | 9 | 0 failures |
| Windows harness exit code | 0 | 0 | PASS |
| WSL usable distro count | >= 1 for real WSL e2e | 0 | Environment-blocked |
| Host Bash command count | >= 1 for shell integration tests | 0 | Environment-blocked |
| Host tmux command count | >= 1 for shell integration tests | 0 | Environment-blocked |

## Evidence

### Build

```text
> codex-hud@0.1.0 build
> tsc

Exit code: 0
```

### Unit Tests

```text
test-codex-path-first-run: PASS
test-environment-line-runtime-state: PASS
test-identity-line-effort: PASS
test-pane-runtime-state: PASS
test-parse-queue: PASS
test-render-clear-scrollback-once: PASS
test-rollout-offset: PASS
test-rollout-turn-context: PASS
test-session-finder-pane-binding: PASS

Exit code: 0
```

### Windows Harness

```text
> codex-hud@0.1.0 test:windows
> powershell -ExecutionPolicy Bypass -File ./tests/windows/test-powershell-entrypoints.ps1

test-powershell-entrypoints: PASS

Exit code: 0
```

### Environment-Blocked Checks

```text
node --version: v22.19.0
npm.cmd --version: 10.9.3
wsl.exe --list --quiet: exit code 1, no distro installed
Get-Command bash: no command found
Get-Command tmux: no command found
```

## Failure and Resolution Log

| Failure | Root Cause | Resolution |
|---------|------------|------------|
| `npm run build` blocked by PowerShell | `npm.ps1` blocked by ExecutionPolicy | Use `npm.cmd` on Windows and document it |
| `npm.cmd run build` failed with `tsc is not recognized` | tracked Unix-only `node_modules/.bin/tsc` shim | Removed tracked generated shims from git index and regenerated local npm shims |
| first-run HUD could throw on missing default sessions dir | `getSessionsDir()` treated default missing directory as fatal | Default missing sessions dir now returns the expected path; explicit bad override still fails |
| WSL wrapper wrote repo-local `.wsltmp` files | temp script path was derived from repo wrapper path | Wrapper now writes LF-only scripts under WSL `/tmp` and cleans them with `trap` |
| WSL provisioning hid install failures | plain `apt-get` without root/sudo handling and warning-only failure | Installer now uses root/passwordless sudo detection and throws on provisioning failure |
| cmd users lacked managed commands | installer only wrote PowerShell functions | Installer now creates managed `.cmd` shims and uninstall removes them |
| stale rollout state could hide visible native state | renderer preferred rollout session over pane runtime state | Runtime pane state now takes precedence for mode, approval, and sandbox display |

## Remaining Environment Work

- Install or enable Ubuntu WSL, then run:

```powershell
.\bin\codex-hud-install.ps1
.\bin\codex-hud-wsl.ps1 --self-check
.\bin\codex-hud-wsl.ps1 --version
.\bin\codex-hud-wsl.ps1 "hello"
```

- In an environment with Bash and tmux, run:

```bash
bash tests/integration/test-hud-resize.sh
bash tests/integration/test-management-commands.sh
bash tests/integration/test-mouse-policy.sh
bash tests/integration/test-session-attach-policy.sh
bash tests/integration/test-wrapper-main-pane-env.sh
bash tests/integration/test-wrapper-base-index-smoke.sh
bash tests/integration/test-alternate-screen-policy.sh
```
