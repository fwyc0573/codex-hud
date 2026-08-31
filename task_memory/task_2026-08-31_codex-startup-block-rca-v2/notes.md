## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-31 | Recorded runtime, safety, and environment reminders. |
| 2026-08-31 | Recorded the user-initiated tmux shutdown after the completed safety audit. |

### Modification Record

- Motivation: Preserve operational constraints discovered during the RCA without mixing them into requirements or design decisions.
- Expectation: Future runs use persistent workspace paths, avoid live-state writes, and account for known runtime versions and historical references.
- Method: Recorded the live tmux read-only boundary, `/data/ycfeng/tmp` policy, observed tool versions, historical commit context, and the prohibition on deleting or repairing existing SQLite files.
- Result: Controlled probes and documentation follow the recorded environment and safety reminders.

## Notes

- The default tmux server is live and must remain read-only during investigation and validation.
- Temporary logs, sockets, homes, and PTY captures belong under `/data/ycfeng/tmp`.
- Current runtime versions observed: Node 20.11.0, StepCode 1.2.77, native Codex 0.144.4, tmux 3.4, Bash 5.2.21, Python 3.12.3.
- Current source `main@874f352` has no `CODEX_SQLITE_HOME` implementation; historical commits `b9ca074` and `e5494b9` are reference evidence only until reimplemented and tested.
- Do not delete or repair any existing SQLite file; no cleanup of old launch directories is in scope.
- After the read-only safety audit completed, the user reported killing all tmux sessions. A subsequent probe returned `status=1` with `No such file or directory` for the default socket; this external action is separate from the wrapper changes.
