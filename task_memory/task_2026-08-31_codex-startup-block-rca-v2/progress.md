## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-31 | Recorded the complete RCA, implementation, direct probes, reviews, and safety validation. |
| 2026-08-31 | Added a stale-profile `--help` management regression and recorded its fresh result. |
| 2026-08-31 | Recorded the final fresh focused-suite and static-check results. |
| 2026-08-31 | Relocated two focused-test temporary roots under `/data/ycfeng/tmp` and recorded the final rerun. |
| 2026-08-31 | Ran the complete 18-script wrapper integration suite and recorded its isolated-server result. |
| 2026-08-31 | Recorded the user-initiated tmux shutdown that occurred after the live-safety audit. |
| 2026-08-31 | Added the final no-op-cleanup fresh suite and post-shutdown read-only checks. |
| 2026-08-31 | Corrected the recorded baseline commit hash to the verified `HEAD`. |

## Session Log

### 2026-08-31 - Scope and safety boundary

- Status: completed.
- Motivation: The user reported a long block with no visible Codex pane through `cx`, `scx`, and Bash `stepcode codex`, while an existing Codex/StepCode/tmux runtime was active.
- Expectation: Establish an isolated worktree and preserve every live session, client, pane, process, SQLite file, and working directory.
- Method: Created branch `fix/codex-startup-sqlite-20260831` from `874f3523d2d294d1d1117e5712af42574053de1d` under `.worktrees/`; used only read-only inspection of the default tmux server and process table.
- Result: The live-safety boundary remained intact; controlled work stayed under `/data/ycfeng/tmp` and the verification worktree.

### 2026-08-31 - Entry-point and source trace

- Status: completed.
- Motivation: Determine whether all reported routes share one wrapper boundary and whether the Bash StepCode route still matches the current wrapper contract.
- Expectation: Identify a concrete route-selection defect with source-level evidence instead of inferring from command names.
- Method: Traced shell aliases, `bin/codex-hud` profile selection, tmux command construction, update checks, and historical commits `b9ca074` and `e5494b9`.
- Result: The Bash route supplies `CODEX_HUD_CLI_PATH`, `CODEX_HUD_SESSION_PREFIX`, and `CODEX_HUD_SHELL_PATH`; the refactored wrapper previously recognized only explicit `--stepcode`, so that route fell through to the native profile. The wrapper also had a shared `logs_2.sqlite` path and a shell-injected `send-keys` launch lifecycle.

### 2026-08-31 - Runtime and SQLite evidence

- Status: completed.
- Motivation: Separate page-I/O pressure from a proven SQLite lock waiter and distinguish Codex startup time from HUD/tmux setup time.
- Expectation: Produce observable file sizes, process/path evidence, timestamps, and bounded probes for each hypothesis.
- Method: Inspected current database families, historical strace/probe artifacts, and isolated native/StepCode app-server and TUI runs. No live database was opened for writing.
- Result: Current native `logs_2.sqlite` measured `283,754,496` bytes; current StepCode `logs_2.sqlite` measured `2,624,913,408` bytes with a `72,227,752` byte WAL. Historical captures also showed approximately `660 MB` native database plus `134 MB` WAL. Long-lived Codex/VS Code processes shared these database families and bounded reads entered kernel page-I/O wait. The evidence confirms large shared SQLite I/O pressure, but does not prove a SQLite lock waiter. HUD attach/setup remained a separate bounded risk.

### 2026-08-31 - Regression-first implementation

- Status: completed.
- Motivation: Make the causal fixes executable and prevent a future profile or filesystem collision from becoming a silent hang.
- Expectation: Give each HUD launch a private log database, preserve resume metadata, restore the legacy Bash contract, and expose setup failures before tmux startup.
- Method: Added focused RED/GREEN integration tests under `tests/integration/`; extended the declarative `LAUNCH_PROFILE_REGISTRY`; added legacy environment resolution, explicit-profile precedence, launch-scoped `CODEX_SQLITE_HOME`, fail-fast SQLite link checks, managed StepCode home initialization, `respawn-pane`, and the bounded `client-attached` gate in `bin/codex-hud`.
- Result: The focused suite passed. `state_5.sqlite`, `goals_1.sqlite`, and `memories_1.sqlite` remain linked to the stable profile home; `logs_2.sqlite` is launch-local. The main and HUD panes receive the same launch-local SQLite environment. Stale legacy variables no longer override an explicit `--stepcode` launch, and the Bash legacy route invokes `sptecode-codex` without appending a duplicate `codex`.

