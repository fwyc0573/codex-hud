# [中] macOS 缺少 md5sum 导致 session 前缀退化

## 概要
macOS 默认无 `md5sum`，当前管道产出空 hash，`SESSION_PREFIX` 退化为 `codex-hud-`，同机多目录会话可能冲突，`--kill` 可能误杀全部会话。

## 影响
- 多项目并行时 session 名称冲突。
- kill/list 行为不精准。

## 位置
- `bin/codex-hud:23`

## 复现步骤
1. 在 macOS 上运行 `codex-hud`。
2. 观察 session 名称前缀是否包含 hash。

## 预期结果
前缀应稳定且区分目录。

## 实际结果
前缀退化为 `codex-hud-`。

## 修复建议
- macOS 使用 `md5` 命令替代；或使用 `shasum -a 256`。
- 统一封装 hash 生成逻辑并具备兼容分支。

## 修复记录
- 状态：已修复
- 修复人：codex
- 修复时间：2026-01-29
- 变更说明：兼容 md5sum/md5/shasum 生成目录 hash，避免前缀退化。
- 验证方式：未执行；建议在 macOS 上检查 session 前缀是否含 hash。
