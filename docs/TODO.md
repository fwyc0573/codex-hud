# Codex-HUD Development TODO List

## Modification History

| Date       | Summary of Changes                                              |
|------------|-----------------------------------------------------------------|
| 2026-01-16 | Initial TODO list created based on analysis report              |

---

## Priority Levels

| Priority | Description | Timeline |
|----------|-------------|----------|
| **P0** | Critical - Must complete | Immediate |
| **P1** | High - Important for functionality | Today |
| **P2** | Medium - Enhances user experience | This week |
| **P3** | Low - Nice to have | When time permits |
| **P4** | Future - Long-term improvements | Backlog |

---

## P0: Critical Tasks

### P0-1: Verify Token Progress Bar Display
- [ ] Create mock rollout data for testing
- [ ] Test token progress bar rendering with various percentages
- [ ] Verify color transitions (green→yellow→red)
- [ ] Test context breakdown display at ≥85%
- [ ] Validate token count formatting (K, M suffixes)

**Acceptance Criteria:**
- Progress bar displays correctly for 0%, 25%, 50%, 75%, 100%
- Colors change at correct thresholds (70%, 85%)
- Token counts formatted as "12.5K", "1.2M"

**Verification Method:**
```bash
# Run with mock data
CODEX_HUD_MOCK=1 node dist/index.js
```

---

## P1: High Priority Tasks

### P1-1: Add Git Repository Testing
- [ ] Create test in a git repository
- [ ] Verify branch name display
- [ ] Test dirty state indicator (*)
- [ ] Test ahead/behind indicators
- [ ] Test file stats (modified, added, deleted, untracked)

**Acceptance Criteria:**
- Branch name shows in magenta
- Dirty indicator (*) shows in yellow when uncommitted changes exist
- Format: `git:(branch-name*)`

**Verification Method:**
```bash
# Run in a git repository
cd /path/to/git/repo && /local/ycfeng/codex-hud/bin/codex-hud
```

### P1-2: Verify Active Codex Session Detection
- [ ] Test session finder with real Codex session
- [ ] Verify rollout file parsing
- [ ] Test tool activity tracking
- [ ] Verify real-time updates via file watcher

**Acceptance Criteria:**
- Session detected within 5 seconds
- Tool calls appear in activity line
- Token usage updates in real-time

---

## P2: Medium Priority Tasks

### P2-1: Execution Status Bar Spinning Animation
- [ ] Implement spinner animation for running tools
- [ ] Test spinner frame rotation (◐◓◑◒)
- [ ] Verify animation timing (~100ms per frame)
- [ ] Test with long-running operations

**Acceptance Criteria:**
- Spinner rotates smoothly
- Shows tool name and truncated description
- Format: `◐ ToolName: description...`

**Verification Method:**
```bash
# Visual inspection during active Codex session
```

### P2-2: History Operation Folding Display
- [ ] Implement consecutive operation folding
- [ ] Test count display (×N)
- [ ] Verify success/failure indicators
- [ ] Test multiple tool types in history

**Acceptance Criteria:**
- Consecutive same operations show as `✓ Bash ×6`
- Failed operations show as `✗ Error ×1`
- Different tool types separated by `|`

---

## P3: Low Priority Tasks

### P3-1: Responsive Layout Optimization
- [ ] Test on various terminal widths (80, 120, 160 cols)
- [ ] Implement compact mode for narrow terminals
- [ ] Add dynamic bar width adjustment
- [ ] Test with terminal resize events

**Acceptance Criteria:**
- HUD renders correctly on 80-column terminal
- Compact mode activates for height ≤2 lines
- No line wrapping or overflow

**Verification Method:**
```bash
# Test with different terminal sizes
stty cols 80 && node dist/index.js
stty cols 120 && node dist/index.js
```

### P3-2: Error Handling and Graceful Degradation
- [ ] Test with missing config file
- [ ] Test with invalid TOML syntax
- [ ] Test with unreadable rollout files
- [ ] Implement fallback displays

**Acceptance Criteria:**
- HUD continues to function with missing data
- Shows "N/A" or default values for missing info
- No crashes on invalid input

---

## P4: Future Tasks

### P4-1: User Configuration File Support
- [ ] Design config schema (`~/.codex-hud.json` or `~/.codex-hud.toml`)
- [ ] Implement config loading
- [ ] Add customization options:
  - [ ] Show/hide components
  - [ ] Custom colors
  - [ ] Bar width
  - [ ] Refresh interval
- [ ] Document configuration options

**Acceptance Criteria:**
- Config file is optional (defaults work)
- All display options can be customized
- Invalid config shows warning, uses defaults

### P4-2: Performance Optimization
- [ ] Profile render loop performance
- [ ] Optimize file watching (reduce CPU)
- [ ] Implement caching for static data
- [ ] Add benchmark tests

**Acceptance Criteria:**
- Render loop < 10ms
- CPU usage < 1% when idle
- Memory usage stable over time

### P4-3: Plugin System
- [ ] Design plugin API
- [ ] Implement custom line renderers
- [ ] Add event hooks for extensions
- [ ] Create example plugins

---

## Completed Tasks

| Task | Completed | Notes |
|------|-----------|-------|
| Fix compile errors in header.ts | 2026-01-16 | Added default layout fallback |
| Add Codex module status types | 2026-01-16 | configsCount, extensionsCount, workMode |
| Implement work mode detection | 2026-01-16 | detectWorkMode() function |
| Update environment line renderer | 2026-01-16 | Shows configs, mode, extensions |

---

## Notes

- All tasks should include verification steps
- Update PROGRESS.md after completing each task
- Create test cases for critical functionality
- Document any deviations from original specification