### 2026-08-31 - Controlled three-entry probes

- Status: completed.
- Motivation: Verify the actual command vector, pane creation, environment propagation, and route latency independently of the default live runtime.
- Expectation: `cx`, Zsh `scx`, and Bash `stepcode codex` each create a HUD session and use the intended profile.
- Method: Ran isolated fake-CLI probes with independent `HOME`, tmux fake server, and logs under `/data/ycfeng/tmp/codex-hud-three-entry-ow7VOV`.
- Result: Native status `0` in approximately `445 ms`; Zsh explicit StepCode status `0` in approximately `400 ms`; Bash legacy StepCode status `0` in `394 ms`. Each trace showed a main pane plus HUD split and matching environment prefixes. The fake CLI did not create a real `logs_2.sqlite`, so those probes establish wrapper path/type intent only; the real-file claim is backed by the native Codex probes below.

### 2026-08-31 - Resume and real Codex probes

- Status: completed.
- Motivation: Ensure isolating logs does not break historical thread discovery or rollout durability.
- Expectation: The original thread and historical turns remain resumable, and a real Codex process creates a regular launch-local SQLite log file.
- Method: Resumed thread `019ff98f-7060-7842-b8f7-7b4e798d367f` with native Codex `0.144.4`, then ran a native startup probe and a tmux TUI/resume probe in isolated homes.
- Result: Historical resume reported `historical_turns=2`, `init_seconds=2.370`, `resume_seconds=0.045`, `total_seconds=2.415`, and `process_exit=0`; rollout size stayed `21,556` bytes. Native startup reported `latency_ms=1348`, `exit_code=0`, and unchanged rollout bytes `21,556 -> 21,556`. Native TUI reported first non-empty output at `157 ms`, first prompt at `2,989 ms`, and a regular `logs_2.sqlite` of `49,152` bytes with WAL/SHM sidecars.

### 2026-08-31 - Review and live-safety closure

- Status: completed.
- Motivation: Independently challenge the implementation and prove that verification did not disturb the user’s active runtime.
- Expectation: No Critical or High startup defect remains, and the default tmux/process topology is unchanged.
- Method: Ran independent code/diff reviews, syntax and whitespace checks, the focused integration suite, and before/after read-only snapshots of the default tmux server and matching processes.
- Result: Reviewers found no Critical or High issue in the startup scope. `bash -n bin/codex-hud` and `git diff --check` passed; all focused tests passed. The live audit observed `5 -> 5` sessions, `4 -> 4` clients, `9 -> 9` panes, `missing=0`, `cwd_changed=0`, and `comm_changed=0` across `23.72 s`. Remaining management-path error handling is recorded in `issues.md` and `future.md`.

### 2026-08-31 - Management help regression

- Status: completed.
- Motivation: The profile-independent management bypass must cover both `--list` and `--help` when stale legacy provider variables point at a missing executable.
- Expectation: Both commands return zero and execute their own output path without validating the stale provider executable.
- Method: Extended `tests/integration/test-wrapper-management-bypass.sh` with an isolated `--help` invocation using the same stale environment, then ran the script in the fix worktree.
- Result: The test passed with `list_status=0`, `help_status=0`, and `stale_profile_ignored=2`; no production file changed in this sub-step.

### 2026-08-31 - Final fresh verification

- Status: completed.
- Motivation: Confirm the complete changed surface after the management regression and before integration.
- Expectation: All 13 focused integration scripts, wrapper syntax checks, and diff hygiene checks return zero; no runtime artifacts enter the worktree.
- Method: Ran the full suite with output captured at `/data/ycfeng/tmp/codex-hud-focused-final-final-20260831.log`, then ran `bash -n` for the wrapper and all integration scripts, `git diff --check`, and an artifact scan.
- Result: `FOCUSED_STATUS=0`; all 13 scripts passed, attach gate block/release measured `343 ms`, management bypass reported `list_status=0`, `help_status=0`, `stale_profile_ignored=2`, `STATIC_STATUS=0`, and the worktree contained no SQLite/WAL/SHM/log files.

