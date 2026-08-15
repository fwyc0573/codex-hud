<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
  <a href="./README.zh.md"><img src="https://img.shields.io/badge/lang-中文-red.svg" alt="中文"></a>
  <a href="./README.ja.md"><img src="https://img.shields.io/badge/lang-日本語-green.svg" alt="日本語"></a>
  <a href="./README.ko.md"><img src="https://img.shields.io/badge/lang-한국어-orange.svg" alt="한국어"></a>
</p>

# Codex HUD

[OpenAI Codex CLI](https://github.com/openai/codex) 的实时状态栏 HUD。轻量、零配置、在 tmux 中运行。

## Windows WSL 支持

Windows 支持已在 `feature/windows-support-dual-entry` branch 通过 Ubuntu WSL 提供。macOS/Linux 用户使用 `main`；Windows (WSL) 用户使用该 feature branch。

> 灵感来源于 Claude Code 的 [claude-hud](https://github.com/jarrodwatts/claude-hud)。

![Codex HUD — 单 Session 模式](./doc/fig/screenshot.png)

## 更新动态

- **[2026-08-15]** 新增对 OpenAI 上游 “capacity exceeded” 的自动监测与自动 “continue” 处理。用法参见 `cx-continue/README.md`。
- **[2026-07-20]** 发布首个正式版本 v1.0，完整支持 macOS 和 Linux。

## 为什么需要 Codex HUD？

**Q: Codex CLI 本身就能用，为什么还需要 HUD？**

因为没有它你就是在盲飞。Codex HUD 在终端底部提供一个持久的仪表盘：

- **tmux** —— 零配置原生在优化过的 tmux 中运行 Codex CLI（可上下滑动查看对话记录）
- **自动 continue** —— 自动监测 OpenAI “capacity exceeded” 阻断，并发送 “continue” 恢复任务
- **分支、模型、权限、模式** —— 一目了然，不用猜
- **MCP 服务器状态 & 工具调用、skills & agent 动作** —— 看 Codex 实际在干什么
- **Context 窗口填充条** —— 图形化显示何时即将触顶

**Q: 我同时跑多个 Codex session，能一起监控吗？**

可以。按 `Ctrl+T` 切换到**多 Session 概览模式**，一屏显示所有活跃 session 的 context 使用情况。

![Codex HUD — 多 Session 概览](./doc/fig/6d0edbdd-19b5-4038-b9a3-ca5341fd39d1.png)

**Q: 需要手动配置 tmux 吗？**

不需要。Codex HUD 自动激活 tmux。只需输入 `codex`，HUD 就会出现。如果没装 tmux，安装程序也会搞定。

如果你已经在 tmux pane 中运行 `codex`、`cx` 或 `codex-hud`，wrapper 会在同一个
tmux socket 上打开嵌套 client，并保留外层 session。关闭 HUD 后会返回原来的 pane。

## 快速开始

### 一句话安装（交给 agent）

```bash
按照 codex-hud (https://github.com/fwyc0573/codex-hud) 的 README.md 指引，为 Codex CLI 安装它。若要开启自动监测 Codex “capacity exceeded” 并自动发送 “continue”，请进入 cx-continue/ 目录执行 ./bin/cx-continue-ctl start。
```

### macOS/Linux（`main`）

```bash
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
git switch main
./bin/codex-hud-install

# 刷新 shell，然后直接输入：
codex

# 若要开启自动监测 Codex “capacity exceeded” 并自动发送 “continue”，请使用：
cd cx-continue
./bin/cx-continue-ctl start     # 后台启动
./bin/cx-continue-ctl status    # 是否运行，以及各 pane 正在做什么
./bin/cx-continue-ctl stop      # 停止
./bin/cx-continue-ctl restart   # 先停止再启动
./bin/cx-continue-ctl logs      # 跟踪日志
```

### Windows (WSL)（`feature/windows-support-dual-entry`）

```powershell
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
git switch feature/windows-support-dual-entry
.\bin\codex-hud-install.ps1

# 打开新的 PowerShell 或 cmd 窗口，然后检查：
codex --self-check

# 使用 WSL HUD 启动：
codex
```

### 管理命令

首次安装后，以下命令自动加入 shell：

| 命令 | 说明 |
|------|------|
| `cx` | 使用 HUD 启动 Codex（与 `codex` 使用同一个 wrapper） |
| `codex-hud-sync` | 重新构建并刷新当前 checkout 的别名 |
| `codex-hud-upgrade` | 事务化拉取、验证并启用最新 build |
| `codex-hud-uninstall` | 移除别名并停止 HUD 会话 |

## HUD 显示了什么？

```
[gpt-5.4 xhigh] █████░░░░ 45% │ my-project git:(main ●) │ 12m
3 extensions | 3 skills | 2 hooks | 2 AGENTS.md | Approval: ask for approval | Fast: on | Sandbox: ws-write
Ctx: ████░░░░ 45% (50.2K/128K) | Tokens: 50.2K | (in: 35.0K, cache: 5.0K, out: 15.2K) | ↻2
Dir: ~/my-project | Session: abc12345 | CLI: 0.4.2
◐ Edit: file.ts | ✓ Read ×3
◐ codex_cli_explore 2m14s ↳2
```

| 行 | 内容 |
|----|------|
| **标题** | 模型 + effort、context 进度条、项目名、git 分支、会话计时 |
| **环境** | 配置数、MCP 服务器、启用的 skills/hooks、指令文件、审批/沙箱策略和 Fast mode |
| **Tokens** | 总 token（输入/cache/输出拆分）、context 填充率、compact 次数 |
| **Session** | 工作目录、Session ID、CLI 版本 |
| **活动** | 正在执行的工具调用、最近工具调用历史和活跃 subagent |

Approval 会根据 Codex 最新运行时 permission 显示为 `ask for approval`、
`approve for me` 或 `full access`。Codex 运行过程中修改 permission 后，HUD 会在
不重启 session 的情况下刷新显示。HUD 创建的 tmux session 使用易区分的项目名格式，
例如 `codex-hud-new-topic-research-a1b2c3d4-20260727220308-2505832`。
`Fast: on` 表示当前 service tier 为 priority，`Fast: off` 表示 default。skills 和 hooks
统计当前 cwd 的 effective configured scopes 中有效且启用的 entries。统计使用 5 秒进程内缓存，skills/hooks 文件变化通常会在约 5 秒内显示。wrapper 会直接在 tmux pane 中启动 Codex，
因此 attach 时不会把启动命令回显到终端。默认 HUD 高度为 5 行；需要其他固定高度时
可设置 `CODEX_HUD_HEIGHT`。

### Subagent 活动

展开模式为每个可见的直接子节点显示一行 icon-first 状态，例如 `◐ codex_cli_explore 2m14s ↳2`。名称取自 typed agent path 的最后一段；`↳N` 表示任意深度下可见的活跃后代数量。turn 完成或 abort 后会立即消失；只有仍有活跃后代时，直接子节点的聚合行才会继续保留。权威 rollout 或 metadata 跟踪失败会显示为 `✗ <name> tracking error`，并持续重试同一条 typed child path，直到恢复。

紧凑模式显示 `Agents: N`；`N` 统计 root 所拥有整棵树中的所有可见 agent 节点，而不只是展开模式中的直接子节点行。多 Session 概览会排除 typed subagent session，因为它们的活动已经归入所属 root session。

`CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS` 控制 running turn 的不活跃窗口。默认值为 `900000` ms（15 分钟），只接受以毫秒表示的正 safe integer；空值、无效值、零、负数、小数或 unsafe integer 会在启动时直接报错。timeout 只隐藏陈旧的界面显示，不会中断 agent，也不能证明 agent 已卡死或 crash。`starting` 和 `tracking error` 不受该 timeout 影响。

## 使用方法

```bash
codex                        # 启动并自动显示 HUD
codex --model gpt-5          # 传递 Codex CLI 参数
codex "help me debug this"   # 带初始提示
cx                           # 使用更短的命令启动同一个 HUD wrapper
codex-resume                 # 恢复上次会话
```

<details>
<summary>更多命令</summary>

```bash
codex-hud --kill             # 终止当前目录的会话
codex-hud --list             # 列出所有 HUD 会话
codex-hud --attach           # 复用已有会话
codex-hud --new-session      # 强制新建会话
codex-hud --self-check       # 运行环境诊断
```

</details>

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CODEX_HUD_POSITION` | `bottom` | HUD 面板位置（`top` / `bottom`） |
| `CODEX_HUD_HEIGHT` | 5 行 | HUD 高度（行数） |
| `CODEX_HUD_MOUSE` | `1` | 启用鼠标/触控板滚动 |
| `CODEX_HUD_UPDATE_CHECK` | 启用 | 检查 GitHub 正式 Release 并提供延后更新（设为 `0`/`false` 可禁用） |

<details>
<summary>全部环境变量</summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CODEX_HUD_HEIGHT_AUTO` | `0` | 根据宽度自动调整高度 |
| `CODEX_HUD_HEIGHT_MIN` | `CODEX_HUD_HEIGHT` | 自动模式最小高度 |
| `CODEX_HUD_HEIGHT_MAX` | `12` | 自动模式最大高度 |
| `CODEX_HUD_AUTO_ATTACH` | `0` | 自动复用同目录最新会话 |
| `CODEX_HUD_ALTERNATE_SCREEN` | `0` | codex pane 的 tmux alternate-screen |
| `CODEX_HUD_CLEAR_SCROLLBACK` | `0` | 首次渲染时清理 scrollback |
| `CODEX_HUD_BIND_TOGGLE` | `0` | 可选启用旧版 server-wide Prefix+H HUD 切换快捷键 |
| `CODEX_HUD_UPDATE_CHECK` | 启用 | 每 12 小时最多检查一次新的稳定 GitHub Release，并在 session 退出后询问是否更新 |
| `CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS` | `900000` | running agent 的界面 timeout；只接受正 safe integer 毫秒值 |
| `CODEX_HUD_CWD` | （未设置） | 覆盖工作目录 |
| `CODEX_HOME` | `~/.codex` | Codex home 目录 |
| `CODEX_SESSIONS_PATH` | （未设置） | 覆盖 sessions 目录 |

</details>

### Update 提醒

每个新建的 `codex`、`cx`、`codex-resume` 或直接 `codex-hud` session 都会检查
GitHub 正式 Release；复用已有 session 时不会打断当前会话。发现更高稳定版本
时，交互式终端会显示：

```text
[codex-hud] Update available: v旧 → v新. Update after this session exits? [Y/n]
```

确认后先记录请求，等新 tmux session 成功登记 checkout 专属 close hook 后才完成调度。
普通 detach 会保留 Codex session，不触发更新。tmux session 真正关闭后，updater 会
fetch 精确的 fast-forward target，并在隔离 staging worktree 中安装依赖和 build；只有
预构建成功才推进 active checkout，因此 dependency 或 build 失败时 HEAD/worktree 保持
不变。状态和日志保存在 checkout 之外的 `$XDG_STATE_HOME/codex-hud/`（未设置时为
`~/.local/state/codex-hud/`）。设置 `CODEX_HUD_UPDATE_CHECK=0` 或 `false` 可完全关闭
检查；`codex-hud-upgrade` 手动升级也使用同一事务流程。

### config.toml

HUD 从 `CODEX_HOME/config.toml` 读取配置：

```toml
model = "gpt-5.2-codex"
approval_policy = "on-request"
sandbox_mode = "workspace-write"
service_tier = "priority"
hooks = true

[mcp_servers.my-server]
command = ["node", "server.js"]
enabled = true
```

## 系统支持

| 平台 | 状态 |
|------|------|
| Linux | 已支持 |
| macOS (Apple Silicon) | 已支持 |
| macOS (Intel) | 待测试 |
| Windows (WSL) | 已在 `feature/windows-support-dual-entry` 支持 |

## 开发

```bash
npm install && npm run build   # 构建
npm run dev                    # 监听模式
node dist/index.js             # 直接运行 HUD
```

## 许可证

MIT

## 致谢

灵感来源于 Jarrod Watts 的 [claude-hud](https://github.com/jarrodwatts/claude-hud)。为 [OpenAI Codex CLI](https://github.com/openai/codex) 构建。
