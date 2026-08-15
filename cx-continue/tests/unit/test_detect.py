"""Unit tests for pane classification.

The samples below are byte-exact captures from real codex panes on this host, not
hand-written approximations. Fixtures under tests/fixtures/ were produced with
`tmux capture-pane -p -e` against live sessions; the inline samples reproduce specific
rendering details that matter for classification.
"""

from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "src"))

from cx_continue import detect  # noqa: E402

FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "fixtures"

# Real rendering of the capacity warning, recovered from a session where an outage
# actually occurred (rollout-2026-07-11T15-28-51-019f5014).
CAPACITY_LINE = (
    "\x1b[38;5;3m⚠ Selected model is at capacity. Please try a different model.\x1b[39m"
)

# The exact stream termination warning that should use the same recovery path as the
# capacity warning.
STREAM_DISCONNECTED_LINE = (
    "\x1b[38;5;1m■ stream disconnected before completion: "
    "stream closed before response.completed\x1b[39m"
)

# Real empty composer: the placeholder hint is dim, and the background is set with a
# truecolor escape whose second parameter is 2. That 2 is the truecolor selector, not the
# dim attribute; conflating them would classify a filled composer as empty.
EMPTY_COMPOSER = (
    "\x1b[48;2;49;50;51m\n"
    "\x1b[1m›\x1b[0m\x1b[48;2;49;50;51m \x1b[2mRun /review on my current changes"
    "\x1b[0m\x1b[48;2;49;50;51m"
)

# Real composer holding user text: no dim wrapper around the content.
TYPED_COMPOSER = "\x1b[1m›\x1b[0m\x1b[48;2;49;50;51m continue"

# Real working indicator, captured from a live pane mid-turn.
WORKING_LINE = (
    "• \x1b[2mWorkin\x1b[0mg \x1b[2m(1m 35s • esc to interrupt)\x1b[0m"
)

STATUS_LINE = (
    "\x1b[49m  \x1b[38;2;246;226;183mgpt-5.6-sol max\x1b[2m\x1b[39m · "
    "\x1b[0m\x1b[38;2;143;179;239mmain\x1b[2m\x1b[39m\x1b[0m"
)


def read_fixture(name: str) -> str:
    return (FIXTURES / name).read_text(errors="replace")


class TestStripAnsi:
    def test_removes_sgr_sequences(self):
        assert detect.strip_ansi(CAPACITY_LINE) == (
            "⚠ Selected model is at capacity. Please try a different model."
        )

    def test_preserves_plain_text(self):
        assert detect.strip_ansi("plain text") == "plain text"


class TestCapacityDetection:
    def test_detects_real_capacity_line(self):
        assert detect.has_capacity_error(CAPACITY_LINE) is True

    def test_absent_when_no_error(self):
        assert detect.has_capacity_error(WORKING_LINE + "\n" + EMPTY_COMPOSER) is False

    def test_ignores_error_above_the_tail_window(self):
        """A5/A4: an old error in scrollback must not trigger perpetual retries."""
        pane = "\n".join([CAPACITY_LINE] + [f"later output {i}" for i in range(30)])
        assert detect.has_capacity_error(pane, tail_lines=12) is False

    def test_finds_error_within_the_tail_window(self):
        pane = "\n".join(["old output"] * 30 + [CAPACITY_LINE, "", EMPTY_COMPOSER])
        assert detect.has_capacity_error(pane, tail_lines=12) is True

    def test_trailing_blank_padding_does_not_push_error_out(self):
        """tmux pads captures with blank lines; padding is not content."""
        pane = "\n".join([CAPACITY_LINE] + [""] * 20)
        assert detect.has_capacity_error(pane, tail_lines=12) is True

    def test_match_is_case_insensitive(self):
        assert detect.has_capacity_error("SELECTED MODEL IS AT CAPACITY") is True


class TestStreamDisconnectedDetection:
    def test_detects_exact_stream_disconnected_error(self):
        assert detect.has_stream_disconnected_error(STREAM_DISCONNECTED_LINE) is True

    def test_does_not_match_a_different_stream_disconnect_reason(self):
        pane = "stream disconnected before completion: websocket closed by server before response.completed"
        assert detect.has_stream_disconnected_error(pane) is False

    def test_finds_stream_disconnected_error_within_the_tail_window(self):
        pane = "\n".join(["old output"] * 30 + [STREAM_DISCONNECTED_LINE, "", EMPTY_COMPOSER])
        assert detect.has_stream_disconnected_error(pane, tail_lines=12) is True

    def test_detects_stream_disconnected_error_wrapped_across_lines(self):
        pane = "\n".join(
            [
                "■ stream disconnected before completion:",
                "stream closed before response.completed",
                "",
                EMPTY_COMPOSER,
            ]
        )
        assert detect.has_stream_disconnected_error(pane) is True


class TestWorkingDetection:
    def test_detects_real_working_line(self):
        assert detect.is_working(WORKING_LINE) is True

    def test_idle_pane_is_not_working(self):
        assert detect.is_working(EMPTY_COMPOSER) is False


