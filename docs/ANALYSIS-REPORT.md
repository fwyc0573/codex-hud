# Codex-HUD Project Analysis Report

## Modification History

| Date       | Summary of Changes                                              |
|------------|-----------------------------------------------------------------|
| 2026-01-16 | Initial analysis report created after comprehensive code review |

---

## 1. Project Overview

Codex-HUD is a real-time statusline HUD for OpenAI Codex CLI, inspired by [claude-hud](https://github.com/jarrodwatts/claude-hud).

### Current Version: 0.1.0 (Phase 2 Complete)

**Key Features Implemented:**
- Model display from `~/.codex/config.toml`
- Git status (branch name, dirty state)
- Project info and session timer
- Token usage with progress bar
- Tool activity tracking
- File watching with chokidar
- Session auto-detection

---

## 2. Architecture

```
codex-hud/
├── bin/codex-hud              # Bash wrapper (tmux launcher)
├── src/
│   ├── index.ts               # Main entry, event loop
│   ├── types.ts               # Type definitions (extended)
│   ├── collectors/
│   │   ├── codex-config.ts    # ~/.codex/config.toml parser
│   │   ├── git.ts             # Git status collection
│   │   ├── project.ts         # Project info (extended)
│   │   ├── rollout.ts         # Session log parsing
│   │   ├── session-finder.ts  # Active session detection
│   │   └── file-watcher.ts    # chokidar file monitoring
│   └── render/
│       ├── colors.ts          # ANSI color utilities
│       ├── header.ts          # Main renderer (fixed)
│       └── lines/
│           ├── identity-line.ts    # [Model] + progress bar
│           ├── project-line.ts     # project git:(branch)
│           ├── environment-line.ts # Codex module status (updated)
│           ├── usage-line.ts       # Timer display
│           └── activity-line.ts    # Tool activity display
├── dist/                      # Compiled output
└── package.json
```

---

## 3. UI Layout Specification

### Line 1: Global Context Bar
```
[Model-Name] ████░░░░ 47% | project-name git:(branch*) | ⏱️ 1m
```

| Component | Color | Description |
|-----------|-------|-------------|
| `[Model]` | Cyan (bright) | Model name in brackets |
| Progress bar | Green→Yellow→Red | Token usage percentage |
| `project-name` | Yellow | Current directory name |
| `git:(branch)` | Magenta | Git branch name |
| `*` | Yellow | Dirty indicator |
| `⏱️ Xm` | Dim | Session duration |

### Line 2: Execution Status Bar
```
mode: dev | 2 extensions | 1 AGENTS.md | Approval: default
```

| Component | Description |
|-----------|-------------|
| `mode: dev/prod` | Work mode detection |
| `N extensions` | MCP server count |
| `N AGENTS.md` | Agent configuration files |
| `Approval: X` | Approval policy setting |

### Line 3: Activity Line (when active)
```
◑ Bash: running command... | ✓ Read ×3 | ✓ Edit ×2
```

---

## 4. Comparison with claude-hud

| Feature | claude-hud | codex-hud | Notes |
|---------|------------|-----------|-------|
| Execution Mode | One-shot (stdin) | Persistent (polling) | Adapted |
| Hooks System | PreToolUse, etc. | Not available | Removed |
| MCP Display | Detailed status | Extension count | Simplified |
| Log Format | transcript.jsonl | rollout-*.jsonl | Adapted |
| Refresh Rate | Host-controlled (~300ms) | Self-polling (~1s) | Different |

---

## 5. Fixed Issues

| Issue | Status | Fix |
|-------|--------|-----|
| Compile error in `header.ts` | ✅ Fixed | Added `layout ?? DEFAULT_LAYOUT` |
| Duplicate code block | ✅ Fixed | Removed duplicate return statement |
| Missing Codex module types | ✅ Added | `configsCount`, `extensionsCount`, `workMode` |
| Work mode detection | ✅ Implemented | `detectWorkMode()` function |
| Config file counting | ✅ Implemented | `countConfigFiles()` function |
| Environment line | ✅ Updated | Shows configs, mode, extensions |

---

## 6. Data Sources

### Token Usage
- Location: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- Format: JSONL with `event_msg` containing `token_count`
- Fields: `input_tokens`, `output_tokens`, `cached_input_tokens`

### Tool Activity
- Type: `response_item` with `function_call` and `function_call_output`
- Tracked: Tool name, duration, success/failure
- Display: Recent calls + total count

### Configuration
- Location: `~/.codex/config.toml`
- Fields: `model`, `model_provider`, `approval_policy`, `sandbox_mode`, `mcp_servers`

---

## 7. Technology Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.0+
- **Build**: tsc (TypeScript compiler)
- **Dependencies**:
  - `@iarna/toml` - TOML parsing
  - `chokidar` - File watching
- **Display**: tmux split-pane

---

## 8. Known Limitations

1. **Token usage accuracy**: Depends on Codex session rollout format
2. **Requires tmux**: Split-pane display needs tmux
3. **Wrapper launch required**: Must use `codex-hud` instead of `codex`
4. **Session detection delay**: Up to 5 seconds to detect new sessions
5. **No git repo test**: Current directory is not a git repository

---

## 9. Next Steps

See `PROGRESS.md` for current development status and `TODO.md` for task list.
