## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-31 | Created the evidence-first implementation plan and dependency map. |

### Modification Record

- Motivation: Turn the startup RCA request into an ordered, auditable execution path.
- Expectation: Independent traces precede causal decisions, implementation follows a regression, and safety/resume checks close the work.
- Method: Defined the `live-baseline -> {entrypoint-trace, runtime-trace, source-trace} -> controlled-reproduction -> hypothesis-review -> RED-regression -> implementation -> focused-green -> resume-proof -> live-safety-audit -> review -> archive` dependency chain and acceptance criteria.
- Result: The plan establishes the parallel trace phase, the required join points, and measurable gates for SQLite, tmux, resume, and live safety.

## Scope

Trace shell entry points, `codex-hud`, tmux lifecycle, native Codex/StepCode startup, and SQLite state paths. Restore a launch-scoped SQLite log plane through the existing HUD launch-profile mechanism, preserve persistent metadata and rollout storage, and verify the result without touching the default live runtime.

## Dependency and Parallelism Map

`live-baseline -> {entrypoint-trace, runtime-trace, source-trace} -> controlled-reproduction -> hypothesis-review -> RED-regression -> implementation -> focused-green -> resume-proof -> live-safety-audit -> review -> archive`

`entrypoint-trace`, `runtime-trace`, and `source-trace` run in parallel after `live-baseline`. `hypothesis-review` waits for all three traces. `RED-regression` waits for the reviewed causal boundary. `implementation` waits for RED. `focused-green` and `resume-proof` run in parallel after implementation, then join at `live-safety-audit`.

## Acceptance Criteria

- The first blocking boundary has concrete timestamps, process/file evidence, and source references.
- Controlled launches distinguish shared large SQLite state from launch-local state and distinguish HUD/tmux setup from Codex startup.
- Each new HUD launch gets a unique `CODEX_SQLITE_HOME`; its `logs_2.sqlite` is launch-local.
- Persistent metadata and rollout paths remain reachable and resume returns the original thread and history.
- Main and HUD panes receive the same launch-local SQLite environment.
- Existing default tmux sessions, clients, processes, and working directories remain unchanged.
- Focused tests and direct runtime probes pass with numeric startup/resume evidence.
