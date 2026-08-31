## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-31 | Closed the startup RCA ledger, classified both supplied hypotheses, and recorded residual management risks. |

### Modification Record

- Motivation: Keep every observed failure, hypothesis status, root-cause boundary, and deferred risk in one auditable ledger.
- Expectation: A reviewer can distinguish confirmed facts from inference and can see why each residual remains outside this fix.
- Method: Added measured SQLite/file/process evidence, source-confirmed route and lifecycle defects, explicit hypothesis disposition, resolved issues, safety limits, and deferred management risks.
- Result: The ledger closes the two supplied hypotheses without overstating lock contention and records all known residuals with their impact and scope.

## Root Cause Ledger

### Confirmed primary common risk: shared large SQLite log I/O

- Observation: The native shared `logs_2.sqlite` was `283,754,496` bytes during the current inspection. The StepCode `logs_2.sqlite` was `2,624,913,408` bytes and its WAL was `72,227,752` bytes. Earlier captures measured approximately `660 MB` native database plus a `134 MB` WAL.
- Corroboration: Long-lived Codex and VS Code processes opened the same database families, and bounded historical/current probes entered kernel page-I/O wait while reading the shared files.
- Causal boundary: Every HUD launch previously pointed Codex at the profile's shared SQLite home, so startup metadata/log work competed with existing readers and writers before a usable TUI was visible. The fix gives each launch a unique `CODEX_SQLITE_HOME` and leaves only the small metadata databases shared through explicit links.
- Claim boundary: The evidence proves large shared SQLite page-I/O pressure. It does not prove that a specific process was waiting on a SQLite lock (`SQLITE_BUSY`/lock waiter); no lock-wait trace or error was observed. The two conditions remain separate in this record.

### Confirmed route defect: legacy Bash StepCode contract drift

- Observation: The Bash `stepcode codex` alias exports `CODEX_HUD_CLI_PATH`, `CODEX_HUD_SESSION_PREFIX`, and `CODEX_HUD_SHELL_PATH`. The refactored wrapper originally selected StepCode only for an explicit `--stepcode` flag, so the legacy route fell through to the native `codex` executable.
- Impact: The route could launch the wrong provider, use the wrong session prefix, and fail to show the expected StepCode pane even when the shell alias looked correct.
- Fix: The declarative `LAUNCH_PROFILE_REGISTRY` now declares the legacy activation/required variables and command mode. The wrapper selects that profile when the legacy tuple is present, gives an explicit `--stepcode` precedence, validates all paths, and invokes the configured `sptecode-codex` directly without appending a second `codex` subcommand.
- Evidence: `test-wrapper-legacy-stepcode-env.sh` reports `bash_route=stepcode`, `legacy_prefix=1`, `zsh_shell=1`, `native_route=0`; `test-wrapper-launch-contract.sh` reports `explicit_precedence=1`.

### Confirmed secondary lifecycle risk: tmux terminal readiness and shell injection

- Observation: Codex probes the terminal during startup. The old lifecycle injected a command into an interactive shell with `send-keys`; a client that had not attached could leave terminal replies in the shell and make the pane appear hung or incomplete. A detached tmux session can still prove pane creation without proving that the invoking client displayed it.
- Fix: The main pane now uses `respawn-pane`, registers a `client-attached` hook, and waits at most `200 * 0.05 s` (about `10 s`) before failing open. The HUD split receives the same launch environment as the main pane.
- Evidence: `test-wrapper-client-attach-gate.sh` observed gate block/release in `343 ms` on the final fresh run and passed the fail-open-cap check; `test-wrapper-stepcode-lifecycle.sh` preserved status `43`, diagnostic output, cleanup, and an unrelated sentinel session.
- Residual: If no client attaches or the hook fails, the bounded gate can still add approximately `10 s` before Codex starts. This is a visible upper bound, not an unbounded hang, and is retained as a follow-up optimization rather than misclassified as eliminated.

### Hypothesis disposition

| Hypothesis | Status | Evidence-based conclusion |
| ---------- | ------ | -------------------------- |
| SQLite I/O contention | Confirmed as a high-risk common cause | Shared databases are multi-gigabyte/large and page-I/O wait is observed; launch-local logs remove the common pressure path. |
| SQLite lock contention | Not proven | No direct lock waiter, `SQLITE_BUSY`, or lock timeout evidence was captured; the RCA does not claim one. |
| `codex-hud`/tmux lifecycle | Confirmed secondary contributor | `send-keys` plus pre-attach terminal probing can delay or obscure startup; `respawn-pane` and bounded attach gating correct the lifecycle. |
| HUD update checker | Not causal in the controlled traces | No measured update-check delay crossed the startup boundary; it remains outside the fix. |

### Resolved implementation issues

- Per-launch SQLite homes are created before tmux session creation. Conflicting symlinks, regular files, directories, link failures, missing executables, and missing prerequisites fail loudly with a non-zero status.
- Persistent `state_5.sqlite`, `goals_1.sqlite`, and `memories_1.sqlite` remain reachable from the stable profile home, while `logs_2.sqlite` is a launch-local regular file.
- Managed StepCode home and stable `CODEX_SESSIONS_PATH` are initialized before launch, preserving rollout lookup and resume semantics.
- `--help` and `--list` dispatch before stale provider validation; `test-wrapper-management-bypass.sh` reports `list_status=0`, `help_status=0`, and `stale_profile_ignored=2`. `--list` now surfaces tmux socket/server errors (`status=1`, `error_visible=1`) instead of reporting `(none)`.

## Residual and Deferred Issues

1. `kill_session()` still uses a filtered `tmux list-sessions ... || true`; a tmux socket/server failure can be rendered as “No session found.” This management-only diagnostic gap does not participate in startup, pane creation, SQLite initialization, or attach gating. Track a separate fail-fast hardening change.
2. `find_existing_session()` similarly treats a failed tmux query as an empty result when attach policy is used. The default new-session path and all startup acceptance probes remain unaffected. Add an attach-policy error regression in a separate change.
3. The three-entry fake-CLI probes do not create SQLite databases. Their `logs_2.sqlite=absent` observations prove that the wrapper did not pre-link a shared log file, while the real native TUI probe supplies the regular-file evidence (`49,152` bytes). Do not use the fake probe alone to claim a completed Codex write.
4. A bare `stepcode codex` path that bypasses `codex-hud` remains outside this patch. Changing the StepCode project would cross the agreed ownership boundary without a reproduced defect in that executable.

## Safety and Evidence Gaps

- No default live tmux launch was attempted because it would violate the requirement to preserve the active runtime. The live audit instead compared read-only snapshots: sessions `5 -> 5`, clients `4 -> 4`, panes `9 -> 9`, baseline related processes `40 -> 40`, `missing=0`, `cwd_changed=0`, `comm_changed=0` over `23.72 s`.
- The exact user-visible production stall cannot be replayed against the live home without changing live state. The RCA therefore labels the shared-I/O path as confirmed common pressure and the route/lifecycle defects as source-confirmed contributors, while retaining the distinction between evidence and inference.