class TestComposerClassification:
    def test_dim_placeholder_means_empty(self):
        found, empty = detect.find_composer(EMPTY_COMPOSER)
        assert (found, empty) == (True, True)

    def test_undimmed_text_means_occupied(self):
        found, empty = detect.find_composer(TYPED_COMPOSER)
        assert (found, empty) == (True, False)

    def test_truecolor_background_is_not_read_as_dim(self):
        """Guards the misclassification that would corrupt in-progress user typing.

        `\\x1b[48;2;49;50;51m` sets a truecolor background. Its `2` parameter must be
        consumed as part of the colour spec; if it were treated as SGR 2 (dim), a composer
        holding user text would look empty and the watchdog would append to it.
        """
        line = "\x1b[1m›\x1b[0m\x1b[48;2;49;50;51m my half-written prompt"
        found, empty = detect.find_composer(line)
        assert found is True
        assert empty is False

    def test_256_color_background_is_not_read_as_dim(self):
        line = "\x1b[1m›\x1b[0m\x1b[48;5;237m typed words"
        assert detect.find_composer(line) == (True, False)

    def test_sgr_22_clears_dim(self):
        line = "\x1b[1m›\x1b[0m \x1b[2mhint\x1b[22m visible"
        assert detect.find_composer(line) == (True, False)

    def test_last_chevron_wins(self):
        """Transcript content can contain a chevron; the composer is the bottom one."""
        pane = "\n".join(["› an old submitted prompt", "", EMPTY_COMPOSER])
        assert detect.find_composer(pane) == (True, True)

    def test_missing_composer_reported(self):
        assert detect.find_composer("no composer here") == (False, False)


class TestShouldRetry:
    def test_stalled_pane_retries(self):
        pane = "\n".join([CAPACITY_LINE, "", EMPTY_COMPOSER, "", STATUS_LINE])
        state = detect.classify(pane)
        assert state.should_retry is True

    def test_stream_disconnected_pane_retries(self):
        pane = "\n".join([STREAM_DISCONNECTED_LINE, "", EMPTY_COMPOSER, "", STATUS_LINE])
        state = detect.classify(pane)
        assert state.has_stream_disconnected_error is True
        assert state.should_retry is True

    def test_working_pane_never_retries(self):
        """A2: a healthy in-flight turn must never be interrupted."""
        pane = "\n".join([CAPACITY_LINE, "", WORKING_LINE, "", EMPTY_COMPOSER])
        state = detect.classify(pane)
        assert state.is_working is True
        assert state.should_retry is False

    def test_typed_composer_never_retries(self):
        """A3: never append to text the user is composing."""
        pane = "\n".join([CAPACITY_LINE, "", TYPED_COMPOSER])
        state = detect.classify(pane)
        assert state.composer_empty is False
        assert state.should_retry is False

    def test_missing_composer_never_retries(self):
        pane = "\n".join([CAPACITY_LINE, "", "no composer rendered"])
        assert detect.classify(pane).should_retry is False

    def test_healthy_pane_never_retries(self):
        pane = "\n".join(["all good", WORKING_LINE, EMPTY_COMPOSER])
        assert detect.classify(pane).should_retry is False


class TestLiveFixtures:
    """Classification against captures taken from real running codex sessions."""

    def test_golden_capacity_stall_retries(self):
        """A1: the real stall rendering, end to end, triggers a retry."""
        state = detect.classify(read_fixture("real_capacity_stall.txt"))
        assert state.has_capacity_error is True
        assert state.is_working is False
        assert state.composer_empty is True
        assert state.should_retry is True

    def test_golden_capacity_stall_with_typed_composer_does_not_retry(self):
        state = detect.classify(read_fixture("real_capacity_stall_typed_composer.txt"))
        assert state.has_capacity_error is True
        assert state.composer_empty is False
        assert state.should_retry is False

    def test_live_working_pane_does_not_retry(self):
        state = detect.classify(read_fixture("live_working.txt"))
        assert state.is_working is True
        assert state.should_retry is False

    def test_live_pane_with_typed_composer_does_not_retry(self):
        state = detect.classify(read_fixture("live_idle_typed_composer.txt"))
        assert state.composer_empty is False
        assert state.should_retry is False

    def test_live_recovered_after_capacity_does_not_retry(self):
        """A8: a session that already recovered is left alone.

        This fixture captured a real outage and its recovery in sequence: the capacity
        warning, a manual `continue`, then the session working again. The error text is
        still on screen, so only the working signal and the tail window prevent a
        pointless injection.
        """
        pane = read_fixture("live_recovered_after_capacity.txt")
        assert "Selected model is at capacity" in detect.strip_ansi(pane)
        state = detect.classify(pane)
        assert state.is_working is True
        assert state.should_retry is False

    @pytest.mark.parametrize(
        "fixture",
        [
            "live_working.txt",
            "live_idle_typed_composer.txt",
            "live_interrupted.txt",
            "live_working_empty_composer.txt",
            "live_recovered_after_capacity.txt",
        ],
    )
    def test_no_healthy_live_pane_is_ever_retried(self, fixture):
        """None of the real panes captured while healthy may be injected into."""
        assert detect.classify(read_fixture(fixture)).should_retry is False
