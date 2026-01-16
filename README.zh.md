<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
  <a href="./README.zh.md"><img src="https://img.shields.io/badge/lang-中文-red.svg" alt="中文"></a>
</p>

# Codex HUD

OpenAI Codex CLI 的实时状态栏 HUD。

> **注意**: 这是一个与 Codex CLI 配合使用的包装工具，灵感来源于 Claude Code 的 [claude-hud](https://github.com/jarrodwatts/claude-hud)。

## 快速开始（一键安装）

```bash
# 克隆并安装
git clone https://github.com/your-repo/codex-hud.git
cd codex-hud
./install.sh

# 现在只需输入 'codex' - HUD 会自动显示！
```

就是这么简单！安装完成后，输入 `codex` 将自动启动并显示 HUD。

## 功能特性

### 第一阶段（基础功能）
- **模型显示**: 显示来自 `~/.codex/config.toml` 的当前模型
- **Git 状态**: 分支名称和脏状态指示器
- **项目信息**: 当前目录和项目名称
- **会话计时器**: 会话开始后的时间
- **MCP 服务器**: 已配置的 MCP 服务器数量
- **审批策略**: 当前审批策略设置
- **AGENTS.md 检测**: 项目中 AGENTS.md 文件的数量

### 第二阶段（高级功能）✨ 新增
- **Token 使用量**: 带进度条的实时 Token 消耗显示
  - 从会话回放文件读取 (`~/.codex/sessions/`)
  - 显示输入/输出 Token 数量
  - 带颜色编码的可视化进度条
- **工具活动追踪**: 监控工具调用
  - 显示最近的工具调用次数
  - 显示会话中的总工具调用次数
  - 解析回放日志中的 `function_call` 条目
- **文件监听**: 使用 chokidar 实现事件驱动更新
  - 监听 config.toml 的更改
  - 监听活动会话的回放文件
- **会话自动检测**: 自动查找活动的 Codex 会话
  - 搜索 `~/.codex/sessions/` 目录结构
  - 优先选择最近修改的会话

### 第三阶段（无缝集成）✨ 新增
- **自动安装 tmux**: 如果未安装则自动安装 tmux
- **Shell 别名集成**: `codex` 命令自动启动带 HUD 的版本
- **会话复用**: 相同目录复用现有的 tmux 会话
- **可配置 HUD 位置**: 顶部或底部（通过环境变量）
- **一键安装/卸载**: 简单的设置和移除

## 系统要求

- **Node.js** 18+
- **OpenAI Codex CLI** 已安装并在 PATH 中
- **tmux**（如果缺失会自动安装）

## 安装

### 推荐：自动安装

```bash
# 克隆仓库
git clone https://github.com/your-repo/codex-hud.git
cd codex-hud

# 运行安装程序
./install.sh
```

安装程序将会：
1. 安装 Node.js 依赖
2. 构建 TypeScript 项目
3. 添加 shell 别名使 `codex` → `codex-hud`
4. 如果未安装 tmux 则提示安装

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
source ~/.bashrc
```

## 卸载

```bash
./uninstall.sh
```

这将会：
- 移除 shell 别名
- 终止所有正在运行的 codex-hud 会话
- 显示备份的原始别名位置（如果有）

## 使用方法

安装后，像往常一样使用 `codex`：

```bash
# 基本用法 - HUD 自动显示
codex

# 带参数（传递给 codex）
codex --model gpt-5

# 带初始提示
codex "help me debug this"
```

### 其他命令

```bash
# 终止当前目录的现有会话
codex-hud --kill

# 列出所有 codex-hud 会话
codex-hud --list

# 显示帮助
codex-hud --help
```

### 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `CODEX_HUD_POSITION` | HUD 面板位置：`bottom`、`top` | `bottom` |
| `CODEX_HUD_HEIGHT` | HUD 面板高度（行数） | `3` |
| `CODEX_HUD_NO_ATTACH` | 如果设置，总是创建新会话 | （未设置） |

示例：
```bash
# 将 HUD 放在顶部
CODEX_HUD_POSITION=top codex

# 更高的 HUD
CODEX_HUD_HEIGHT=5 codex
```

## 显示格式

包装器创建一个 tmux 会话，包含：
- **主面板**（90%）：Codex CLI
- **HUD 面板**（10%）：状态栏

```
[gpt-5.2-codex] │ my-project git:(main) ● │ ⏱️ 12m │ 🎫 ████░░░░ 50.2K/12.5K
MCP: 3 │ Approval: on-req │ AGENTS.md: 2
Tools: ✓ 15 (234 total)
```

### 第一行：标题
- `[model-name]` - 当前模型
- `project-name` - 当前目录名称
- `git:(branch)` - Git 分支（如果在仓库中）
- `●` - 脏状态指示器（有未提交的更改）
- `⏱️ duration` - 会话持续时间
- `🎫 progress input/output` - 带进度条的 Token 使用量

### 第二行：详细信息
- `MCP: N` - 已启用的 MCP 服务器数量
- `Approval: policy` - 审批策略
- `AGENTS.md: N` - AGENTS.md 文件数量
- `Sandbox: mode` - 沙箱模式（如果已配置）

### 第三行：活动
- `Tools: ✓ N` - 最近的工具调用（已完成）
- `(N total)` - 会话中的总工具调用次数

## 配置

HUD 从 `~/.codex/config.toml` 读取配置。

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
- 位置：`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- 格式：包含 `token_count` 事件的 `event_msg` 条目的 JSONL
- 字段：`input_tokens`、`output_tokens`、`cached_input_tokens`

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
│   ├── types.ts               # 类型定义
│   ├── collectors/
│   │   ├── codex-config.ts    # 解析 ~/.codex/config.toml
│   │   ├── git.ts             # Git 状态收集
│   │   ├── project.ts         # 项目信息收集
│   │   ├── rollout.ts         # 解析会话回放文件（第二阶段）
│   │   ├── session-finder.ts  # 查找活动会话（第二阶段）
│   │   └── file-watcher.ts    # 基于 chokidar 的监听器（第二阶段）
│   └── render/
│       ├── colors.ts          # ANSI 颜色工具
│       ├── header.ts          # 状态行渲染
│       └── index.ts           # 主渲染器
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
3. **需要包装器启动**: 必须使用 `codex-hud` 而不是直接使用 `codex`
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
