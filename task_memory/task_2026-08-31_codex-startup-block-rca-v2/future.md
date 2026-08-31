## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-31 | Recorded follow-up work explicitly deferred from the startup RCA/fix. |

### Modification Record

- Motivation: Keep valid follow-up hardening and measurement work visible without expanding the current startup sub-step.
- Expectation: Deferred items have a clear trigger and do not get mistaken for unresolved core deliverables.
- Method: Listed management error propagation, attach-gate measurement, retention policy, bare StepCode boundary, and update-check measurement as separate future tasks.
- Result: The current fix remains scoped to the HUD wrapper; each deferred item has an explicit next investigation boundary.

## Future Work

The following items remain outside the completed startup sub-step. Each needs its own reproduction, scope decision, and focused verification.

1. Make `kill_session()` propagate tmux server/socket errors instead of converting them to “No session found.” Add a management-path regression that distinguishes an empty session set from a failed query.
2. Make `find_existing_session()` propagate tmux query errors when attach policy is selected. Add an attach-policy regression while preserving the default new-session behavior.
3. Revisit the approximately `10 s` client-attach fail-open cap after measuring real production attach latency and terminal-probe behavior. Any reduction must retain a bounded path and direct evidence.
4. Define a retention and cleanup policy for launch-local `.codex-hud-sqlite/<SESSION_NAME>` directories. Do not delete existing directories until an explicit policy and recovery procedure are approved.
5. Investigate the bare Zsh `stepcode codex` executable path separately if StepCode’s own launcher exhibits the same defect. This task intentionally changes only the HUD wrapper and does not modify the StepCode project.
6. Measure the optional HUD update-check path independently if a reproducible startup delay is observed there. Keep it separate from the confirmed shared SQLite page-I/O fix.
