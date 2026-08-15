"""Retry policy: decide which codex panes to nudge, and when.

The clock and the tmux adapter are injected so the whole policy is testable without a
tmux server and without real time passing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from . import detect
from .tmux import Pane

LOGGER = logging.getLogger("cx_continue")

DEFAULT_RETRY_INTERVAL = 5.0
DEFAULT_RETRY_TEXT = "continue"


@dataclass
class PaneRecord:
    """Per-pane retry bookkeeping."""

    last_retry_at: float | None = None
    retry_count: int = 0
    consecutive_stall_observations: int = 0


@dataclass
class RetryEvent:
    """One injection the monitor performed."""

    pane: Pane
    at: float
    retry_count: int


@dataclass
class Monitor:
    """Watches codex panes and injects a continue when one has a retryable stall.

    ``retry_interval`` bounds how often a single pane may be nudged. Polling is faster
    than the retry interval so that detection is prompt while the injection rate stays
    at the configured cadence.

    ``confirmations`` is the number of consecutive polls that must agree a pane is stalled
    before the first injection. codex repaints its screen in stages, so a single capture
    can catch a transient frame where the error is on screen but the working indicator has
    not been drawn yet. Requiring agreement across polls removes that race without slowing
    real recovery appreciably.
    """

    tmux_module: object
    retry_interval: float = DEFAULT_RETRY_INTERVAL
    retry_text: str = DEFAULT_RETRY_TEXT
    tail_lines: int = detect.DEFAULT_TAIL_LINES
    confirmations: int = 2
    dry_run: bool = False
    skip_sessions: frozenset[str] = frozenset()
    # When non-empty, only these sessions are eligible. The default (empty) watches every
    # discovered codex session; an allowlist is an opt-in restriction.
    only_sessions: frozenset[str] = frozenset()
    records: dict[str, PaneRecord] = field(default_factory=dict)

    def _record(self, pane: Pane) -> PaneRecord:
        return self.records.setdefault(pane.pane_id, PaneRecord())

    def _forget_missing(self, live_pane_ids: set[str]) -> None:
        for pane_id in list(self.records):
            if pane_id not in live_pane_ids:
                del self.records[pane_id]

    def tick(self, now: float) -> list[RetryEvent]:
        """One polling pass. Returns the injections performed."""
        panes = self.tmux_module.list_codex_panes()
        self._forget_missing({p.pane_id for p in panes})

        events: list[RetryEvent] = []
        for pane in panes:
            event = self._handle_pane(pane, now)
            if event is not None:
                events.append(event)
        return events

    def _handle_pane(self, pane: Pane, now: float) -> RetryEvent | None:
        if pane.session in self.skip_sessions:
            return None
        if self.only_sessions and pane.session not in self.only_sessions:
            return None

        # A pane in copy mode is being read or scrolled by the user. Keys sent to it are
        # interpreted as copy-mode navigation, not composer input, so injecting there
        # would both fail to retry and disturb the user's scroll position.
        if pane.in_copy_mode:
            LOGGER.debug("%s in copy mode, skipping", pane)
            return None

        pane_text = self.tmux_module.capture(pane.pane_id)
        if pane_text is None:
            LOGGER.debug("%s vanished before capture", pane)
            return None

        state = detect.classify(pane_text, tail_lines=self.tail_lines)
        record = self._record(pane)

        if not state.should_retry:
            if record.consecutive_stall_observations:
                LOGGER.info(
                    "%s no longer stalled (working=%s composer_empty=%s), "
                    "resetting after %d retries",
                    pane,
                    state.is_working,
                    state.composer_empty,
                    record.retry_count,
                )
            record.consecutive_stall_observations = 0
            return None

        record.consecutive_stall_observations += 1
        if record.consecutive_stall_observations < self.confirmations:
            LOGGER.debug(
                "%s looks stalled (%d/%d confirmations)",
                pane,
                record.consecutive_stall_observations,
                self.confirmations,
            )
            return None

        if record.last_retry_at is not None:
            elapsed = now - record.last_retry_at
            if elapsed < self.retry_interval:
                LOGGER.debug(
                    "%s stalled but throttled (%.1fs of %.1fs elapsed)",
                    pane,
                    elapsed,
                    self.retry_interval,
                )
                return None

        if self.dry_run:
            LOGGER.info("%s stalled on a retryable error; would send %r", pane, self.retry_text)
            record.last_retry_at = now
            return RetryEvent(pane=pane, at=now, retry_count=record.retry_count)

        sent = self.tmux_module.send_text_and_enter(pane.pane_id, self.retry_text)
        if not sent:
            LOGGER.debug("%s vanished before send", pane)
            return None

        record.last_retry_at = now
        record.retry_count += 1
        LOGGER.info(
            "%s stalled on a retryable error; sent %r (attempt %d)",
            pane,
            self.retry_text,
            record.retry_count,
        )
        return RetryEvent(pane=pane, at=now, retry_count=record.retry_count)
