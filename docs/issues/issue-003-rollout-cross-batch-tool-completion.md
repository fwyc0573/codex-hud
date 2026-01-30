# [中] 增量解析丢失跨块工具完成事件

## 概要
`runningCalls` 仅在单次解析内存在。若 `function_call` 在上一批、`function_call_output` 在下一批，则无法更新状态与耗时，界面会长时间显示“running”。

## 影响
- 工具状态显示不准确，耗时统计缺失。
- 影响用户对当前执行状态的判断。

## 位置
- `src/collectors/rollout.ts:95`
- `src/collectors/rollout.ts:164`
- `src/collectors/rollout.ts:185`

## 复现步骤
1. 触发一个工具调用（function_call）。
2. 等待足够时间让输出落在下一次增量解析中。

## 预期结果
工具调用在输出到达后更新为 completed/error，并带有 duration。

## 实际结果
工具调用持续显示为 running。

## 修复建议
- 将 `runningCalls` 挪到 RolloutParser 的实例级缓存。
- 或在缓存中记录未完成调用并跨次解析合并。

## 修复记录
- 状态：已修复
- 修复人：codex
- 修复时间：2026-01-29
- 变更说明：跨批次保留 runningCalls，并在输出到达时补齐完成状态与耗时。
- 验证方式：未执行；建议拉长工具执行时间验证状态刷新。
