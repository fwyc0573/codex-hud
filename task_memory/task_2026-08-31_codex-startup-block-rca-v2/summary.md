## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-31 | Archived the completed startup RCA, root-cause fix, evidence, and residual work. |
| 2026-08-31 | Added the fresh `--help` stale-profile regression result to the archive. |
| 2026-08-31 | Updated the archive with the final temporary-path-compliant suite rerun. |
| 2026-08-31 | Added the complete 18-script wrapper integration verification result. |
| 2026-08-31 | Added the final no-op-cleanup fresh suite and post-shutdown read-only checks. |

### Modification Record

- Motivation: Preserve an auditable English handoff for the completed Codex startup-block incident.
- Expectation: A reader can map every requirement to a deliverable and a measured validation result.
- Method: Consolidated source changes, focused tests, isolated route probes, native Codex resume evidence, independent reviews, and the live-safety audit.
- Result: The startup fix is complete within the agreed HUD-wrapper scope; residual management hardening is explicitly listed below.

## Task Overview

The incident affected Codex launches through `cx`, Zsh `scx`, and the Bash `stepcode codex` route. Investigation found a common shared-SQLite pressure path, a legacy StepCode environment-contract drift, and a secondary tmux terminal-readiness risk. The wrapper now allocates a unique launch-scoped `CODEX_SQLITE_HOME`, keeps high-churn `logs_2.sqlite` local, preserves durable metadata and rollout paths, resolves legacy StepCode through the declarative launch-profile registry, and starts terminal-sensitive Codex processes with a bounded client-attach gate and `respawn-pane`.

The evidence confirms large shared SQLite page-I/O pressure. It does not prove a SQLite lock waiter; no `SQLITE_BUSY` or direct lock-wait trace was observed. The default live tmux/process runtime was inspected read-only and remained unchanged.

## Deliverables Inventory

| Deliverable | Exact path | Purpose |
| ----------- | ---------- | ------- |
| Production wrapper fix | `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/bin/codex-hud` | Launch profile compatibility, SQLite isolation, fail-fast validation, and tmux lifecycle. |
| SQLite isolation regression | `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-sqlite-isolation.sh` | Verifies concurrent launches use distinct homes and local logs. |
| SQLite fail-fast regression | `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-sqlite-fail-fast.sh` | Verifies conflicting ownership and filesystem errors remain visible. |
| StepCode launch regressions | `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-stepcode-launch.sh`; `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-stepcode-managed-home-init.sh`; `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-stepcode-fail-fast.sh`; `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-stepcode-lifecycle.sh` | Verifies managed homes, command vectors, prerequisites, exit status, diagnostics, cleanup, and sentinel preservation. |
| Profile and pane regressions | `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-legacy-stepcode-env.sh`; `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-launch-contract.sh`; `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-command-visibility.sh`; `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-client-attach-gate.sh` | Verifies legacy Bash routing, explicit precedence, shell command visibility, and bounded attach behavior. |
| Management regressions | `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-management-bypass.sh`; `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-list-sessions.sh`; `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/tests/integration/test-wrapper-list-sessions-fail-fast.sh` | Keeps management commands independent from stale provider state and surfaces tmux query failures. |
| Requirements and execution record | `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/task_memory/task_2026-08-31_codex-startup-block-rca-v2/requirements.md`; `plan.md`; `design.md`; `notes.md`; `progress.md`; `issues.md`; `review.md`; `harness.md`; `lessons.md`; `future.md` | Stores the single request, plan, design, operational notes, progress, issue ledger, reviews, gates, lessons, and deferred work. |
| Test report | `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/task_memory/task_2026-08-31_codex-startup-block-rca-v2/test_report_2026-08-31_startup_rca.md` | Records commands, environment, numeric outcomes, evidence paths, and probe limitations. |
| Live safety audit | `/data/ycfeng/codex-hud/.worktrees/fix-codex-startup-sqlite-20260831/task_memory/task_2026-08-31_codex-startup-block-rca-v2/live-safety-audit.md` | Provides read-only before/after comparison of the default runtime. |

