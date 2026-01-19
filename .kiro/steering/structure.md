# Project Structure

```
codex-hud/
├── bin/
│   └── codex-hud              # Bash wrapper script (creates tmux session)
├── src/
│   ├── index.ts               # Main entry point, render loop, signal handling
│   ├── types.ts               # All TypeScript type definitions
│   ├── collectors/            # Data collection modules
│   │   ├── codex-config.ts    # Parse ~/.codex/config.toml
│   │   ├── git.ts             # Git status (branch, dirty, ahead/behind)
│   │   ├── project.ts         # Project info (cwd, AGENTS.md count)
│   │   ├── rollout.ts         # Parse session rollout JSONL files
│   │   ├── session-finder.ts  # Find active Codex sessions
│   │   └── file-watcher.ts    # chokidar-based file watchers
│   └── render/
│       ├── index.ts           # Main renderer, terminal control
│       ├── colors.ts          # ANSI color utilities
│       ├── header.ts          # Status line composition
│       └── lines/             # Individual line renderers
│           ├── index.ts       # Line renderer exports
│           ├── identity-line.ts
│           ├── project-line.ts
│           ├── session-line.ts
│           ├── activity-line.ts
│           ├── environment-line.ts
│           └── usage-line.ts
├── tests/                     # Test scripts and mocks
├── docs/                      # Documentation and progress tracking
├── dist/                      # Compiled JavaScript output
├── install.sh                 # Installation script
└── uninstall.sh               # Uninstallation script
```

## Architecture Pattern

**Collector → Data → Renderer**

1. **Collectors** (`src/collectors/`): Gather data from various sources
   - Config files, git commands, file system, session rollouts
   - Each collector is independent and returns typed data

2. **Types** (`src/types.ts`): Central type definitions
   - All interfaces defined in one place
   - Shared between collectors and renderers

3. **Renderers** (`src/render/`): Transform data to terminal output
   - `lines/` contains modular line renderers
   - `colors.ts` provides ANSI color helpers
   - `header.ts` composes lines into final output

## Key Data Flow

```
SessionFinder → RolloutParser → HudData → renderHud() → stdout
     ↓              ↓
FileWatcher ←──────┘
```

## Adding New Features

- **New data source**: Add collector in `src/collectors/`
- **New display element**: Add line renderer in `src/render/lines/`
- **New type**: Define in `src/types.ts`
