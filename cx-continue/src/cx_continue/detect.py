"""Classification of codex TUI pane content.

Pure functions only: pane text in, classification out. No subprocess calls, no clock,
no logging. Everything here is driven by byte-exact samples captured from live codex
panes, so a rendering change in codex surfaces as a unit-test failure.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# The capacity warning as codex renders it. Matched on the stable prose fragment rather
# than the full sentence so that punctuation or trailing-hint tweaks upstream do not
# silently disable detection.
CAPACITY_PATTERN = re.compile(r"Selected model is at capacity", re.IGNORECASE)

# The retryable stream termination warning. Keep this exact enough to avoid treating
# other websocket or transport disconnect reasons as a recoverable Codex stall.
STREAM_DISCONNECTED_PATTERN = re.compile(
    r"stream disconnected before completion:\s+stream closed before response\.completed",
    re.IGNORECASE,
)

# codex prints this inside the status line while a turn is in flight, e.g.
# "Working (5m 05s | esc to interrupt)". Its presence means the session is healthy.
WORKING_PATTERN = re.compile(r"esc to interrupt", re.IGNORECASE)

# The composer prompt marker. codex renders it as a bold "> " chevron.
COMPOSER_MARKER = "›"

# Only the tail of the visible region is searched for the capacity error. A pane that
# errored, recovered, and scrolled on must not keep matching an error frozen in
# scrollback. 12 lines comfortably covers the error plus the composer block that follows
# it while excluding older output.
DEFAULT_TAIL_LINES = 12

# SGR parameters that introduce an extended colour spec and therefore consume following
# parameters: 38 = foreground, 48 = background, 58 = underline colour.
_EXTENDED_COLOR_PARAMS = frozenset({38, 48, 58})

_SGR_RE = re.compile(r"\x1b\[([0-9;:]*)m")
_ANSI_RE = re.compile(r"\x1b\[[0-9;:?]*[a-zA-Z]|\x1b[()][A-Z0-9]|\x1b[=><]")


@dataclass(frozen=True)
class PaneState:
    """What a single pane looks like right now."""

    has_capacity_error: bool
    has_stream_disconnected_error: bool
    is_working: bool
    composer_empty: bool
    composer_found: bool

    @property
    def should_retry(self) -> bool:
        """Whether this pane has a retryable stall and is safe to inject into.

        All three conditions must hold. Each rules out a distinct way an unconditional
        injection would misbehave:

        - a retryable error must be present, or there is nothing to recover from;
        - the session must not be mid-turn, or the injection interrupts healthy work;
        - the composer must be confirmed empty, or the injection concatenates onto text
          the user is in the middle of typing and submits the result.
        """
        return (
            (self.has_capacity_error or self.has_stream_disconnected_error)
            and not self.is_working
            and self.composer_found
            and self.composer_empty
        )


def strip_ansi(text: str) -> str:
    """Remove escape sequences, leaving the rendered characters."""
    return _ANSI_RE.sub("", text)


def _iter_sgr_states(line: str):
    """Yield ``(char, is_dim)`` for each printable character in an SGR-bearing line.

    Tracks only the dim attribute (SGR 2), which is the single attribute the composer
    classification depends on. Extended colour specifications are parsed properly rather
    than skipped: codex renders the composer background as ``\\x1b[48;2;49;50;51m``, whose
    second parameter is the truecolor selector ``2``. Treating that as SGR 2 would mark a
    composer holding real user text as dim, and therefore as empty, which is exactly the
    misclassification that would destroy in-progress typing.
    """
    dim = False
    pos = 0
    for match in _SGR_RE.finditer(line):
        for char in line[pos : match.start()]:
            yield char, dim
        pos = match.end()

        raw = match.group(1)
        # An empty parameter string ("\x1b[m") means reset.
        params = [int(p.split(":")[0] or 0) for p in raw.split(";")] if raw else [0]

        index = 0
        while index < len(params):
            param = params[index]
            if param in _EXTENDED_COLOR_PARAMS:
                # 38;5;N (256-colour) consumes 2 extra params; 38;2;R;G;B consumes 4.
                if index + 1 < len(params) and params[index + 1] == 5:
                    index += 3
                elif index + 1 < len(params) and params[index + 1] == 2:
                    index += 5
                else:
                    index += 1
                continue
            if param == 0:
                dim = False
            elif param == 2:
                dim = True
            elif param == 22:
                # 22 clears both bold and dim.
                dim = False
            index += 1

    for char in line[pos:]:
        yield char, dim


def _classify_composer_line(line: str) -> bool:
    """Return True when a composer line holds no user text.

    codex renders an empty composer as the chevron followed by a dim placeholder hint,
    and a filled composer as the chevron followed by undimmed text. The placeholder text
    rotates between several hints, so the dim attribute is the signal, not any specific
    hint string.
    """
    chars = list(_iter_sgr_states(line))

    # Drop everything up to and including the chevron; only its right-hand side matters.
    for position, (char, _) in enumerate(chars):
        if char == COMPOSER_MARKER:
            chars = chars[position + 1 :]
            break

    return not any(not is_dim for char, is_dim in chars if not char.isspace())


def find_composer(pane_text: str) -> tuple[bool, bool]:
    """Locate the composer in a pane capture.

    Returns ``(found, is_empty)``. The last chevron-bearing line is used: codex draws the
    composer at the bottom of the pane, below any transcript content that may itself
    contain a chevron.
    """
    for line in reversed(pane_text.splitlines()):
        if COMPOSER_MARKER in strip_ansi(line):
            return True, _classify_composer_line(line)
    return False, False


def has_capacity_error(pane_text: str, tail_lines: int = DEFAULT_TAIL_LINES) -> bool:
    """Whether the capacity warning appears within the last ``tail_lines`` lines.

    Restricting the search to the tail is what keeps a recovered session from retrying
    forever on an error still sitting in its scrollback.
    """
    lines = strip_ansi(pane_text).splitlines()
    # Trailing blank lines are padding from the capture, not content; they would
    # otherwise push a genuine error out of the window.
    while lines and not lines[-1].strip():
        lines.pop()
    window = lines[-tail_lines:] if tail_lines > 0 else lines
    return any(CAPACITY_PATTERN.search(line) for line in window)


def has_stream_disconnected_error(
    pane_text: str, tail_lines: int = DEFAULT_TAIL_LINES
) -> bool:
    """Whether the retryable stream termination warning appears in the tail.

    The terminal may wrap the warning at the pane width, so matching is performed over
    the selected tail with whitespace allowed between the stable message fragments.
    """
    lines = strip_ansi(pane_text).splitlines()
    while lines and not lines[-1].strip():
        lines.pop()
    window = lines[-tail_lines:] if tail_lines > 0 else lines
    return bool(STREAM_DISCONNECTED_PATTERN.search("\n".join(window)))


def is_working(pane_text: str) -> bool:
    """Whether codex is currently executing a turn."""
    return bool(WORKING_PATTERN.search(strip_ansi(pane_text)))


def classify(pane_text: str, tail_lines: int = DEFAULT_TAIL_LINES) -> PaneState:
    """Classify a pane capture."""
    composer_found, composer_empty = find_composer(pane_text)
    return PaneState(
        has_capacity_error=has_capacity_error(pane_text, tail_lines=tail_lines),
        has_stream_disconnected_error=has_stream_disconnected_error(
            pane_text, tail_lines=tail_lines
        ),
        is_working=is_working(pane_text),
        composer_empty=composer_empty,
        composer_found=composer_found,
    )
