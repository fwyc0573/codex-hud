# Bug Fix Todo

## High Priority
- [ ] H1: Persist running tool calls across incremental parses. Files: `src/collectors/rollout.ts:73` `src/collectors/rollout.ts:280` | Depends on: none | Est: 3h
- [ ] H2: Byte-accurate offsets and truncation reset. Files: `src/collectors/rollout.ts:103` `src/collectors/rollout.ts:308` | Depends on: H1 | Est: 3h

## Medium Priority
- [ ] M1: macOS hash fallback for shared sessions. Files: `bin/codex-hud:22` `bin/codex-hud:118` | Depends on: none | Est: 1h
- [ ] M2: Safe argument quoting in tmux commands. Files: `bin/codex-hud:335` `bin/codex-hud:399` | Depends on: M1 | Est: 1h

## Low Priority
- [ ] L1: MCP process detection specificity. Files: `src/collectors/mcp-status.ts:12` | Depends on: none | Est: 1h

## Tests and Docs
- [ ] Add rollout parser tests. Files: `tests/test-rollout-incremental.js:1` | Depends on: H1,H2 | Est: 1h
- [ ] Add wrapper helper tests. Files: `tests/test-wrapper-helpers.sh:1` | Depends on: M1,M2 | Est: 1h
- [ ] Add MCP status tests. Files: `tests/test-mcp-status.js:1` | Depends on: L1 | Est: 1h
- [ ] Build and update dist output. Files: `dist/*` | Depends on: all code changes | Est: 0.5h
- [ ] Document plan and todos. Files: `bug_fix_plan.md:1` `bug_fix_todo.md:1` | Depends on: none | Est: 0.5h