## Validation Status

| Validation area | Result | Metrics and evidence |
| --------------- | ------ | -------------------- |
| Shell syntax and patch hygiene | PASS | `bash -n bin/codex-hud`; `git diff --check`; no `shellcheck` or `lsp_diagnostics` binary was available. |
| SQLite isolation | PASS | `concurrent_launches=2`; `distinct_homes=2`; `persistent_links=6`; `shared_log_links=0`. |
| SQLite fail-fast | PASS | `explicit_owner=1`; `conflicting_symlink=1`; `conflicting_file=1`; `link_failure=1`; `directory_failure=1`. |
| Native `cx` equivalent probe | PASS | Status `0`; wall time approximately `445 ms`; launch-local SQLite path present in main/HUD command traces. |
| Zsh `scx` / explicit StepCode probe | PASS | Status `0`; wall time approximately `400 ms`; command vector contains `stepcode codex`; managed home and stable sessions path propagated. |
| Bash legacy `stepcode codex` probe | PASS | Status `0`; wall time `394 ms`; command vector uses `sptecode-codex` through `/bin/zsh -ilc` without a duplicate `codex`; legacy prefix and shell are applied. |
| StepCode managed home | PASS | `managed_home_created=1`; `stable_codex_sessions_path_created=1`; `metadata_links=3`; status `0`. |
| StepCode lifecycle | PASS | Success status `0`, `session_cleaned=1`, `sentinel_alive=1`; failure status `43`, `diagnostic_retained=1`, `session_cleaned=1`, `sentinel_alive=1`. |
| Client-attach gate | PASS | Final fresh run block/release `343 ms`; earlier complete-suite run `508 ms`; fail-open cap test passed; configured cap is `200 * 0.05 s` (about `10 s`). |
| Full wrapper integration | PASS | Final fresh run covered all 18 `test-wrapper-*.sh` scripts with `FINAL_FRESH_PASS=18`, `FINAL_FRESH_FAIL=0`, `FINAL_FRESH_STATUS=0`; earlier isolated-server run also returned `ALL_WRAPPER_INTEGRATION_STATUS=0`. |
| Resume durability | PASS | Historical thread `019ff98f-7060-7842-b8f7-7b4e798d367f`; `historical_turns=2`; init `2.370 s`; resume `0.045 s`; total `2.415 s`; process exit `0`; rollout remained `21,556` bytes. |
| Real native SQLite file | PASS | Native startup exit `0`, latency `1,348 ms`; `logs_2.sqlite` regular file `49,152` bytes with WAL/SHM sidecars; rollout `21,556 -> 21,556` bytes. |
| Native TUI visibility | PASS | First non-empty output `157 ms`; first prompt `2,989 ms`; total probe elapsed `14,055 ms`; launch-local `logs_2.sqlite` regular file. |
| Management error visibility | PASS | Stale profile bypass `list_status=0`, `help_status=0`, `stale_profile_ignored=2`; tmux socket-failure status `1`, `error_visible=1`; session listing found native/StepCode/custom marker and excluded unrelated session. |
| Live runtime safety | PASS | Over `23.72 s`: sessions `5 -> 5`; clients `4 -> 4`; panes `9 -> 9`; related processes `40 -> 40`; `missing=0`; `cwd_changed=0`; `comm_changed=0`. |

## Open Items/Future Extensions

- Propagate tmux query errors in `kill_session()` and `find_existing_session()` in a separate management hardening change.
- Re-measure and, if justified, tune the approximately `10 s` attach-gate cap using a production-safe reproduction.
- Define retention and recovery policy before deleting launch-local SQLite directories.
- Investigate bare StepCode launches only if a separate, reproducible defect reaches the StepCode project.
