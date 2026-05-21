## Modification History

| Date       | Summary of Changes |
|------------|--------------------|
| 2026-05-21 | Created issue tracker for Windows dual-entry implementation. |
| 2026-05-21 | Updated issue statuses after focused fixes. |
| 2026-05-21 | Marked local issues fixed after available regression verification. |

# Issues: Windows Dual Entry Support

## Open Issues

### I-001: Windows npm build fails because tracked shims are Unix-only

- Root cause: `node_modules/.bin/tsc` and `node_modules/.bin/tsserver` are tracked shell scripts without Windows `.cmd` shims.
- Impact: `npm.cmd run build` fails with `tsc is not recognized`.
- Planned fix: Remove these generated shims from version control and rely on `npm install`.
- Status: Fixed and verified by `npm.cmd run build`.

### I-002: HUD crashes when default sessions directory does not exist

- Root cause: `getSessionsDir()` throws for default missing `~/.codex/sessions`, and watcher construction calls it during startup.
- Impact: First WSL/native launch can exit before Codex creates rollout files.
- Planned fix: Distinguish default initialization state from invalid explicit override.
- Status: Fixed and verified by `test-codex-path-first-run`.

### I-003: WSL wrapper writes temporary scripts into the repo checkout

- Root cause: `codex-hud-wsl.ps1` writes `*.wsltmp` beside `bin/codex-hud`.
- Impact: Mutates tracked workspace and can fail on read-only checkouts.
- Planned fix: Use WSL `/tmp` with cleanup trap and keep repo path as `CODEX_HUD_SCRIPT_DIR`.
- Status: Fixed and verified by Windows wrapper harness.

### I-004: WSL provisioning hides permission failures

- Root cause: installer runs `apt-get` without root/sudo detection and only warns if provisioning fails.
- Impact: Install appears to continue while WSL HUD remains unusable.
- Planned fix: Use root/sudo when available; otherwise fail fast with manual commands.
- Status: Fixed and verified by fake WSL provisioning harness.

### I-005: cmd.exe has no direct managed entrypoints

- Root cause: installer only writes PowerShell profile functions.
- Impact: cmd users cannot reliably invoke the managed dual-entry commands.
- Planned fix: Generate managed `.cmd` shims and add their directory to User PATH.
- Status: Fixed and verified by cmd shim harness.

### I-006: Visible native runtime state can be hidden by stale rollout data

- Root cause: pane runtime collector is only used when no rollout session exists.
- Impact: Mode, approval policy, and sandbox can lag behind what Codex UI shows.
- Planned fix: Collect runtime state on Windows every refresh and prefer it for UI state fields.
- Status: Fixed and verified by runtime state unit tests.
