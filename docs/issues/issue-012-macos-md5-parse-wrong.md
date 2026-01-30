# [中] macOS `md5` 输出解析错误导致 session hash 恒定

## 概要
`hash_cwd` 在 macOS 分支使用 `md5`，但通过 `awk '{print $1}'` 取第一列，实际得到的是字面量 `MD5` 而非 hash。结果 `SESSION_HASH` 退化为固定值，导致跨目录 session 前缀冲突。

## 影响
- 多项目并行时 session 名称冲突。
- `--kill` 可能误杀同前缀下的其它项目会话。

## 位置
- `bin/codex-hud:44`

## 复现步骤
1. 在 macOS 上运行 `printf "%s" "$PWD" | md5`，观察输出格式为 `MD5 (stdin) = <hash>`。
2. 启动 `codex-hud`，观察 session 名称前缀是否固定为 `codex-hud-MD5`。

## 预期结果
`SESSION_HASH` 应为 cwd 的真实 hash 子串。

## 实际结果
`SESSION_HASH` 可能恒定为 `MD5`。

## 修复建议
- 对 `md5` 使用 `awk '{print $NF}'` 或 `sed 's/.*= //'` 提取末尾 hash。
- 或统一使用 `md5 -q`（macOS 支持）。

## 修复记录
- 状态：已修复
- 修复人：codex
- 修复时间：2026-01-30
- 变更说明：macOS 优先使用 `md5 -q`，并在回退解析时取最后一列，确保 hash 不是固定的 `MD5`。
- 验证方式：已执行（macOS），运行 `printf "%s" "$PWD" | md5 -q` 与回退解析，结果为真实 hash；并验证不同目录 hash 子串不同（如 `/tmp` 与 `/`）。
- 验证时间：2026-01-30
