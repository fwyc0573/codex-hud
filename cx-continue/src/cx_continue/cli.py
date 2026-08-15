"""Command-line entry point and daemon loop."""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import time
from logging.handlers import RotatingFileHandler

from . import __version__, detect, tmux
from .monitor import DEFAULT_RETRY_INTERVAL, DEFAULT_RETRY_TEXT, Monitor

DEFAULT_POLL_INTERVAL = 1.0
LOG_TOTAL_LIMIT_BYTES = 100 * 1024 * 1024
LOG_BACKUP_COUNT = 3

LOGGER = logging.getLogger("cx_continue")

_stop_requested = False


def _request_stop(signum, _frame) -> None:
    global _stop_requested
    _stop_requested = True
    LOGGER.info("received signal %d, shutting down", signum)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cx-continue",
        description=(
            "Watch tmux-hosted codex CLI sessions and automatically send 'continue' "
            "when a session stalls on a provider capacity or stream-disconnection error."
        ),
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=DEFAULT_POLL_INTERVAL,
        metavar="SECONDS",
        help=f"how often to inspect panes (default: {DEFAULT_POLL_INTERVAL}s)",
    )
    parser.add_argument(
        "--retry-interval",
        type=float,
        default=DEFAULT_RETRY_INTERVAL,
        metavar="SECONDS",
        help=(
            "minimum gap between two injections into the same pane "
            f"(default: {DEFAULT_RETRY_INTERVAL}s)"
        ),
    )
    parser.add_argument(
        "--retry-text",
        default=DEFAULT_RETRY_TEXT,
        metavar="TEXT",
        help=f"text to submit on retry (default: {DEFAULT_RETRY_TEXT!r})",
    )
    parser.add_argument(
        "--confirmations",
        type=int,
        default=2,
        metavar="N",
        help=(
            "consecutive polls that must agree a pane is stalled before injecting; "
            "guards against transient repaint frames (default: 2)"
        ),
    )
    parser.add_argument(
        "--tail-lines",
        type=int,
        default=detect.DEFAULT_TAIL_LINES,
        metavar="N",
        help=(
            "how many trailing pane lines to search for the capacity error; keeps an old "
            f"error in scrollback from triggering retries (default: {detect.DEFAULT_TAIL_LINES})"
        ),
    )
    parser.add_argument(
        "--exclude-session",
        action="append",
        default=[],
        metavar="NAME",
        help="tmux session to leave alone (repeatable)",
    )
    parser.add_argument(
        "--only-session",
        action="append",
        default=[],
        metavar="NAME",
        help=(
            "restrict monitoring to these tmux sessions (repeatable); the default is to "
            "watch every codex session discovered"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be sent without sending anything",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="run a single inspection pass and exit",
    )
    parser.add_argument(
        "--log-file",
        metavar="PATH",
        help="write logs to this rotating file",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="log every decision, including skips",
    )
    parser.add_argument("--version", action="version", version=f"cx-continue {__version__}")
    return parser


def configure_logging(verbose: bool, log_file: str | None) -> None:
    LOGGER.setLevel(logging.DEBUG if verbose else logging.INFO)
    LOGGER.propagate = False
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)-7s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )

    for handler in list(LOGGER.handlers):
        LOGGER.removeHandler(handler)
        handler.close()

    if log_file:
        segment_bytes = LOG_TOTAL_LIMIT_BYTES // (LOG_BACKUP_COUNT + 1)
        file_handler = RotatingFileHandler(
            log_file,
            maxBytes=segment_bytes,
            backupCount=LOG_BACKUP_COUNT,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        LOGGER.addHandler(file_handler)
        return

    stream_handler = logging.StreamHandler(sys.stderr)
    stream_handler.setFormatter(formatter)
    LOGGER.addHandler(stream_handler)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    configure_logging(args.verbose, args.log_file)

    if not tmux.tmux_available():
        LOGGER.error("tmux not found on PATH; cx-continue observes codex through tmux")
        return 2

    if args.interval <= 0:
        LOGGER.error("--interval must be positive")
        return 2
    if args.retry_interval <= 0:
        LOGGER.error("--retry-interval must be positive")
        return 2

    monitor = Monitor(
        tmux_module=tmux,
        retry_interval=args.retry_interval,
        retry_text=args.retry_text,
        tail_lines=args.tail_lines,
        confirmations=max(1, args.confirmations),
        dry_run=args.dry_run,
        skip_sessions=frozenset(args.exclude_session),
        only_sessions=frozenset(args.only_session),
    )

    signal.signal(signal.SIGINT, _request_stop)
    signal.signal(signal.SIGTERM, _request_stop)

    mode = "dry-run" if args.dry_run else "active"
    LOGGER.info(
        "cx-continue %s starting (%s): poll %.1fs, retry every %.1fs, text %r",
        __version__,
        mode,
        args.interval,
        args.retry_interval,
        args.retry_text,
    )

    panes = tmux.list_codex_panes()
    LOGGER.info(
        "watching %d codex pane(s): %s",
        len(panes),
        ", ".join(str(p) for p in panes) or "none yet",
    )

    while not _stop_requested:
        try:
            monitor.tick(time.monotonic())
        except tmux.TmuxError as error:
            # Surfaced rather than swallowed: an unexpected tmux failure means the
            # watchdog is not doing its job and the user needs to know.
            LOGGER.error("tmux error: %s", error)
        if args.once:
            break
        time.sleep(args.interval)

    LOGGER.info("cx-continue stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
