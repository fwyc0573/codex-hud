<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
  <a href="./README.zh.md"><img src="https://img.shields.io/badge/lang-中文-red.svg" alt="中文"></a>
</p>

# Codex HUD

![Codex HUD](./doc/fig/2a00eaf0-496a-4039-a0ce-87a9453df30d.png)

OpenAI Codex CLI 的实时状态栏 HUD。

> **注意**: 这是一个与 Codex CLI 配合使用的包装工具，灵感来源于 Claude Code 的 [claude-hud](https://github.com/jarrodwatts/claude-hud)。

## 快速开始（一键安装）

```bash
# From the repository root
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
./install.sh

# 关闭并重新打开终端或使用 `source ~/.bashrc` 或 `source ~/.zshrc` 刷新 shell 环境。
# 现在只需输入 'codex' - HUD 自动显示！
```

就是这么简单！安装完成后，输入 `codex` 将自动启动并显示 HUD。

## 功能特性

### 第一阶段（基础功能）
- **模型显示**: 显示来自 `config.toml` 的当前模型
- **Git 状态**: branch、dirty 指示、ahead/behind 以及变更统计
- **项目信息**: 项目名称和工作目录
- **会话计时器**: 会话开始后的时间
- **配置/模式信号**: `.codex` config 数量、work mode、extensions（MCP servers）
- **指令信号**: AGENTS.md、INSTRUCTIONS.md 和 `.codex/rules` 计数
- **审批策略 + Sandbox**: 显示 approval policy 和 sandbox mode（如果配置）

### 第二阶段（高级功能）✨ 新增
- **Token + Context Usage**: 实时 Token 与 context window 使用
  - 从 rollout 的 `token_count`、`turn_started` 事件读取
  - 使用 `last_token_usage` 和 baseline token 预留
  - 显示 `/compact` 次数（`context_compacted`）
- **工具活动追踪**: 监控工具调用
  - 显示最近的工具调用次数
  - 显示会话中的总工具调用次数
  - 解析回放日志中的 `function_call` 条目
- **文件监听**: 使用 chokidar 实现事件驱动更新
  - 监听 config.toml 的更改
  - 监听活动会话的回放文件
- **会话自动检测**: 自动查找活动的 Codex 会话
  - 按 session CWD 过滤，搜索近期会话（默认 30 天）
  - 优先选择最近修改的会话

### 第三阶段（无缝集成）✨ 新增
- **HUD 模式切换**: 单 Session 详情 / 多 Session 概览

## 系统要求
- **tmux**（如果缺失会自动安装）
- **Codex home** 位于 `CODEX_HOME`、`~/.codex` 或 `~/.codex_home`（需存在 `sessions/` 目录或配置 `CODEX_SESSIONS_PATH`）

## HUD 模式

Codex HUD 支持两种显示模式：

1. **单 Session 模式**（默认）
  - 显示当前终端对应的 Session 详细信息。
2. **多 Session 概览模式**
  - 仅显示正在执行任务的 Session（工具调用或生成活动）。
  - 每行显示 **Context 使用率** + **Session ID**。

### 快捷键切换

- **Prefix + H**（tmux）在两种模式间切换。
- 当焦点在 HUD 面板时，也可使用 **Ctrl+T**。

## 安装

### 推荐：自动安装

```bash
# 运行安装程序
./install.sh
```

安装程序将会：
1. 安装 Node.js 依赖
2. 构建 TypeScript 项目
3. 在 `~/.bashrc` 和 `~/.zshrc` 添加别名（`codex`、`codex-resume`，并备份旧别名）
4. 如果未安装 tmux 则提示安装

安装完成后，请刷新 shell 环境使别名生效：

```bash
# Bash
source ~/.bashrc

# Zsh
source ~/.zshrc
```

或者关闭并重新打开终端。

### 手动安装

```bash
# 克隆或下载此仓库
cd codex-hud

# 安装依赖
npm install

# 构建项目
npm run build

# 使包装脚本可执行
chmod +x bin/codex-hud

# 将别名添加到 shell 配置文件 (~/.bashrc 或 ~/.zshrc)
echo "alias codex='/path/to/codex-hud/bin/codex-hud'" >> ~/.bashrc
echo "alias codex-resume='/path/to/codex-hud/bin/codex-hud resume'" >> ~/.bashrc
source ~/.bashrc
```

## 卸载

```bash
./uninstall.sh
```

这将会：
- 从常见 shell rc 文件中移除 codex-hud 别名
- 终止所有正在运行的 codex-hud session 与 HUD pane
- 如果存在备份则恢复原有别名

卸载完成后，请刷新 shell 环境使更改生效：

```bash
# Bash
source ~/.bashrc

# Zsh
source ~/.zshrc
```

或者关闭并重新打开终端。


## 支持系统

- Linux
- macOS (Apple Silicon)


## 等待测试

- Windows (testing pending)
- macOS (Intel Silicon) (testing pending)


## 使用方法

安装后，像往常一样使用 `codex`：

```bash
# 基本用法 - HUD 自动显示
codex

# 带参数（传递给 codex）
codex --model gpt-5

# 带初始提示
codex "help me debug this"

# Resume (passes through to codex CLI)
codex-resume
```

### 其他命令

```bash
# 终止当前目录的现有会话
codex-hud --kill

# 列出所有 codex-hud 会话
codex-hud --list

# 显示帮助
codex-hud --help

# Run environment diagnostics
codex-hud --self-check
```

### Codex CLI 面板滚动体验

codex-hud 会为每个 tmux 会话启用鼠标模式，以让触控板滚动在 Codex CLI 面板中更平滑、可控。

### 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `CODEX_HUD_POSITION` | HUD 面板位置：`bottom`、`top` | `bottom` |
| `CODEX_HUD_HEIGHT` | HUD 面板高度（行数） | 终端高度的 1/6（最小 3） |
| `CODEX_HUD_NO_ATTACH` | 如果设置，总是创建新会话 | （未设置） |
| `CODEX_HUD_CWD` | 覆盖 HUD 使用的工作目录（用于上下文/会话匹配） | （未设置；由 wrapper 设置） |

### 路径覆盖

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `CODEX_HOME` | Codex home 目录（config + sessions） | `~/.codex` 或 `~/.codex_home` |
| `CODEX_SESSIONS_PATH` | 覆盖 sessions 目录 | （未设置） |

示例：
```bash
# 将 HUD 放在顶部
CODEX_HUD_POSITION=top codex

# 更高的 HUD
CODEX_HUD_HEIGHT=5 codex
```

Note: HUD height is clamped to the available terminal size.

## 显示格式

包装器创建一个 tmux 会话，包含：
- **主面板**：Codex CLI
- **HUD 面板**：状态行（展开布局多行，紧凑布局单行）

```
[gpt-5.2-codex] █████░░░░ 45% │ my-project git:(main ●) │ ⏱️ 12m
1 configs | mode: dev | 3 extensions | 2 AGENTS.md | Approval: on-req | Sandbox: ws-write
Tokens: 50.2K (in: 35.0K, cache: 5.0K, out: 15.2K) | Ctx: ████░░░░ 45% (50.2K/128K) ↻2
Dir: ~/my-project | Session: abc12345 | CLI: 0.4.2 | Provider: openai
◐ Edit: file.ts | ✓ Read ×3
```

### 第一行：标题
- `[model-name]` - 当前模型
- `█████░░░░ 45%` - context 使用条（来自 session token 数据）
- `project-name` - 当前目录名称
- `git:(branch ●)` - Git 分支 + dirty 指示器（如果在仓库中）
- `⏱️ duration` - 会话持续时间

### 第二行：环境
- `N configs` - `.codex` config 数量
- `mode: dev/prod` - work mode
- `N extensions` - 已启用的 MCP servers
- `N AGENTS.md` / `N INSTRUCTIONS.md` / `N rules` - 指令信号
- `Approval: policy` - 审批策略
- `Sandbox: mode` - Sandbox 模式（如果已配置）

### 第三行：Tokens + Context
- `Tokens: N` - 总 Token（可带输入/cache/输出拆分）
- `Ctx: ███░░ 45% (used/total)` - Context 使用条与计数
- `↻N` - `/compact` 次数

### 第四行：Session 详情
- `Dir: ~/path` - 工作目录（截断显示）
- `Session: abc12345` - Session ID（短版）
- `CLI: x.y.z` / `Provider: openai` - 可选 session 元数据

### 第五行及以后：活动
- `◐ Edit: file.ts` - 正在运行的 tool call
- `✓ Read ×3` - 最近 tool call 分组与计数
- 有 plan progress 时显示进度行

当 HUD height 小于可用行数时，会以 `…N more lines hidden` 提示截断。

## 配置

HUD 从 `CODEX_HOME/config.toml` 读取配置（默认 `~/.codex/config.toml`，并回退到 `~/.codex_home/config.toml`）。

### 支持的字段

```toml
# 模型配置
model = "gpt-5.2-codex"
model_provider = "openai"

# 审批策略
approval_policy = "on-request"

# 沙箱模式
sandbox_mode = "workspace-write"

# MCP 服务器
[mcp_servers]
[mcp_servers.my-server]
command = ["node", "server.js"]
enabled = true
```

## 数据来源

### Token 使用量（第二阶段）
Token 数据从 Codex 会话回放文件中提取：
- 位置：`CODEX_SESSIONS_PATH` 或 `${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-*.jsonl`
- 格式：包含 `token_count`、`turn_started`、`context_compacted` 的 `event_msg`
- 字段：`total_token_usage`、`last_token_usage`、`model_context_window`、`cached_input_tokens`

### 工具活动（第二阶段）
从回放文件追踪工具调用：
- 类型：带有 `function_call` 和 `function_call_output` 的 `response_item`
- 追踪：工具名称、持续时间、成功/失败状态
- 显示：最近调用次数和会话总调用次数

## 架构

```
codex-hud/
├── bin/
│   └── codex-hud              # Bash 包装器（创建 tmux 会话）
├── src/
│   ├── index.ts               # 主入口点
│   ├── test-render.ts         # 渲染测试脚本
│   ├── types.ts               # 类型定义
│   ├── utils/
│   │   └── codex-path.ts      # 解析 CODEX_HOME + sessions path
│   ├── collectors/
│   │   ├── codex-config.ts    # 解析 config.toml
│   │   ├── git.ts             # Git 状态收集
│   │   ├── project.ts         # 项目信息收集
│   │   ├── rollout.ts         # 解析会话回放文件
│   │   ├── session-finder.ts  # 查找活动会话
│   │   └── file-watcher.ts    # 基于 chokidar 的监听器
│   └── render/
│       ├── colors.ts          # ANSI 颜色工具
│       ├── header.ts          # 状态行渲染
│       ├── index.ts           # 主渲染器
│       └── lines/             # 行渲染器
│           ├── activity-line.ts
│           ├── environment-line.ts
│           ├── identity-line.ts
│           ├── project-line.ts
│           ├── session-line.ts
│           └── usage-line.ts
├── dist/                      # 编译后的 JavaScript
├── package.json
└── tsconfig.json
```

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 监听模式（更改时重新构建）
npm run dev

# 直接运行 HUD（用于测试）
node dist/index.js
```

## 已知限制

1. **Token 使用量准确性**: 取决于 Codex 会话回放格式
2. **需要 tmux**: 分屏显示需要 tmux
3. **需要包装器启动**: 使用 `codex-hud`（或 `codex`/`codex-resume` 别名）才能显示 HUD
4. **会话检测延迟**: 检测新会话最多需要 5 秒

## 更新日志

### v0.2.0（第二阶段）
- 添加了带进度条的 Token 使用量显示
- 添加了工具活动追踪
- 添加了会话自动检测
- 添加了使用 chokidar 的文件监听
- 添加了回放文件解析

### v0.1.0（第一阶段）
- 初始发布
- 基本的模型、Git、项目信息显示
- MCP 服务器和审批策略显示
- tmux 包装脚本

## 许可证

MIT

## 致谢

灵感来源于 Jarrod Watts 的 [claude-hud](https://github.com/jarrodwatts/claude-hud)。

为 [OpenAI Codex CLI](https://github.com/openai/codex) 构建。
