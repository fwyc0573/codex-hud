## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-31 | Recorded reusable architectural and operational lessons from the startup incident. |

## Production Lessons

### 1. Separate SQLite page pressure from lock claims

- Motivation: Large shared databases can make startup spend time in filesystem/page-cache work even when no SQLite lock waiter is visible.
- Expectation: RCA language remains defensible under independent replay.
- Method: Compare database/WAL sizes and process/page-I/O observations, and require explicit `SQLITE_BUSY` or lock-wait evidence for a lock diagnosis.
- Result: This incident is recorded as confirmed shared SQLite page-I/O pressure with lock contention unproven.

### 2. Isolate the high-churn log plane, preserve durable metadata

- Motivation: Per-launch logs are high-volume and compete most directly with concurrent startup/read traffic, while thread/goal/memory metadata and rollouts must remain discoverable.
- Expectation: New launches stop sharing the large log file without breaking resume.
- Method: Derive `CODEX_SQLITE_HOME` from the stable profile home and unique `SESSION_NAME`; link only `state_5.sqlite`, `goals_1.sqlite`, and `memories_1.sqlite`; leave `logs_2.sqlite` regular and local; keep `CODEX_SESSIONS_PATH` stable.
- Result: Native real-Codex probes created a regular `logs_2.sqlite` (`49,152` bytes) and resumed the historical thread with `2` turns and `0.045 s` resume time.

### 3. Treat shell environment contracts as API surface

- Motivation: A shell alias can carry provider identity through environment variables even when the visible command text is generic.
- Expectation: Legacy and explicit routes resolve through one extensible mechanism and never silently select another provider.
- Method: Declare activation, required variables, executable, prefix, shell, and command mode in `LAUNCH_PROFILE_REGISTRY`; let explicit flags take precedence; validate values before launch.
- Result: Bash `stepcode codex` resolves to StepCode and `sptecode-codex`; explicit `--stepcode` ignores stale legacy values.

### 4. Start terminal-sensitive programs only after terminal readiness

- Motivation: Codex terminal probes can be consumed by an interactive shell when a tmux client is not attached, producing an apparent pane hang.
- Expectation: The command runs as the pane process and receives a usable terminal after attach.
- Method: Use `respawn-pane`, register a `client-attached` hook, and bound the wait to `200 * 0.05 s` with a documented fail-open path.
- Result: The gate regression blocked and released in `343 ms` on the final fresh run, and lifecycle tests retained failure diagnostics and exit status `43`.

### 5. Detached-session evidence needs an explicit display boundary

- Motivation: A detached tmux session can contain both panes while the invoking shell still waits or the user sees no pane.
- Expectation: Probe reports distinguish session/pane creation from client attachment and first visible output.
- Method: Capture tmux topology, attach timing, first non-empty TUI output, and first prompt separately.
- Result: Native TUI evidence records first non-empty output at `157 ms` and first prompt at `2,989 ms`; live safety uses topology snapshots rather than a new live launch.

### 6. Fail fast before creating external lifecycle state

- Motivation: A malformed link, missing executable, or tmux query failure must not become a silent hang or a misleading empty result.
- Expectation: Users receive the original error and no partially initialized HUD session is left behind.
- Method: Validate paths and SQLite ownership before `new-session`; propagate `list_sessions()` errors; keep management commands independent from stale launch-provider validation.
- Result: The conflict matrix and dependency matrix return non-zero statuses with visible messages, `list_sessions` returns `status=1` on a simulated socket failure, and management bypass returns `list_status=0`, `help_status=0`, with `stale_profile_ignored=2`.
