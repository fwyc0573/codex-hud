# cx-continue

Keeps codex CLI sessions alive across upstream capacity outages.

When the model provider runs out of capacity, codex stops mid-task with:

```
⚠ Selected model is at capacity. Please try a different model.
```

The session is not broken; it is waiting for someone to nudge it. `cx-continue` watches
your codex panes and sends `continue` for you, every 5 seconds, until the session picks up
where it left off.

## How it works

codex runs inside tmux, which is both readable and writable from outside:

1. **Discover** — every tmux pane whose process tree contains a codex process. New codex
   sessions are picked up automatically; nothing to register.
2. **Inspect** — read the pane once a second and check three things.
3. **Inject** — when all three agree the session is stalled, type `continue` and press
   Enter, at most once every 5 seconds per pane.

codex itself is untouched: not patched, not wrapped, not restarted.

## The three safety signals

A retry fires only when all three hold:

| Signal | Why it matters |
|--------|----------------|
| The capacity error is near the bottom of the pane | An error still sitting in scrollback from an hour ago is not a reason to retry |
| `esc to interrupt` is absent | Its presence means a turn is in flight; interrupting healthy work is worse than doing nothing |
| The composer is empty | Injecting into a composer that holds your half-written prompt would submit `your textcontinue` |

The composer check relies on a detail of codex's rendering: the placeholder hint is drawn
dim, and text you type is not. A composer whose content is entirely dim is empty. Any pane
whose composer cannot be positively classified as empty is skipped rather than guessed at.

## Usage

Use `cx-continue-ctl` for day-to-day operation. It keeps a pidfile so `status` can answer
honestly and `start` refuses to launch a second daemon (two daemons would each inject on
their own schedule, doubling the submission rate).

```bash
cd cx-continue

./bin/cx-continue-ctl start     # start in the background
./bin/cx-continue-ctl status    # is it running, and what is each pane doing
./bin/cx-continue-ctl stop      # stop it
./bin/cx-continue-ctl restart   # stop then start
./bin/cx-continue-ctl logs      # follow the log
```

`status` reports live per-pane state, so you can tell at a glance what the watchdog sees:

```
cx-continue: RUNNING (pid 1824227, up 00:02)
  option: --log-file /data/ycfeng/tmp/cx-continue.log
  panes:
    codex-hud-frontier-...-3477279:%0   idle
    codex-hud-frontier-...-147052:%14   working
    codex-hud-frontier-...-1056487:%34  STALLED - being retried
  log: /data/ycfeng/tmp/cx-continue.log
```

Exit code is 0 when running and 1 when not, so it works in scripts:

```bash
./bin/cx-continue-ctl status >/dev/null && echo up || echo down
```

Options for the daemon are passed straight through `start`:

```bash
./bin/cx-continue-ctl start --retry-interval 10
./bin/cx-continue-ctl start --exclude-session my-interactive-session
```

### After a reboot

Nothing starts automatically. Run `./bin/cx-continue-ctl start` once per boot.

### New codex sessions

Panes are rediscovered on every poll, not snapshotted at startup, so codex sessions you
open later are picked up on their own. Verified: a session created 13 minutes after the
daemon started was detected and retried within 1 second.

### Running the daemon directly

`bin/cx-continue` is the daemon itself, useful for one-off inspection:

```bash
./bin/cx-continue --dry-run --verbose   # report what it would do, send nothing
./bin/cx-continue --once --verbose      # one inspection pass, then exit
```

### Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--interval SECONDS` | `1.0` | How often panes are inspected |
| `--retry-interval SECONDS` | `5.0` | Minimum gap between injections into the same pane |
| `--retry-text TEXT` | `continue` | What gets submitted |
| `--confirmations N` | `2` | Consecutive polls that must agree before injecting |
| `--tail-lines N` | `12` | Trailing lines searched for the error |
| `--exclude-session NAME` | — | Session to leave alone (repeatable) |
| `--only-session NAME` | — | Restrict to these sessions (repeatable) |
| `--dry-run` | off | Report without sending |
| `--once` | off | Single pass, then exit |
| `--log-file PATH` | — | Also append logs to a file |
| `-v, --verbose` | off | Log every decision, including skips |

`--confirmations` exists because codex repaints in stages. A single capture can catch a
frame where the error is drawn but the working indicator is not, and requiring two
consecutive polls to agree removes that race at a cost of one poll interval.

## Requirements

- tmux (codex must run inside it, which `codex-hud` already does)
- Python 3.9+, standard library only

## Verification

```bash
python3 -m pytest tests/unit -q     # 55 tests, no tmux needed
python3 -m pytest tests/e2e -q      # 5 tests, drives a fake codex in a scratch tmux session
```

The unit tests classify byte-exact captures from real codex panes, including one capture of
an actual outage and its recovery. The e2e tests run the real daemon against a fake codex
TUI in a throwaway session, and are fenced with `--only-session` so they can never reach a
real codex session.

Confirmed against a live stalled session on 2026-08-13: detected, injected once, and the
session resumed within 3 seconds. See
`task_memory/task_2026-08-13_cx_continue/test_report_2026-08-13_cx_continue.md`.

## Layout

```
bin/cx-continue                     # the daemon
bin/cx-continue-ctl                 # start / stop / status / logs
src/cx_continue/tmux.py             # the only module that shells out to tmux
src/cx_continue/detect.py           # pure pane classification
src/cx_continue/monitor.py          # retry policy
src/cx_continue/cli.py              # daemon loop
tests/integration/fake_codex_tui.py # fake codex for e2e
```

## Known limits

- codex must run inside tmux. A codex started in a bare terminal is invisible.
- Only the capacity error is handled. Websocket drops and other transport stalls are
  listed in `task_memory/task_2026-08-13_cx_continue/future.md`.
