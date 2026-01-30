## Modification History

| Date       | Summary of Changes                          |
|------------|---------------------------------------------|
| 2026-01-30 | Create task plan for PR merge requirements  |

# Plan

## Goal
Merge PR #2 with README preserved from main, fix parsing/auto-height/race issues, update .gitignore, and complete tests + report.

## Steps
1. Fetch PR branch and prepare merge while preserving README from main.
2. Implement code fixes: rollout offset, parse race, auto height width logic + default.
3. Update .gitignore to exclude .kiro/ and .serena/.
4. Build, add unit tests for changes, run comprehensive validation, write test report.
5. Verify README unchanged and summarize merge.

## Acceptance Criteria
- README.md and README.zh.md identical to main branch versions.
- Rollout parsing offset never regresses during file growth.
- CODEX_HUD_HEIGHT_AUTO defaults to 1 and auto mode uses pane width to derive height.
- parseQueued race resolved by post-parse check.
- .gitignore includes .kiro/ and .serena/.
- Tests executed with report saved under task_memory.
