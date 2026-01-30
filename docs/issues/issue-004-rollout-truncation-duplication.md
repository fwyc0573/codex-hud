# [中] 日志截断/轮转导致统计翻倍

## 概要
当 `fromOffset` 超过文件大小时会从 0 重新解析，但 `RolloutParser.parse()` 仍合并旧缓存，造成 `totalCalls/callsByType/recentCalls` 重复累加。

## 影响
- 工具统计翻倍，HUD 可信度下降。
- 长时间运行后数值失真。

## 位置
- `src/collectors/rollout.ts:118`
- `src/collectors/rollout.ts:321`

## 复现步骤
1. 触发多次工具调用生成 rollout。
2. 截断/轮转 rollout 文件（或模拟 truncate）。
3. 再次触发增量解析。

## 预期结果
从头解析时应重置累计统计。

## 实际结果
累计统计被重复累加。

## 修复建议
- 当检测到 truncation 时清空 cachedResult/lastOffset。
- 或在 parseRolloutFile 返回 truncation 标志，并上层重置统计。

## 修复记录
- 状态：已修复
- 修复人：codex
- 修复时间：2026-01-29
- 变更说明：检测截断后清理缓存与 runningCalls，避免重复累加。
- 验证方式：未执行；建议模拟 truncate 后观察计数是否重置。
