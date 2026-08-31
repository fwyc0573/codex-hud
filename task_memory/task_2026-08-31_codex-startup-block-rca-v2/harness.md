## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-31 | Defined and closed the task-specific safety, evidence, and acceptance gates. |

### Modification Record

- Motivation: Make safety, evidence quality, fail-fast behavior, and acceptance conditions executable rather than implicit.
- Expectation: Each check has a stated failure it detects, an observable result, and a clear action if it fails.
- Method: Defined scope, evidence, implementation, verification gates, and a requirement-to-evidence mapping for isolated probes and live read-only audits.
- Result: All listed gates were exercised or explicitly bounded; the test report records the commands and numeric outcomes.

## Gates

### Scope and safety

- Use an isolated worktree at `.worktrees/fix-codex-startup-sqlite-20260831`.
- Use only `/data/ycfeng/tmp` for temporary homes, fake tmux sockets, PTY captures, and logs.
- Keep the default live tmux server, clients, sessions, panes, processes, SQLite files, shell startup files, and working directories read-only during validation.
- Avoid `rm`, `mv`, force operations, and live `cx`/`scx`/`stepcode codex` launches; clean-up applies only to test-owned temporary directories.

### Evidence gates

- Record the first blocking boundary with source references, timestamps, process/path evidence, and a clear evidence-versus-inference label.
- Evaluate SQLite page-I/O pressure and SQLite lock contention as separate claims. Require a direct lock waiter or `SQLITE_BUSY` observation before using “lock contention” as a confirmed root cause.
- Trace all three HUD routes independently: native `cx`, Zsh `scx`/explicit `--stepcode`, and Bash legacy `stepcode codex`.
- Keep bare StepCode launches outside scope unless a reproducible defect reaches the StepCode project itself.

### Implementation gates

- Resolve growing launch categories through the single `LAUNCH_PROFILE_REGISTRY`.
- Give each launch a unique `CODEX_SQLITE_HOME` and keep `logs_2.sqlite` a launch-local regular file.
- Preserve stable `state_5.sqlite`, `goals_1.sqlite`, `memories_1.sqlite`, and rollout/session paths needed for resume.
- Pass the same launch environment to the main Codex pane and HUD pane.
- Fail fast on missing executable, missing prerequisite, conflicting link/file/directory, or link-creation failure before creating a tmux session.
- Use `respawn-pane` and a bounded client-attach gate; document the approximately `10 s` fail-open upper bound.

### Verification gates

- Run a failing regression before implementation when the defect can be isolated; run the corresponding focused regression after implementation.
- Prefer direct fake-CLI/tmux probes for command vectors and pane topology, and direct native Codex probes for SQLite file type and resume durability.
- Record exact commands, Bash/Python/Node/tmux versions, exit statuses, timings, file sizes/types, rollout identifiers, and log paths in the test report.
- Run `bash -n bin/codex-hud` and `git diff --check` before handoff.
- Run the read-only live-safety snapshot before and after all controlled probes and require unchanged topology/process/CWD values.

## Acceptance Mapping

| Requirement | Gate and evidence |
| ----------- | ---------------- |
| Root-cause fix | Shared-log isolation, registry compatibility, and lifecycle changes in `bin/codex-hud`; focused green tests. |
| Two hypotheses | `issues.md` classification plus large-file/page-I/O measurements and lifecycle traces; lock waiter explicitly unproven. |
| Live safety | `live-safety-audit.md`; sessions `5 -> 5`, clients `4 -> 4`, panes `9 -> 9`, related process `missing=0`. |
| Resume | Historical thread `019ff98f-7060-7842-b8f7-7b4e798d367f`, `historical_turns=2`, resume `0.045 s`, rollout unchanged at `21,556` bytes. |
| Three routes | Isolated probe directory `/data/ycfeng/tmp/codex-hud-three-entry-ow7VOV`, all statuses `0`, route timings `445/400/394 ms`. |
| Fail-fast | SQLite conflict matrix, missing dependency matrix, `list_sessions` socket failure `status=1`, and no tmux session before setup errors. |
| Test/report placement | Scripts under `tests/integration/`; report under this task directory with reproducible commands and numeric results. |
