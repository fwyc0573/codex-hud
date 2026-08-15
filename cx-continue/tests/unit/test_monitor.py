"""Unit tests for the retry state machine.

The tmux adapter and the clock are both injected, so these tests exercise the full retry
policy without a tmux server and without real time passing.
"""

from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "src"))

from cx_continue.monitor import Monitor  # noqa: E402
from cx_continue.tmux import Pane  # noqa: E402

CAPACITY_LINE = (
    "\x1b[38;5;3m⚠ Selected model is at capacity. Please try a different model.\x1b[39m"
)
STREAM_DISCONNECTED_LINE = (
    "\x1b[38;5;1m■ stream disconnected before completion: "
    "stream closed before response.completed\x1b[39m"
)
EMPTY_COMPOSER = (
    "\x1b[1m›\x1b[0m\x1b[48;2;49;50;51m \x1b[2mRun /review on my current changes\x1b[0m"
)
TYPED_COMPOSER = "\x1b[1m›\x1b[0m\x1b[48;2;49;50;51m my half-written prompt"
WORKING_LINE = "• \x1b[2mWorkin\x1b[0mg \x1b[2m(1m 35s • esc to interrupt)\x1b[0m"

STALLED_PANE = "\n".join([CAPACITY_LINE, "", EMPTY_COMPOSER])
STREAM_DISCONNECTED_PANE = "\n".join([STREAM_DISCONNECTED_LINE, "", EMPTY_COMPOSER])
WORKING_PANE = "\n".join(["some output", WORKING_LINE, "", EMPTY_COMPOSER])
STALLED_BUT_TYPED = "\n".join([CAPACITY_LINE, "", TYPED_COMPOSER])


class FakeTmux:
    """Stand-in for the tmux adapter, recording what the monitor asked it to do."""

    def __init__(self, panes, screens):
        self._panes = list(panes)
        self._screens = dict(screens)
        self.sent: list[tuple[str, str]] = []
        self.capture_calls: list[str] = []
        self.send_result = True

    def list_codex_panes(self):
        return list(self._panes)

    def capture(self, pane_id):
        self.capture_calls.append(pane_id)
        return self._screens.get(pane_id)

    def send_text_and_enter(self, pane_id, text):
        if not self.send_result:
            return False
        self.sent.append((pane_id, text))
        return True

    # Test helpers
    def set_screen(self, pane_id, text):
        self._screens[pane_id] = text

    def set_panes(self, panes):
        self._panes = list(panes)


PANE_A = Pane(session="s1", pane_id="%1", pane_pid=100, in_copy_mode=False)
PANE_B = Pane(session="s2", pane_id="%2", pane_pid=200, in_copy_mode=False)
PANE_COPY_MODE = Pane(session="s3", pane_id="%3", pane_pid=300, in_copy_mode=True)


def make_monitor(fake, **kwargs):
    kwargs.setdefault("confirmations", 1)
    return Monitor(tmux_module=fake, **kwargs)


class TestBasicRetry:
    def test_injects_continue_into_stalled_pane(self):
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake)

        events = monitor.tick(now=0.0)

        assert len(events) == 1
        assert fake.sent == [("%1", "continue")]

    def test_injects_continue_into_stream_disconnected_pane(self):
        fake = FakeTmux([PANE_A], {"%1": STREAM_DISCONNECTED_PANE})
        monitor = make_monitor(fake)

        events = monitor.tick(now=0.0)

        assert len(events) == 1
        assert fake.sent == [("%1", "continue")]

    def test_retry_text_is_configurable(self):
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake, retry_text="继续之前被中断的任务")

        monitor.tick(now=0.0)

        assert fake.sent == [("%1", "继续之前被中断的任务")]

    def test_healthy_pane_is_left_alone(self):
        fake = FakeTmux([PANE_A], {"%1": WORKING_PANE})
        monitor = make_monitor(fake)

        assert monitor.tick(now=0.0) == []
        assert fake.sent == []

    def test_typed_composer_is_left_alone(self):
        """A3: never submit on top of the user's in-progress text."""
        fake = FakeTmux([PANE_A], {"%1": STALLED_BUT_TYPED})
        monitor = make_monitor(fake)

        assert monitor.tick(now=0.0) == []
        assert fake.sent == []

    def test_copy_mode_pane_is_not_captured_or_injected(self):
        fake = FakeTmux([PANE_COPY_MODE], {"%3": STALLED_PANE})
        monitor = make_monitor(fake)

        assert monitor.tick(now=0.0) == []
        assert fake.sent == []
        assert fake.capture_calls == []

    def test_vanished_pane_is_skipped(self):
        fake = FakeTmux([PANE_A], {})  # capture returns None
        monitor = make_monitor(fake)

        assert monitor.tick(now=0.0) == []
        assert fake.sent == []

    def test_failed_send_is_not_counted_as_a_retry(self):
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        fake.send_result = False
        monitor = make_monitor(fake)

        assert monitor.tick(now=0.0) == []
        assert monitor.records["%1"].retry_count == 0


