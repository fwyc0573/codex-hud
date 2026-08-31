## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-31 | Recorded reproducible focused tests, isolated route probes, native resume evidence, and live-safety metrics. |
| 2026-08-31 | Added fresh `--help` stale-profile regression evidence. |
| 2026-08-31 | Recorded the final fresh focused-suite and static-check results. |
| 2026-08-31 | Relocated focused-test temporary roots under `/data/ycfeng/tmp` and recorded the final rerun. |
| 2026-08-31 | Added the complete 18-script wrapper integration verification and isolated-server check. |
| 2026-08-31 | Recorded the user-reported tmux shutdown after the live-safety evidence window. |
| 2026-08-31 | Added the final no-op-cleanup fresh suite and post-shutdown read-only checks. |
| 2026-08-31 | Corrected the recorded baseline commit hash to the verified `HEAD`. |
| 2026-08-31 | Recorded the post-commit full wrapper verification. |

### Modification Record

- Motivation: Provide the required numeric, command-level evidence for the startup RCA and fix.
- Expectation: Every acceptance claim maps to an observed status, timing, file type/size, or topology comparison.
- Method: Re-ran the focused integration scripts in the isolated worktree with `TMPDIR=/data/ycfeng/tmp`, inspected preserved probe artifacts, and cross-checked results against source and requirements.
- Result: The final fresh suite passed (`FOCUSED_STATUS=0`); the complete wrapper integration suite also passed (`ALL_WRAPPER_INTEGRATION_STATUS=0`); the management bypass covers both `--list` and `--help`; native resume/SQLite probes passed; the default live runtime remained unchanged.

## 1. Test Script Information

### Worktree and date

- Worktree: `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831`
- Branch: `fix/codex-startup-sqlite-20260831`
- Baseline: `874f3523d2d294d1d1117e5712af42574053de1d`
- Validation date: `2026-08-31` (Asia/Hong_Kong)

### Focused integration scripts

All scripts are executable Bash programs under `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/`:

```text
test-wrapper-sqlite-isolation.sh
test-wrapper-sqlite-fail-fast.sh
test-wrapper-stepcode-launch.sh
test-wrapper-stepcode-managed-home-init.sh
test-wrapper-stepcode-fail-fast.sh
test-wrapper-stepcode-lifecycle.sh
test-wrapper-client-attach-gate.sh
test-wrapper-command-visibility.sh
test-wrapper-legacy-stepcode-env.sh
test-wrapper-launch-contract.sh
test-wrapper-list-sessions.sh
test-wrapper-list-sessions-fail-fast.sh
test-wrapper-management-bypass.sh
```

Exact focused-suite command:

```bash
set -euo pipefail
export TMPDIR=/data/ycfeng/tmp
for script in \
  test-wrapper-sqlite-isolation.sh \
  test-wrapper-sqlite-fail-fast.sh \
  test-wrapper-stepcode-launch.sh \
  test-wrapper-stepcode-managed-home-init.sh \
  test-wrapper-stepcode-fail-fast.sh \
  test-wrapper-stepcode-lifecycle.sh \
  test-wrapper-client-attach-gate.sh \
  test-wrapper-command-visibility.sh \
  test-wrapper-legacy-stepcode-env.sh \
  test-wrapper-launch-contract.sh \
  test-wrapper-list-sessions.sh \
  test-wrapper-list-sessions-fail-fast.sh \
  test-wrapper-management-bypass.sh; do
  bash "tests/integration/$script"
done
```

Exact syntax and whitespace checks:

```bash
bash -n bin/codex-hud
git diff --check
```

### Environment

| Component | Observed version |
| --------- | ---------------- |
| OS/kernel | Linux host under `/data/ycfeng` |
| Bash | `5.2.21` |
| Python | `3.12.3` |
| Node.js | `20.11.0` |
| npm | `10.2.4` |
| tmux | `3.4` |
| native Codex | `0.144.4` |
| StepCode | `1.2.77` |
| Shells exercised | Bash and `/bin/zsh` (legacy StepCode pane) |

Focused tests use fake CLIs/tmux servers and isolated `HOME` directories. Temporary paths are created below `/data/ycfeng/tmp`; the default tmux server is not used for controlled launches.

Final fresh-suite artifact: `/data/ycfeng/tmp/codex-hud-focused-final-final-20260831.log` (`FOCUSED_STATUS=0`).

Final pre-commit fresh-suite artifact: `/data/ycfeng/tmp/codex-hud-final-fresh-20260831.log` (`FINAL_FRESH_STATUS=0`; 18 scripts, 18 pass, 0 fail). The run exported `TMPDIR=/data/ycfeng/tmp` and made the child-test `rm` function a no-op so verification did not remove any temporary data.

