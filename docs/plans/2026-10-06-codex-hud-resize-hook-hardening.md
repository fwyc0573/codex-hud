# Codex HUD Resize Hook Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent codex-hud resize hooks from deadlocking tmux or recursively exhausting the user's pids cgroup.

**Architecture:** Keep both resize triggers, but execute their helpers asynchronously so the tmux server never waits on a client command sent back to itself. Serialize each session's helper with a non-blocking lock (`flock` on Linux, atomic `mkdir` fallback elsewhere), and remove legacy hooks before the first resize so old sessions can be safely reconfigured.

**Tech Stack:** Bash, tmux hooks, util-linux `flock` with a portable fallback, shell integration tests.

---

### Task 1: Add the regression checks

**Files:**
- Modify: `tests/integration/test-default-hud-height.sh`
- Modify: `tests/integration/test-hud-resize.sh`
- Modify: `tests/integration/fake-tmux/tmux`

**Step 1:** Assert resize hooks are unregistered before initial resize.

**Step 2:** Assert installed resize hooks use `run-shell -b`.

**Step 3:** Add a delayed fake `resize-pane` operation.

**Step 4:** Start two helpers for one session and assert only one reaches tmux.

**Step 5:** Run the focused tests and confirm they fail against the old implementation.

### Task 2: Harden the helper and hook lifecycle

**Files:**
- Modify: `bin/codex-hud-resize`
- Modify: `bin/codex-hud`

**Step 1:** Add a non-blocking per-session lock before tmux access.

**Step 2:** Unset legacy resize hooks before invoking the helper.

**Step 3:** Install `client-resized` and `after-resize-pane` using `run-shell -b`.

**Step 4:** Run focused integration tests and shell syntax checks.

### Task 3: Deploy and reconfigure

**Files:**
- Deploy the four modified runtime/test files and this plan to `/data/ycfeng/codex-hud`.

**Step 1:** Confirm only expected files differ in the dirty remote checkout.

**Step 2:** Run `npm run build` and the relevant integration tests.

**Step 3:** Run `bin/codex-hud-sync` to refresh installed aliases and entrypoints.

**Step 4:** Replace resize hooks on every active HUD session with the hardened background command.

**Step 5:** Kill only orphaned `codex-hud-resize` and `tmux resize-pane` clients.

### Task 4: Validate recovery

**Files:**
- Update the local RCA deliverable with measured results.

**Step 1:** Verify `pids.current` remains well below `pids.max`.

**Step 2:** Trigger resize hooks repeatedly and confirm no process-count growth.

**Step 3:** Start a login zsh and verify fork succeeds.

**Step 4:** Launch `scx` in a bounded smoke test and verify Node/Rust thread initialization succeeds.
