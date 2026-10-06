# kun-workspace-vgen2 PID Exhaustion RCA

## Incident

On October 6, 2026, new zsh terminals and `scx` failed with `fork: Resource temporarily unavailable`, Rust `ThreadPoolBuildError`, and Node `uv_thread_create` assertions.

## Impact

- New interactive shells could not reliably fork.
- Rust and Node processes could not create worker threads.
- `scx` could not initialize Codex/HUD.

## Root Cause

The immediate ceiling was the `brainpp` systemd user slice:

- `TasksMax` / `pids.max`: 10,331
- Observed `pids.current`: 10,186
- `RLIMIT_NPROC`: 15,654

The user slice, not `RLIMIT_NPROC`, was the tighter effective limit. Historical child-scope `pids.events` counters recorded 2,516 and 7,097 rejected task creations, confirming that task creation had been denied at the ancestor limit.

The task leak came from codex-hud resize handling:

1. HUD sessions registered a synchronous `after-resize-pane` hook with `run-shell`.
2. The hook launched `codex-hud-resize`.
3. The helper issued another `tmux resize-pane` command against the same tmux server.
4. The server could wait for the synchronous helper while the helper waited for the server, and repeated resize events created more blocked helpers/clients.
5. No per-session reentrancy guard limited concurrent helpers.

At diagnosis time there were roughly 2,913 `sh`, 2,911 `bash`, and 2,911 `tmux resize-pane` processes in the repeated resize chain.

## Recovery

- Removed the recursive hook from the active HUD sessions.
- Terminated only the exact orphaned resize-helper/client processes.
- Refreshed the HUD installation and zsh/bash aliases with `codex-hud-sync`.
- `pids.current` recovered from about 10,186 to about 1,053.

## Permanent Fix

- Resize hooks now use `run-shell -b`, so tmux never waits synchronously for a helper that sends commands back to the same server.
- `codex-hud-resize` now takes a non-blocking per-session lock:
  - `flock` where available.
  - Atomic `mkdir` fallback on systems without `flock`.
- Existing resize hooks are removed before the first resize and reinstalled afterward, allowing old sessions to be safely reconfigured.
- Regression tests cover asynchronous hook installation and concurrent-helper serialization.

## Validation

- TypeScript build passed.
- Focused resize/height tests passed.
- Adjacent wrapper, StepCode lifecycle, attach policy, nested tmux, session listing, mouse, and alternate-screen tests passed.
- A live stress test sent 200 real `resize-pane` operations:
  - pids: 1,045 → 1,052
  - final HUD height: 5
  - remaining `tmux resize-pane` clients: 0
  - remaining resize helpers: 0
- A login zsh started and forked successfully.
- Node v20.11.0 and `codex-cli 0.159.2` initialized successfully.
- `scx` initialized HUD, Node, and StepCode without resource errors; the bounded smoke test then stopped at an unrelated StepCode upgrade prompt.

## Follow-up

The non-interactive SSH default Node is v16.14.0, while the login zsh/toolchain selects v20.11.0. HUD synchronization must use `/data/ycfeng/toolchain/bin` until the system default Node is upgraded.
