<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
  <a href="./README.zh.md"><img src="https://img.shields.io/badge/lang-中文-red.svg" alt="中文"></a>
  <a href="./README.ja.md"><img src="https://img.shields.io/badge/lang-日本語-green.svg" alt="日本語"></a>
  <a href="./README.ko.md"><img src="https://img.shields.io/badge/lang-한국어-orange.svg" alt="한국어"></a>
</p>

# Codex HUD

[OpenAI Codex CLI](https://github.com/openai/codex) 的实时状态栏 HUD。轻量、零配置、在 tmux 中运行。

> 灵感来源于 Claude Code 的 [claude-hud](https://github.com/jarrodwatts/claude-hud)。

![Codex HUD — 单 Session 模式](./doc/fig/2a00eaf0-496a-4039-a0ce-87a9453df30d.png)

## 为什么需要 Codex HUD？

**Q: Codex CLI 本身就能用，为什么还需要 HUD？**

因为没有它你就是在盲飞。Codex HUD 在终端底部提供一个持久的仪表盘：

- **分支、模型、权限** —— 一目了然，不用猜
- **Token 用量（含 cache）** —— 精确知道烧了多少上下文
- **Context 窗口填充条** —— 快撞墙时提前知道
- **MCP 服务器状态 & 工具调用** —— 看 Codex 实际在干什么
- **Reasoning effort 级别** —— 当前思考深度一目了然

**Q: 我同时跑多个 Codex session，能一起监控吗？**

可以。按 `Ctrl+T` 切换到**多 Session 概览模式**，一屏显示所有活跃 session 的 context 使用情况。

![Codex HUD — 多 Session 概览](./doc/fig/6d0edbdd-19b5-4038-b9a3-ca5341fd39d1.png)

**Q: 需要手动配置 tmux 吗？**

不需要。Codex HUD 自动激活 tmux。只需输入 `codex`，HUD 就会出现。如果没装 tmux，安装程序也会搞定。

## 快速开始

```bash
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
./bin/codex-hud-install

# 刷新 shell，然后直接输入：
codex
```

### 管理命令

首次安装后，以下命令自动加入 shell：

| 命令 | 说明 |
|------|------|
| `codex-hud-sync` | 重新构建并刷新当前 checkout 的别名 |
| `codex-hud-upgrade` | 拉取最新代码后重新构建 |
| `codex-hud-uninstall` | 移除别名并停止 HUD 会话 |

## HUD 显示了什么？

```
[gpt-5.4 xhigh] █████░░░░ 45% │ my-project git:(main ●) │ 12m
mode: dev | 3 extensions | 2 AGENTS.md | Approval: on-req | Sandbox: ws-write
Tokens: 50.2K (in: 35.0K, cache: 5.0K, out: 15.2K) | Ctx: ████░░░░ 45% (50.2K/128K) ↻2
Dir: ~/my-project | Session: abc12345 | CLI: 0.4.2
◐ Edit: file.ts | ✓ Read ×3
```

| 行 | 内容 |
|----|------|
| **标题** | 模型 + effort、context 进度条、项目名、git 分支、会话计时 |
| **环境** | 配置数、工作模式、MCP 服务器、指令文件、审批/沙箱策略 |
| **Tokens** | 总 token（输入/cache/输出拆分）、context 填充率、compact 次数 |
| **Session** | 工作目录、Session ID、CLI 版本 |
| **活动** | 正在执行的工具调用、最近工具调用历史 |

## 使用方法

```bash
codex                        # 启动并自动显示 HUD
codex --model gpt-5          # 传递 Codex CLI 参数
codex "help me debug this"   # 带初始提示
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
| `CODEX_HUD_HEIGHT` | 终端 1/6 | HUD 高度（行数） |
| `CODEX_HUD_MOUSE` | `1` | 启用鼠标/触控板滚动 |

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
| `CODEX_HUD_CWD` | （未设置） | 覆盖工作目录 |
| `CODEX_HOME` | `~/.codex` | Codex home 目录 |
| `CODEX_SESSIONS_PATH` | （未设置） | 覆盖 sessions 目录 |

</details>

### config.toml

HUD 从 `CODEX_HOME/config.toml` 读取配置：

```toml
model = "gpt-5.2-codex"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

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
| Windows | 待测试 |

## 开发

```bash
npm install && npm run build   # 构建
npm run dev                    # 监听模式
node dist/index.js             # 直接运行 HUD
```

## 更新日志

| 日期 | 变更 |
|------|------|
| 2026-04-09 | 新增快速安装/同步/升级/卸载命令 |
| 2026-04-09 | HUD 按 tmux pane 绑定会话；显示 reasoning effort |
| 2026-02-09 | 修复 resize 后主 pane 焦点漂移；优化鼠标滚动默认行为 |
| 2026-02-09 | 更新会话复用默认策略与滚动配置 |

## 许可证

MIT

## 致谢

灵感来源于 Jarrod Watts 的 [claude-hud](https://github.com/jarrodwatts/claude-hud)。为 [OpenAI Codex CLI](https://github.com/openai/codex) 构建。
