# [中] HUD 切换快捷键以全局方式绑定

## 概要
`tmux bind-key -T prefix H` 未指定目标 session，导致绑定为全局，可能覆盖用户已有的 `Prefix+H` 绑定，并在 codex-hud 退出后仍然生效。

## 影响
- 影响用户全局 tmux 快捷键行为。
- 难以定位来源，需手动解绑或重启 tmux server。

## 位置
- `bin/codex-hud:468`

## 复现步骤
1. 在 tmux 中配置自定义 `Prefix+H`。
2. 运行 `codex-hud`。
3. 观察全局绑定被覆盖。

## 预期结果
绑定仅对当前 session 生效，退出后不影响其它会话。

## 实际结果
全局绑定被覆盖。

## 修复建议
- 使用 `tmux bind-key -T prefix -t "$SESSION_NAME"` 进行 session 级绑定。
- 或在退出时恢复旧绑定。

## 修复记录
- 状态：待修复
- 修复人：codex
- 修复时间：2026-01-30
- 变更说明：尝试改为 session 级绑定 `bind-key -t "$SESSION_NAME"`，但 tmux 3.5a 不支持 `-t`，已回退为全局绑定，问题仍存在。
- 验证方式：已执行（tmux 3.5a 独立 server；先绑定 `Prefix+H` 为自定义，再执行全局 `bind-key -T prefix H`，观察绑定被覆盖，确认仍为全局副作用）。