Post-commit fresh-suite artifact: `/data/ycfeng/tmp/codex-hud-postcommit-fresh-20260831.log` (`POSTCOMMIT_STATUS=0`; 18 scripts, 18 pass, 0 fail). The run used the same persistent temporary root and no-op cleanup boundary.

Complete wrapper-integration artifact: `/data/ycfeng/tmp/codex-hud-all-integration-final-20260831.log` (`ALL_WRAPPER_INTEGRATION_STATUS=0`).

Exact complete-suite command:

```bash
set -euo pipefail
export TMPDIR=/data/ycfeng/tmp
for script in tests/integration/test-wrapper-*.sh; do
  bash "$script"
done
```

## 2. Validation Criteria

### Root-cause and path criteria

- Confirm large shared SQLite file/WAL sizes and page-I/O observations while keeping the stronger lock-wait claim separate.
- Confirm native `cx`, Zsh `scx`/explicit `--stepcode`, and Bash legacy `stepcode codex` resolve to the intended executable and command vector.
- Require a unique launch-scoped `CODEX_SQLITE_HOME` for each launch.
- Require `logs_2.sqlite` to remain a regular launch-local file; require `state_5.sqlite`, `goals_1.sqlite`, and `memories_1.sqlite` to remain reachable through stable-home links.
- Require the main and HUD panes to receive identical launch SQLite environment values.
- Require setup errors to return non-zero and remain visible before tmux state is created.

### Lifecycle and durability criteria

- Require `respawn-pane` command execution after the `client-attached` gate, with a bounded `200 * 0.05 s` fail-open cap.
- Require StepCode success/failure status and diagnostics to remain observable, cleanup to be session-scoped, and an unrelated sentinel session to survive.
- Require the historical thread ID, historical turn count, rollout path, and rollout byte count to remain stable across resume.
- Require the default live tmux/process topology to match before and after snapshots exactly.

### Direct assertions

- SQLite isolation: `distinct_homes=2`, `shared_log_links=0`, metadata link count `6`.
- SQLite fail-fast: all five ownership/filesystem failure cases return visible non-zero errors.
- Route probes: all three statuses equal `0`; Bash route uses `sptecode-codex` and no duplicate `codex` argument.
- Real Codex probe: `logs_2.sqlite` is a regular file, not a symlink; process exit equals `0`.
- Resume: `historical_turns=2`, `resume_seconds=0.045`, rollout bytes unchanged at `21,556`.
- Management bypass: `list_status=0`, `help_status=0`, and `stale_profile_ignored=2` with an invalid `CODEX_HUD_CLI_PATH`.
- Safety: sessions, clients, panes, process identities, `comm`, and CWD values remain unchanged.

## 3. Test Results and Evidence

### Focused integration results

| Script | Result | Observed output |
| ------ | ------ | --------------- |
| `test-wrapper-sqlite-isolation.sh` | PASS | `concurrent_launches=2, distinct_homes=2, persistent_links=6, shared_log_links=0` |
| `test-wrapper-sqlite-fail-fast.sh` | PASS | `explicit_owner=1, conflicting_symlink=1, conflicting_file=1, link_failure=1, directory_failure=1` |
| `test-wrapper-stepcode-launch.sh` | PASS | `stepcode_management_kill=1` |
| `test-wrapper-stepcode-managed-home-init.sh` | PASS | `managed_home_created=1, stable_codex_sessions_path_created=1, metadata_links=3, status=0` |
| `test-wrapper-stepcode-fail-fast.sh` | PASS | `missing-home: status=1`; `missing-stepcode: status=1`; `missing-node: status=1` |
| `test-wrapper-stepcode-lifecycle.sh` | PASS | Success `status=0, session_cleaned=1, sentinel_alive=1`; failure `status=43, diagnostic_retained=1, session_cleaned=1, sentinel_alive=1` |
| `test-wrapper-client-attach-gate.sh` | PASS | Final pre-commit `343 ms`; post-commit `341 ms`; earlier complete-suite run `508 ms`; fail-open-cap assertion passed |
| `test-wrapper-command-visibility.sh` | PASS | Command text remains visible in the expected tmux trace |
| `test-wrapper-legacy-stepcode-env.sh` | PASS | `bash_route=stepcode, legacy_prefix=1, zsh_shell=1, native_route=0` |
| `test-wrapper-launch-contract.sh` | PASS | `explicit_precedence=1` |
| `test-wrapper-list-sessions.sh` | PASS | `native=1, stepcode=1, custom_marker=1, unrelated=0` |
| `test-wrapper-list-sessions-fail-fast.sh` | PASS | Simulated tmux failure `status=1, error_visible=1` |
| `test-wrapper-management-bypass.sh` | PASS | `list_status=0, help_status=0, stale_profile_ignored=2` |

### Three-entry isolated probes

Evidence directory: `/data/ycfeng/tmp/codex-hud-three-entry-ow7VOV`.

