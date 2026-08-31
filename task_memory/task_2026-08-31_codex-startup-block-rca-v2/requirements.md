## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-31 | Captured the current startup-blocking request and affected entry points. |

### Modification Record

- Motivation: Preserve the user's raw startup-blocking request as the single source of truth.
- Expectation: Implementation and final reporting remain aligned with all seven original requirements.
- Method: Recorded the three affected entry points, both supplied hypotheses, live-safety boundary, fail-fast/evidence rule, resume requirement, route coverage, and test/report placement verbatim in requirement form.
- Result: The task scope is explicit and can be checked against `plan.md`, the test report, and the final summary.

## Requirements

1. [Original Request] 深入调查通过 `cx`、`scx`、`stepcode codex` 启动 Codex CLI 长时间阻塞且不显示 Codex CLI pane 的根因，并修复根因。
2. [Original Request] 独立评估 SQLite I/O/lock contention 与 `codex-hud`/tmux lifecycle 两个假设，给出可复现证据。
3. [Original Request] 保持当前工作的 Codex、StepCode、tmux server、tmux client、session、进程和工作目录不受影响。
4. [Original Request] 采用 fail-fast、证据闭环和直接验证；不通过临时缩放或吞错逻辑掩盖故障。
5. [Original Request] 保持 resume 可用：原 thread、rollout 和历史 turns 在退出后仍可恢复。
6. [Original Request] 覆盖 `cx`、`scx` 以及实际经过 HUD 的 Bash `stepcode codex`；对绕过 HUD 的裸 StepCode 路径记录边界并避免未经证实的跨项目改动。
7. [Original Request] 测试脚本放在 `tests/`，测试报告放在本任务目录并记录完整命令、环境、实际数值和日志证据。
