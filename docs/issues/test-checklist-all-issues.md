# Issues 待测试清单（docs/issues 全量）

说明：按 issue 文件逐条给出验证点。对“待修复/待讨论”的条目，先确认修复已合入再执行验证。

## issue-001-session-reuse（待验证）
- 同一目录连续两次启动，tmux session 复用（不新增）
- 不同目录启动，session 前缀不同
- `CODEX_HUD_NO_ATTACH=1` 时不复用（或符合当前语义）
- `--list`/`--kill` 针对当前目录会话准确

## issue-002-rollout-parse-race（待验证）
- 高频工具调用 + watcher 同时触发时，统计稳定不丢失不翻倍
- 多次快速解析时，`lastOffset` 单调递增
- UI 最近调用列表不闪烁、不回退

## issue-003-rollout-cross-batch-tool-completion（待验证）
- `function_call` 与 `function_call_output` 跨批次：状态从 running 正确变为 completed/error
- duration 正确填充（>0 且接近真实耗时）
- UI 中 running 列表随输出到达而清空

## issue-004-rollout-truncation-duplication（待验证）
- 模拟 truncate 后重新解析：总数不翻倍
- truncation 后 recentCalls 重置为当前文件内容
- runningCalls 被清理且不影响新调用统计

## issue-005-macos-md5sum-session-prefix（待验证）
- macOS 上 session 前缀包含稳定 hash（非 `codex-hud-` 纯前缀）
- 同机不同目录会话不冲突
- `--kill` 只影响当前目录会话

## issue-006-tmux-arg-quote-single-quote（待验证）
- 参数包含单引号：`codex-hud "test 'quote'"` 透传完整
- 参数包含空格/双引号/反斜杠组合仍能正常透传
- tmux 中实际命令与输入一致（无截断）

## issue-007-small-context-window-100-percent（待验证）
- 8k/10k 模型显示百分比 < 100%（随负载变化）
- contextWindow <= BASELINE_TOKENS 时计算逻辑正确
- 大窗口模型显示不受影响

## issue-008-rollout-crlf-offset（待讨论/待验证）
- 使用 CRLF `.jsonl`：offset 与文件大小一致
- 连续增量解析无重复行/无 JSON 解析异常
- 若仍偏差，记录偏差量与场景

## issue-009-rollout-offset-no-trailing-newline（待验证）
- 末行无换行：`newOffset` 不超过 `fileSize`
- 追加新行（仍无末尾换行）后不触发 truncation
- 工具统计/运行中调用不被清空

## issue-010-rollout-filestream-error-unhandled（待修复/部分验证）
- ✅ 读取异常（fileStream error 模拟）：解析降级返回、进程不崩溃
- ✅ 读取中删除/移动 rollout 文件：已执行（视觉验证通过）
- ✅ 权限变化触发 error：已执行（视觉验证通过）
- ❌ error 发生后仍可恢复解析新文件：已执行（视觉验证失败：HUD 未崩溃但数据不再更新）

## issue-011-session-timer-uses-hud-start（已验证）
- ✅ session timer 基于 rollout 的 session start（优先于 HUD 启动时间）
- ✅ 切换会话时计时准确（通过模拟 SessionFinder 切换 + 渲染验证）
- ✅ session startTime 缺失时回退逻辑正确（渲染回退验证）

## issue-012-macos-md5-parse-wrong（已执行）
- macOS 上 `md5 -q` 取值正确，session 前缀包含稳定 hash
- `md5 -q` 不可用时回退解析正确（取末列而非 `MD5`）
- 不同目录 hash 子串不同，`--kill` 不误伤

## issue-013-cwd-quote-breaks-command（已执行）
- cwd 含单引号/空格/反斜杠/双引号时，`codex-hud` 启动正常
- tmux pane 中 `cd` 路径解析正确，命令无截断
- HUD 与 Codex CLI 均能正常启动

## issue-014-tmux-bind-key-global（待修复/已验证）
- ✅ 启动前自定义 `Prefix+H`，运行后被覆盖（仍为全局绑定）
- ❌ 退出后快捷键不残留副作用：已执行（仍残留，需手动恢复）
- ✅ tmux 版本 3.5a 下行为如上（全局覆盖）

## issue-015-tmux-options-global-side-effects（已执行）
- 启动后全局 tmux 选项不被改写（mouse/escape-time/history-limit 等）
- 新建 session 选项只作用于当前 HUD session
- 不支持 `wheel-scroll-lines` 时保持静默

## issue-016-hud-auto-height-width-expansion（已执行）
- 窄屏宽度下 HUD 高度保持基础值（不自动增高）
- `CODEX_HUD_HEIGHT_AUTO=1` 时高度仍受 min/max 限制
- `CODEX_HUD_HEIGHT_MIN/MAX` 生效且对 base height 不越界
