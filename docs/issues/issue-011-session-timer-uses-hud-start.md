# [低] Session Timer 使用 HUD 启动时间导致 resume 显示不准

## 概要
会话时长以 HUD 启动时间为基准，而非 rollout 中的真实 session start time，`resume` 或切换会话时会显示偏小/偏大。

## 影响
- Session Timer 不能反映真实会话时长。
- 多次 attach/resume 时用户判断被误导。

## 位置
- `src/index.ts:25`
- `src/render/lines/usage-line.ts:32`
- `src/render/lines/session-line.ts:70`

## 复现步骤
1. 启动 Codex 会话运行一段时间。
2. 退出 HUD 后再 `resume`。
3. 观察 Session Timer 重新从 0 计时。

## 预期结果
Session Timer 基于 rollout 的 session start time 显示。

## 实际结果
基于 HUD 启动时间显示。

## 修复建议
- `renderUsageLine` 优先使用 `data.session?.startTime ?? data.sessionStart`。
- 或在 `collectData` 中将 `sessionStart` 绑定到 `rolloutData?.session?.startTime`。

## 修复记录
- 状态：已修复
- 修复人：codex
- 修复时间：2026-01-30
- 变更说明：计时展示优先使用 rollout 中 session startTime，HUD 启动时间仅作回退。
- 验证方式：未执行；建议 resume 后确认计时连续准确。
