# Issues 汇总

| 编号 | 标题 | 严重性 | 状态 | 文档 |
| --- | --- | --- | --- | --- |
| 001 | Session 复用逻辑几乎不会命中 | 高 | 已修复 | docs/issues/issue-001-session-reuse.md |
| 002 | rollout 解析并发竞态导致统计不稳定 | 中 | 已修复 | docs/issues/issue-002-rollout-parse-race.md |
| 003 | 增量解析丢失跨块工具完成事件 | 中 | 已修复 | docs/issues/issue-003-rollout-cross-batch-tool-completion.md |
| 004 | 日志截断/轮转导致统计翻倍 | 中 | 已修复 | docs/issues/issue-004-rollout-truncation-duplication.md |
| 005 | macOS 缺少 md5sum 导致 session 前缀退化 | 中 | 已修复 | docs/issues/issue-005-macos-md5sum-session-prefix.md |
| 006 | 参数包含单引号时透传失败 | 低 | 已修复 | docs/issues/issue-006-tmux-arg-quote-single-quote.md |
| 007 | 小窗口模型上下文占用显示为 100% | 低 | 已修复 | docs/issues/issue-007-small-context-window-100-percent.md |
| 008 | CRLF 换行导致增量解析 offset 可能偏小 | 低 | 待讨论 | docs/issues/issue-008-rollout-crlf-offset.md |
| 009 | 增量解析在末行无换行时 offset 可能偏大并误判截断 | 中 | 待修复 | docs/issues/issue-009-rollout-offset-no-trailing-newline.md |
| 010 | rollout 读取流错误未处理导致进程崩溃 | 中 | 待修复 | docs/issues/issue-010-rollout-filestream-error-unhandled.md |
| 011 | Session Timer 使用 HUD 启动时间导致 resume 显示不准 | 低 | 待修复 | docs/issues/issue-011-session-timer-uses-hud-start.md |
| 012 | macOS `md5` 输出解析错误导致 session hash 恒定 | 中 | 已修复 | docs/issues/issue-012-macos-md5-parse-wrong.md |
| 013 | 工作目录包含单引号时启动命令失败 | 中 | 已修复 | docs/issues/issue-013-cwd-quote-breaks-command.md |
| 014 | HUD 切换快捷键以全局方式绑定 | 中 | 待修复 | docs/issues/issue-014-tmux-bind-key-global.md |
| 015 | tmux 选项使用 -g 全局设置导致副作用 | 中 | 已修复 | docs/issues/issue-015-tmux-options-global-side-effects.md |
| 016 | HUD 宽度自适应增高无效且扰乱固定高度预期 | 低 | 已修复 | docs/issues/issue-016-hud-auto-height-width-expansion.md |
