# Bug Fix Plan

## Assumptions and Clarifications
- Rollout JSONL files are not guaranteed to be LF-only or newline-terminated; parser will handle LF/CRLF and missing trailing newline safely.
- "Shared" session mode must work on macOS without coreutils; use md5/md5sum/shasum fallback for hashing.
- A small test-only guard in `bin/codex-hud` is acceptable to allow sourcing helper functions without running tmux.

## Priority-Ordered Task Breakdown

### High Priority
- H1: Fix incremental tool call tracking so outputs update calls that started before the current parse offset.
- H2: Fix offset tracking for CRLF and missing trailing newline, and reset cached state safely on truncation.

### Medium Priority
- M1: Add macOS-friendly hashing fallback for shared session naming.
- M2: Escape codex arguments and paths safely to avoid quote breakage and injection.

### Low Priority
- L1: Improve MCP process detection specificity to reduce false positives for generic binaries.

## Technical Approach

### H1: Incremental tool call tracking
- Persist a `runningCalls` map across parses in `RolloutParser`.
- Pass the map into `parseRolloutFile` so `function_call_output` can update existing running calls.
- Ensure running calls remain visible in recent calls even when no new lines are parsed.

### H2: Offset tracking for CRLF and missing newline
- Replace readline-based byte counting with buffer-level byte tracking using `StringDecoder`.
- Track bytes read from stream directly (buffer length) to keep offsets accurate for CRLF.
- Skip partial first line when starting from a non-line boundary.
- Reset cached result and running calls when file truncates (offset > file size).

### M1: macOS shared session hashing
- Add `hash_cwd` helper that prefers `md5sum`, then `md5`, then `shasum`.
- Keep behavior identical when hash tools are missing (fallback to PID).

### M2: Shell argument quoting
- Add `shell_escape` helper to safely quote arguments and paths.
- Apply `shell_escape` to codex args, cwd, and HUD node path.

### L1: MCP process detection specificity
- Build a regex pattern from the full command array, escaping metacharacters.
- Use `execFileSync` with `pgrep -f` to avoid shell interpolation issues.

## Testing Strategy
- Unit tests:
  - `tests/test-rollout-incremental.js`: H1/H2 coverage (running call completion, CRLF offsets, missing newline).
  - `tests/test-wrapper-helpers.sh`: M1/M2 coverage (hash fallbacks, shell_escape round-trip).
  - `tests/test-mcp-status.js`: L1 coverage (pattern matches a spawned node process).
- Integration tests:
  - `npm run build` to ensure TypeScript compile passes.
  - Optional: `node dist/index.js` in a tmux pane or `bash tests/test-session-detection.ts` via `npx tsx`.
- Platform-specific:
  - Run `tests/test-wrapper-helpers.sh` on macOS to validate hash fallback behavior.
- Edge cases:
  - CRLF files and missing trailing newline handled via `tests/test-rollout-incremental.js`.
  - Arguments with quotes/spaces covered via `tests/test-wrapper-helpers.sh`.
- Performance:
  - Spot-check parsing runtime on a large rollout file if available (manual timing).

## Risk Assessment
- Parser changes may drop partial lines if offsets are misaligned; mitigated by boundary check and tests.
- Shell quoting changes may alter legacy argument behavior; mitigated by round-trip test.
- MCP pattern may be too strict; mitigated by ordering-only match and fallback to stopped on error.

## Rollback Plan
- Revert the branch to the previous commit.
- Restore prior `parseRolloutFile` and `bin/codex-hud` behavior.
- Re-run `npm run build` to reset `dist/`.
