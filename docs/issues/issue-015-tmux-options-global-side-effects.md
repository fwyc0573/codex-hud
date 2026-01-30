# [中] tmux 选项使用 -g 全局设置导致副作用

## 概要
创建 session 时对多个 tmux 选项使用 `-g` 设置全局值（mouse、escape-time、history-limit 等），会影响用户所有 tmux 会话，而不是仅当前 HUD session。

## 影响
- 全局 tmux 行为被静默更改。
- 影响其它项目/窗口的输入与滚动体验。

## 位置
- `bin/codex-hud:402-408`

## 复现步骤
1. 在 tmux 中设置非默认的 `mouse` 或 `history-limit`。
2. 启动 `codex-hud`。
3. 观察全局配置被覆盖。

## 预期结果
配置仅影响当前 session 或明确告知用户。

## 实际结果
全局配置被覆盖。

## 修复建议
- 去掉 `-g`，改用 session 级 `tmux set-option -t "$SESSION_NAME"`。
- 或在退出时恢复之前的全局设置。

## 修复记录
- 状态：已修复
- 修复人：codex
- 修复时间：2026-01-30
- 变更说明：移除 `-g` 全局参数，改为对当前 session 设置 tmux 选项。
- 验证方式：已执行（tmux 3.5a；创建临时 session 设置 `-t` 选项后全局选项保持不变；不支持 `wheel-scroll-lines` 的情况下已跳过该项）。
