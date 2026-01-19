# Technology Stack

## Runtime & Language

- **Node.js** 18+ (ES2022 target)
- **TypeScript** 5.x with strict mode
- **ES Modules** (`"type": "module"` in package.json)

## Dependencies

| Package | Purpose |
|---------|---------|
| `@iarna/toml` | Parse TOML config files |
| `chokidar` | File system watching |

## Dev Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `@types/node` | Node.js type definitions |

## Build Configuration

- **Module System**: NodeNext (ESM)
- **Output Directory**: `dist/`
- **Source Directory**: `src/`
- **Source Maps**: Enabled
- **Declaration Files**: Generated

## Common Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Watch mode (rebuild on changes)
npm run dev

# Run the HUD directly
npm start
# or
node dist/index.js

# Test render output
npm run test:render
```

## External Requirements

- **tmux**: Required for split-pane display (auto-installed by installer)
- **OpenAI Codex CLI**: Must be installed and in PATH
- **Git**: For repository status detection

## File Conventions

- Use `.js` extension in imports (TypeScript compiles to ESM)
- Export types from `types.ts`
- Use `execSync` for shell commands with timeout protection