### 2026-08-31 - Test temporary-path correction

- Status: completed.
- Motivation: Keep every temporary directory and log created by the focused tests on the persistent workspace path required by the task rules.
- Expectation: The command-visibility and client-attach tests use only `/data/ycfeng/tmp` while preserving their assertions and cleanup behavior.
- Method: Replaced their default `mktemp` locations with test-owned roots created by absolute `/data/ycfeng/tmp/...-XXXXXX` templates, added the missing fake-bin/state directory initialization, and reran the targeted test followed by the complete 13-script suite.
- Result: The targeted attach-gate test passed; the final suite passed with `FOCUSED_STATUS=0`, attach block/release `343 ms`, and no temporary artifacts in the worktree.

### 2026-08-31 - Full wrapper integration verification

- Status: completed.
- Motivation: Exercise the unchanged base-index, failure-visibility, interrupt, and legacy e2e isolation regressions in addition to the 13 focused scripts.
- Expectation: Every `tests/integration/test-wrapper-*.sh` script runs against an isolated tmux server or logger, returns zero, and leaves the default live server untouched.
- Method: Exported `TMPDIR=/data/ycfeng/tmp`, ran all 18 wrapper integration scripts, captured output at `/data/ycfeng/tmp/codex-hud-all-integration-final-20260831.log`, and checked the default server session list afterward.
- Result: `ALL_WRAPPER_INTEGRATION_STATUS=0`; all 18 scripts passed, the full-suite attach gate measured `508 ms` (the focused rerun measured `343 ms`), the default server still reported `5` sessions, and no worktree SQLite/WAL/SHM/log artifacts appeared.

### 2026-08-31 - User-initiated tmux shutdown boundary

- Status: recorded.
- Motivation: Preserve the causal boundary after the user reported terminating all tmux sessions following the completed safety audit.
- Expectation: The final handoff distinguishes the verified pre-shutdown topology from the later external runtime change.
- Method: Performed one read-only `tmux list-sessions` probe after the user update; it returned `status=1` and `error connecting to /tmp/tmux-10250/default (No such file or directory)`.
- Result: The default tmux server is currently absent by user action; no command in this task recreated, attached to, or killed that server.

### 2026-08-31 - Final fresh verification after user shutdown

- Status: completed.
- Motivation: Produce a final verification record in the current post-shutdown state immediately before committing.
- Expectation: Every wrapper integration script and every static check returns zero while test cleanup remains confined to task-owned temporary paths.
- Method: Exported `TMPDIR=/data/ycfeng/tmp`, overrode the child-test `rm` function to a no-op so no cleanup command could remove data during this final run, executed every `tests/integration/test-wrapper-*.sh` script with a 90-second timeout, and captured output at `/data/ycfeng/tmp/codex-hud-final-fresh-20260831.log`. Then ran `bash -n` for the wrapper and all integration scripts, `git diff --check`, a read-only default tmux probe, and a worktree runtime-artifact scan.
- Result: `FINAL_FRESH_SCRIPT_COUNT=18`, `FINAL_FRESH_PASS=18`, `FINAL_FRESH_FAIL=0`, `FINAL_FRESH_STATUS=0`; attach gate block/release was `343 ms`; SQLite isolation reported `distinct_homes=2`, `persistent_links=6`, `shared_log_links=0`; static checks returned `STATIC_STATUS=0`; default tmux probe returned `POST_USER_TMUX_STATUS=1` with `no server running`; worktree runtime-artifact count was `0`.

### 2026-08-31 - Baseline hash correction

- Status: completed.
- Motivation: Keep the task archive traceable to the exact pre-change commit.
- Expectation: Every archived baseline reference matches `git rev-parse HEAD` from the fix worktree before integration.
- Method: Compared the documented value with the worktree's verified `git rev-parse HEAD` output and corrected the two stale references.
- Result: `HEAD` and all baseline references now read `874f3523d2d294d1d1117e5712af42574053de1d`.
