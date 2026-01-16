# Repository Guidelines

## Project Structure & Module Organization

- `src/`: TypeScript source (ESM, `moduleResolution: NodeNext`).
- `src/collectors/`: Data collectors (git status, Codex config, session/rollout parsing, file watching).
- `src/render/`: HUD rendering utilities (colors, header/layout rendering).
- `bin/`: Executable wrapper entrypoint (`bin/codex-hud`) used by the shell alias.
- `dist/`: Compiled JavaScript output from `tsc` (what actually runs).
- `tests/`: Lightweight validation scripts (`*.sh` and `*.ts`) used for manual / integration checks.
- `install.sh` / `uninstall.sh`: End-user install/remove helpers (alias + tmux integration).

## Build, Test, and Development Commands

```bash
npm install          # Install deps
npm run build        # Compile src/ -> dist/ (strict TS)
npm run dev          # Watch mode (tsc --watch)
npm start            # Run node dist/index.js
npm run test:render  # Build + run renderer (quick smoke run)
```

Manual integration checks (be careful):

```bash
bash tests/test-e2e.sh   # Uses tmux and may kill existing tmux server
bash tests/test-install.sh
```

## Coding Style & Naming Conventions

- TypeScript: keep `strict`-safe; prefer explicit types at module boundaries.
- ESM imports: use `.js` extensions in TS imports (so emitted JS matches Node ESM).
- Filenames: kebab-case in `src/` (e.g., `file-watcher.ts`); symbols: `camelCase` for functions, `PascalCase` for types.
- Formatting: no enforced formatter in-repo; match surrounding code style and run `npm run build` before pushing.

## Testing Guidelines

- There is no dedicated test runner (no Jest/Vitest). Tests are scripts in `tests/`.
- Shell scripts validate wrapper behavior; TS scripts exercise collectors/rendering.
- Prefer adding a small focused script alongside related tests (e.g., `tests/test-<feature>.ts`) and document how to run it.

## Commit & Pull Request Guidelines

- Commit messages follow a lightweight Conventional Commits style when possible: `docs: ...`, `chore: ...`, `feat: ...`, `fix: ...`.
- PRs should include: what changed, how to verify (commands + expected output), and any UX impact (screenshot/snippet of HUD output if relevant).
- If touching installer behavior, call out shell config changes and any tmux-side effects.

## Configuration & Safety Notes

- Runtime reads local Codex files (e.g., `~/.codex/config.toml`, `~/.codex/sessions/`). Avoid logging sensitive paths/contents by default.
- Integration scripts may stop tmux sessions; warn users and keep destructive actions explicit.