| Route | Status | Wall time | Trace evidence |
| ----- | ------ | --------- | -------------- |
| Native `cx` equivalent | `0` | approximately `445 ms` | `native.tmux.log` contains `new-session`, `respawn-pane`, `split-window`; main/HUD share a launch-local `CODEX_SQLITE_HOME`. |
| Zsh `scx` / explicit `--stepcode` | `0` | approximately `400 ms` | `zsh-scx.tmux.log` contains `stepcode codex`, managed `CODEX_HOME`, stable `CODEX_SESSIONS_PATH`, and one launch-local SQLite home in both panes. |
| Bash legacy `stepcode codex` | `0` | `394 ms` | `bash-stepcode.tmux.log` contains `/bin/zsh -ilc` and `sptecode-codex`; no appended `codex`; both panes share the launch-local SQLite home. |

These probes use fake CLIs. The fake processes exit without creating `logs_2.sqlite`, so an `absent` file in these directories is expected and proves only that the wrapper did not pre-create a shared log symlink. Real file-type evidence is recorded below.

### Native Codex resume and SQLite evidence

Historical resume artifact: `/data/ycfeng/tmp/codex-historical-resume-LclpfS/launch-c.probe`.

```text
thread_id=019ff98f-7060-7842-b8f7-7b4e798d367f
historical_turns=2
init_seconds=2.370
resume_seconds=0.045
total_seconds=2.415
process_exit=0
rollout_bytes_before=21556
rollout_bytes_after=21556
```

Native startup artifact: `/data/ycfeng/tmp/codex-native-startup-probe-EXkcYv/meta.txt`.

```text
exit_code=0
latency_ms=1348
rollout_bytes_before=21556
rollout_bytes_after=21556
logs_2.sqlite=49152 bytes (regular file)
```

The same artifact records WAL/SHM sidecars. The historical run recorded `logs_2.sqlite-wal=119,512` bytes; native startup also created WAL/SHM sidecars while keeping rollout bytes stable.

Native TUI artifact: `/data/ycfeng/tmp/codex-native-tui-resume-F4Nnrs/meta.log`.

```text
first_nonempty_ms=157
first_prompt_ms=2989
elapsed_ms=14055
logs_2.sqlite=49152 bytes (regular file)
logs_2.sqlite-shm=32768 bytes
logs_2.sqlite-wal=127752 bytes
rollout=21556 bytes
```

The real Codex app-server emitted environmental warnings (missing bubblewrap and an unknown feature key) and exited successfully; no SQLite lock error was emitted.

### Shared-database RCA measurements

| Database observation | Value | Interpretation |
| -------------------- | ----- | -------------- |
| Current native `logs_2.sqlite` | `283,754,496` bytes | Large shared read/write surface during startup. |
| Current StepCode `logs_2.sqlite` | `2,624,913,408` bytes | Multi-gigabyte shared log surface. |
| Current StepCode WAL | `72,227,752` bytes | Additional active write/read pressure. |
| Historical native database | approximately `660 MB` | Repeated large-file condition, not a one-off value. |
| Historical native WAL | approximately `134 MB` | Sidecar growth accompanies the large database. |
| Direct lock waiter | not observed | Keep “lock contention” unconfirmed; evidence supports page-I/O pressure. |

### Live-safety evidence

Audit document: `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/task_memory/task_2026-08-31_codex-startup-block-rca-v2/live-safety-audit.md`.

Snapshot artifacts:

- Before: `/data/ycfeng/tmp/codex-hud-live-safety-before-20260831.txt`, `27,201` bytes, SHA-256 `18cd882ec75c9de4b47344be8a0bd8fb9b90c2e0261d146b5a13baaaec1cdf21`.
- After: `/data/ycfeng/tmp/codex-hud-live-safety-after-20260831.txt`, `27,200` bytes, SHA-256 `9a3322ad833ef68141f0b61ca81c2e3d2db690df3cda06ff24bc6f9a6ee07388`.

The structural comparison covered `23.72 s` and observed:

```text
tmux sessions: 5 -> 5
tmux clients: 4 -> 4
tmux panes: 9 -> 9
related baseline processes: 40 -> 40
missing=0
cwd_changed=0
comm_changed=0
```

No default live launch, attach, detach, respawn, kill, or SQLite write was performed.

The user reported killing all tmux sessions after this audit completed. A post-event read-only probe returned `status=1` because the default tmux socket no longer existed; that external event is not included in the before/after safety comparison.

### Overall verdict

**PASS within the agreed HUD-wrapper scope.** The final fresh suite and recorded direct probes close the launch-isolation, legacy-route, lifecycle, resume, management-bypass, and live-safety acceptance gates. The evidence does not establish a SQLite lock waiter, and the bounded attach gate can still add approximately `10 s` when no client attaches; both boundaries are recorded as such rather than hidden by fallback logic.
