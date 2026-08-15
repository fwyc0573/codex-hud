"""tmux adapter: the only module that shells out to tmux.

Isolating the subprocess calls here keeps `detect` pure and lets `monitor` be tested
against a fake adapter with no tmux server involved.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass

# Matches a codex executable among a process tree's command lines. Three entry points are
# in use on this host: the vendored musl binary, the npm `codex.js` shim, and the
# `stepcode.js codex` wrapper.
CODEX_PROCESS_PATTERN = re.compile(
    r"(?:^|/)codex(?:$|\s)"
    r"|(?:^|/)codex\.js(?:$|\s)"
    r"|(?:^|/)stepcode\.js\s+codex(?:$|\s)"
    r"|(?:^|/)codex-linux-x64/"
)

# Panes whose process tree contains one of these but no codex are explicitly not codex
# panes. `codex-hud` runs its status bar as a plain node process in a sibling pane.
_PANE_FIELDS = "#{session_name}\t#{pane_id}\t#{pane_pid}\t#{pane_in_mode}"

_PROCESS_WALK_DEPTH_LIMIT = 40


class TmuxError(RuntimeError):
    """A tmux command failed in a way that is not a normal lifecycle event."""


@dataclass(frozen=True)
class Pane:
    """A tmux pane running a codex session."""

    session: str
    pane_id: str
    pane_pid: int
    in_copy_mode: bool

    def __str__(self) -> str:
        return f"{self.session}:{self.pane_id}"


def _run(args: list[str], timeout: float = 10.0) -> subprocess.CompletedProcess:
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=timeout,
        errors="replace",
    )


def tmux_available() -> bool:
    return shutil.which("tmux") is not None


def _read_process_table() -> tuple[dict[int, int], dict[int, str]]:
    """Return ``(ppid_by_pid, cmdline_by_pid)`` for all visible processes."""
    result = _run(["ps", "-eo", "pid=,ppid=,args="])
    if result.returncode != 0:
        raise TmuxError(f"ps failed: {result.stderr.strip()}")

    parents: dict[int, int] = {}
    commands: dict[int, str] = {}
    for line in result.stdout.splitlines():
        parts = line.split(None, 2)
        if len(parts) < 2:
            continue
        try:
            pid, ppid = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        parents[pid] = ppid
        commands[pid] = parts[2] if len(parts) > 2 else ""
    return parents, commands


def _tree_contains_codex(
    root_pid: int, parents: dict[int, int], commands: dict[int, str]
) -> bool:
    """Whether ``root_pid`` or any descendant is a codex process.

    A `codex-hud` pane runs `bash` which runs `node` which runs the codex binary, so the
    pane's own command line says nothing useful; the tree must be walked. Verified against
    live sessions: codex panes match, HUD status panes do not.
    """
    for pid, command in commands.items():
        if not CODEX_PROCESS_PATTERN.search(command):
            continue
        current = pid
        for _ in range(_PROCESS_WALK_DEPTH_LIMIT):
            if current == root_pid:
                return True
            parent = parents.get(current)
            if parent is None or parent == current or parent <= 1:
                break
            current = parent
    return False


def list_panes() -> list[Pane]:
    """All tmux panes, regardless of what they run."""
    result = _run(["tmux", "list-panes", "-a", "-F", _PANE_FIELDS])
    if result.returncode != 0:
        stderr = result.stderr.strip()
        # No server running means no panes, which is a normal state, not a failure.
        if "no server running" in stderr or "error connecting" in stderr:
            return []
        raise TmuxError(f"tmux list-panes failed: {stderr}")

    panes = []
    for line in result.stdout.splitlines():
        fields = line.split("\t")
        if len(fields) < 4:
            continue
        session, pane_id, pane_pid, in_mode = fields[:4]
        try:
            pid = int(pane_pid)
        except ValueError:
            continue
        panes.append(
            Pane(
                session=session,
                pane_id=pane_id,
                pane_pid=pid,
                in_copy_mode=in_mode.strip() == "1",
            )
        )
    return panes


def list_codex_panes() -> list[Pane]:
    """Panes whose process tree contains a codex process."""
    panes = list_panes()
    if not panes:
        return []
    parents, commands = _read_process_table()
    return [p for p in panes if _tree_contains_codex(p.pane_pid, parents, commands)]


def capture(pane_id: str) -> str | None:
    """Capture the visible region of a pane with escape sequences preserved.

    Returns ``None`` when the pane no longer exists, which happens routinely as sessions
    come and go between a discovery pass and a capture.
    """
    result = _run(["tmux", "capture-pane", "-p", "-e", "-t", pane_id])
    if result.returncode != 0:
        stderr = result.stderr.strip()
        if "can't find pane" in stderr or "no server running" in stderr:
            return None
        raise TmuxError(f"tmux capture-pane failed for {pane_id}: {stderr}")
    return result.stdout


def send_text_and_enter(pane_id: str, text: str, settle_seconds: float = 0.15) -> bool:
    """Type ``text`` into a pane and submit it.

    The text and the Enter are sent as two calls with a short gap. codex redraws its
    composer on input, and an Enter arriving in the same write as the text can be dropped
    by that redraw. ``-l`` sends the payload literally so tmux does not interpret it as
    key names.

    Returns False if the pane vanished mid-send.
    """
    import time

    result = _run(["tmux", "send-keys", "-t", pane_id, "-l", text])
    if result.returncode != 0:
        stderr = result.stderr.strip()
        if "can't find pane" in stderr or "no server running" in stderr:
            return False
        raise TmuxError(f"tmux send-keys failed for {pane_id}: {stderr}")

    time.sleep(settle_seconds)

    result = _run(["tmux", "send-keys", "-t", pane_id, "Enter"])
    if result.returncode != 0:
        stderr = result.stderr.strip()
        if "can't find pane" in stderr or "no server running" in stderr:
            return False
        raise TmuxError(f"tmux send-keys Enter failed for {pane_id}: {stderr}")
    return True
