## Modification History

| Date       | Summary of Changes                          |
|------------|---------------------------------------------|
| 2026-01-30 | Initialize notes for PR merge workflow      |

# Notes

## PR Context
- PR #2 branch: fix1 (commit 7e05a02, 5abdac3).
- Key files: src/collectors/rollout.ts, src/index.ts, bin/codex-hud, bin/codex-hud-resize.
- README changes in PR must be ignored and kept as main.

## Known Requirements
- Fix rollout offset regression during incremental parse.
- Set CODEX_HUD_HEIGHT_AUTO default to 1 and implement width-based auto height.
- Ensure parseQueued is checked after parse completes.
- Add .kiro/ and .serena/ to .gitignore.
