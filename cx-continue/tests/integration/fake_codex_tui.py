#!/usr/bin/env python3
"""A fake codex TUI for end-to-end testing.

Reproduces the parts of codex's rendering that the watchdog keys on, using the byte-exact
escape sequences captured from real codex panes:

- the capacity warning, in codex's yellow,
- the retryable stream-disconnection warning, in codex's red,
- the composer with a dim placeholder when empty,
- the working indicator containing "esc to interrupt".

It reads submitted lines from stdin. Every submission is appended to a transcript file so
a test can assert exactly what the watchdog sent and when.

Two behaviours, chosen by argv:

    recover  - stalls once; the first submission recovers the session, and it then stays
               in the working state.
    persist  - stays stalled no matter how many submissions arrive, modelling a prolonged
               upstream outage.
    stream-recover - like recover, but renders the retryable stream-disconnection warning.
    stream-persist - like persist, but renders the retryable stream-disconnection warning.
"""

from __future__ import annotations

import os
import sys
import threading
import time

CAPACITY_WARNING = (
    "\x1b[38;5;3m⚠ Selected model is at capacity. Please try a different model.\x1b[39m"
)
STREAM_DISCONNECTED_WARNING = (
    "\x1b[38;5;1m■ stream disconnected before completion: "
    "stream closed before response.completed\x1b[39m"
)
COMPOSER_EMPTY = (
    "\x1b[1m›\x1b[0m\x1b[48;2;49;50;51m "
    "\x1b[2mRun /review on my current changes\x1b[0m\x1b[48;2;49;50;51m"
)
STATUS_LINE = (
    "\x1b[49m  \x1b[38;2;246;226;183mgpt-5.6-sol max\x1b[2m\x1b[39m · "
    "\x1b[0m\x1b[38;2;143;179;239mmain\x1b[39m"
)


def composer_with_text(text: str) -> str:
    """Composer holding user text: content is not dim."""
    return f"\x1b[1m›\x1b[0m\x1b[48;2;49;50;51m {text}"


class FakeCodex:
    def __init__(self, mode: str, transcript_path: str):
        self.mode = mode
        self.transcript_path = transcript_path
        self.stalled = True
        self.started_at = time.monotonic()
        self.submissions: list[str] = []
        self.pending = ""
        self.lock = threading.Lock()

    def record(self, line: str) -> None:
        with open(self.transcript_path, "a") as handle:
            handle.write(f"{time.time():.6f}\t{line}\n")
            handle.flush()

    def render(self) -> None:
        # Home the cursor and clear, mimicking a TUI repaint.
        sys.stdout.write("\x1b[H\x1b[2J")
        lines = [
            "• \x1b[0mFake codex session for cx-continue e2e testing",
            "",
            "• Explored",
            "\x1b[2m  └ \x1b[0mRead design.md, plan.md",
            "",
        ]
        with self.lock:
            stalled = self.stalled
            pending = self.pending
            count = len(self.submissions)

        if stalled:
            warning = (
                STREAM_DISCONNECTED_WARNING
                if self.mode.startswith("stream-")
                else CAPACITY_WARNING
            )
            lines += [warning, ""]
        else:
            elapsed = int(time.monotonic() - self.started_at)
            lines += [
                f"• \x1b[2mWorkin\x1b[0mg \x1b[2m({elapsed // 60}m {elapsed % 60:02d}s "
                f"• esc to interrupt)\x1b[0m",
                "",
            ]

        lines.append(composer_with_text(pending) if pending else COMPOSER_EMPTY)
        lines += ["", STATUS_LINE, f"  submissions={count}"]

        sys.stdout.write("\r\n".join(lines) + "\r\n")
        sys.stdout.flush()

    def on_submission(self, text: str) -> None:
        with self.lock:
            self.submissions.append(text)
            if self.mode in ("recover", "stream-recover"):
                self.stalled = False
                self.started_at = time.monotonic()
        self.record(f"SUBMIT\t{text}")

    def read_loop(self) -> None:
        """Consume stdin one character at a time so partial typing is visible.

        codex shows text in the composer as it is typed and only submits on Enter; the
        watchdog's composer-empty check depends on that, so the fake reproduces it.

        The terminal must be in raw mode for this to work. A tty defaults to canonical
        mode, where the kernel line discipline holds characters until Enter, so a program
        reading stdin sees nothing at all until the line is submitted. Under canonical
        mode this fake would render an empty composer while secretly holding typed text,
        and would then report a concatenated submission that no real codex could produce.
        """
        while True:
            char = sys.stdin.read(1)
            if not char:
                return
            if char in ("\r", "\n"):
                with self.lock:
                    text = self.pending
                    self.pending = ""
                if text:
                    self.on_submission(text)
            else:
                with self.lock:
                    self.pending += char

    def run(self) -> None:
        self.record(f"START\tmode={self.mode}\tpid={os.getpid()}")

        raw_mode_enabled = False
        saved_tty_attributes = None
        if sys.stdin.isatty():
            import termios
            import tty

            saved_tty_attributes = termios.tcgetattr(sys.stdin.fileno())
            tty.setcbreak(sys.stdin.fileno())
            raw_mode_enabled = True
        self.record(f"TTY\traw={raw_mode_enabled}")

        try:
            reader = threading.Thread(target=self.read_loop, daemon=True)
            reader.start()
            while True:
                self.render()
                time.sleep(0.2)
        finally:
            if saved_tty_attributes is not None:
                import termios

                termios.tcsetattr(
                    sys.stdin.fileno(), termios.TCSADRAIN, saved_tty_attributes
                )


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: fake_codex_tui.py <recover|persist> <transcript-path>", file=sys.stderr)
        return 2
    mode, transcript = sys.argv[1], sys.argv[2]
    if mode not in ("recover", "persist", "stream-recover", "stream-persist"):
        print(f"unknown mode: {mode}", file=sys.stderr)
        return 2
    FakeCodex(mode, transcript).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
