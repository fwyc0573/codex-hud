## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-31 | Recorded the launch-scoped SQLite and persistent-resume design boundary. |

### Modification Record

- Motivation: Capture the selected design before implementation so the shared/local state boundary remains reviewable.
- Expectation: Adding a launch does not require a new classification branch, resume metadata remains durable, and the high-churn log file stops being shared.
- Method: Kept the existing profile registry as the classification source, derived a session-specific SQLite directory, linked only stable metadata databases, retained stable rollout storage, and reused one environment prefix for both panes.
- Result: The implementation follows this boundary in `bin/codex-hud`; conflicting explicit state fails fast instead of being overwritten.

## Design

The existing launch-profile registry remains the single classification source for native and StepCode launches. `create_session` derives a unique SQLite directory from the stable profile home and `SESSION_NAME`. Existing persistent `state_5.sqlite`, `goals_1.sqlite`, and `memories_1.sqlite` are linked into that directory; `logs_2.sqlite` stays a regular file created by the launch. The same environment prefix is used for the Codex pane and HUD pane. An explicitly supplied `CODEX_SQLITE_HOME` remains authoritative and fails fast on conflicting state links. Rollouts stay under the profile's stable sessions path so a later launch can resume the same thread.

The change stays inside `bin/codex-hud` and its focused integration regressions. It does not mutate shell startup files or the bare StepCode executable.