class TestRetryCadence:
    def test_second_retry_is_throttled_below_the_interval(self):
        """A5: at most one injection per pane per retry interval."""
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake, retry_interval=5.0)

        monitor.tick(now=0.0)
        for now in (1.0, 2.0, 3.0, 4.0, 4.9):
            assert monitor.tick(now=now) == []

        assert fake.sent == [("%1", "continue")]

    def test_retry_fires_again_once_the_interval_elapses(self):
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake, retry_interval=5.0)

        monitor.tick(now=0.0)
        monitor.tick(now=5.0)

        assert fake.sent == [("%1", "continue"), ("%1", "continue")]

    def test_retries_are_unbounded(self):
        """A6: no attempt cap; a long outage keeps being retried."""
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake, retry_interval=5.0)

        for attempt in range(50):
            monitor.tick(now=attempt * 5.0)

        assert len(fake.sent) == 50
        assert monitor.records["%1"].retry_count == 50

    def test_cadence_holds_when_polling_is_faster_than_retrying(self):
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake, retry_interval=5.0)

        # Poll once per second for 30 simulated seconds.
        injection_times = [
            event.at for now in range(31) for event in monitor.tick(now=float(now))
        ]

        assert injection_times == [0.0, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0]
        gaps = [b - a for a, b in zip(injection_times, injection_times[1:])]
        assert all(gap >= 5.0 for gap in gaps)


class TestRecovery:
    def test_recovery_stops_retrying(self):
        """A8: once the session works again, injections stop."""
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake, retry_interval=5.0)

        monitor.tick(now=0.0)
        assert len(fake.sent) == 1

        fake.set_screen("%1", WORKING_PANE)
        for now in (5.0, 10.0, 15.0, 100.0):
            assert monitor.tick(now=now) == []

        assert len(fake.sent) == 1

    def test_stall_observation_counter_resets_on_recovery(self):
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake, confirmations=2)

        monitor.tick(now=0.0)
        assert monitor.records["%1"].consecutive_stall_observations == 1

        fake.set_screen("%1", WORKING_PANE)
        monitor.tick(now=1.0)
        assert monitor.records["%1"].consecutive_stall_observations == 0


class TestConfirmations:
    def test_single_transient_frame_does_not_trigger_injection(self):
        """A transient repaint frame must not be enough to inject."""
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake, confirmations=2)

        assert monitor.tick(now=0.0) == []
        assert fake.sent == []

    def test_sustained_stall_triggers_after_enough_confirmations(self):
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake, confirmations=2)

        monitor.tick(now=0.0)
        events = monitor.tick(now=1.0)

        assert len(events) == 1
        assert fake.sent == [("%1", "continue")]


class TestMultiplePanes:
    def test_each_pane_is_tracked_independently(self):
        fake = FakeTmux(
            [PANE_A, PANE_B], {"%1": STALLED_PANE, "%2": WORKING_PANE}
        )
        monitor = make_monitor(fake)

        monitor.tick(now=0.0)

        assert fake.sent == [("%1", "continue")]

    def test_both_stalled_panes_are_retried(self):
        fake = FakeTmux([PANE_A, PANE_B], {"%1": STALLED_PANE, "%2": STALLED_PANE})
        monitor = make_monitor(fake)

        events = monitor.tick(now=0.0)

        assert len(events) == 2
        assert sorted(fake.sent) == [("%1", "continue"), ("%2", "continue")]

    def test_newly_appearing_pane_is_picked_up(self):
        """A7: sessions started after the daemon are monitored automatically."""
        fake = FakeTmux([PANE_A], {"%1": WORKING_PANE})
        monitor = make_monitor(fake)
        monitor.tick(now=0.0)

        fake.set_panes([PANE_A, PANE_B])
        fake.set_screen("%2", STALLED_PANE)
        monitor.tick(now=1.0)

        assert fake.sent == [("%2", "continue")]

    def test_records_for_closed_panes_are_dropped(self):
        fake = FakeTmux([PANE_A, PANE_B], {"%1": STALLED_PANE, "%2": STALLED_PANE})
        monitor = make_monitor(fake)
        monitor.tick(now=0.0)
        assert set(monitor.records) == {"%1", "%2"}

        fake.set_panes([PANE_A])
        monitor.tick(now=10.0)

        assert set(monitor.records) == {"%1"}

    def test_excluded_session_is_never_touched(self):
        fake = FakeTmux([PANE_A, PANE_B], {"%1": STALLED_PANE, "%2": STALLED_PANE})
        monitor = make_monitor(fake, skip_sessions=frozenset({"s1"}))

        monitor.tick(now=0.0)

        assert fake.sent == [("%2", "continue")]


class TestDryRun:
    def test_dry_run_reports_without_sending(self):
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake, dry_run=True)

        events = monitor.tick(now=0.0)

        assert len(events) == 1
        assert fake.sent == []

    def test_dry_run_still_respects_the_retry_interval(self):
        fake = FakeTmux([PANE_A], {"%1": STALLED_PANE})
        monitor = make_monitor(fake, dry_run=True, retry_interval=5.0)

        assert len(monitor.tick(now=0.0)) == 1
        assert monitor.tick(now=2.0) == []
        assert len(monitor.tick(now=5.0)) == 1


class TestStaleErrorGuard:
    def test_error_scrolled_out_of_the_tail_window_stops_retries(self):
        """A4: an old error frozen in scrollback must not retry forever."""
        stale = "\n".join(
            [CAPACITY_LINE] + [f"newer output {i}" for i in range(30)] + [EMPTY_COMPOSER]
        )
        fake = FakeTmux([PANE_A], {"%1": stale})
        monitor = make_monitor(fake)

        assert monitor.tick(now=0.0) == []
        assert fake.sent == []
