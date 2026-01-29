# [高] Session 复用逻辑几乎不会命中

## 概要
SESSION_NAME 带时间戳和 PID，check_existing_session 只检测该精确名称，导致每次都会新建 session；CODEX_HUD_NO_ATTACH 的语义也因此失效。

## 影响
- 无法复用已有会话，启动成本和资源占用增加。
- --kill/--list 的行为与用户预期不一致。

## 位置
- `bin/codex-hud:22`
- `bin/codex-hud:24`
- `bin/codex-hud:239`
- `bin/codex-hud:386`

## 复现步骤
1. 在同一目录连续执行两次 `codex-hud`。
2. 观察 tmux session 列表。

## 预期结果
第二次启动复用已有 session（或按 CODEX_HUD_NO_ATTACH 行为控制）。

## 实际结果
每次都会新建 session。

## 修复建议
- 改为按目录维度生成稳定的 session 名称；或保存/查询最近的 session id。
- check_existing_session 按前缀匹配已存在 session。
- 让 CODEX_HUD_NO_ATTACH 明确控制是否复用。

## 修复记录
- 状态：已修复
- 修复人：codex
- 修复时间：2026-01-29
- 变更说明：基于目录 hash 生成稳定前缀，并按前缀复用已有 session。
- 验证方式：未执行；建议同目录连续启动验证复用行为。
