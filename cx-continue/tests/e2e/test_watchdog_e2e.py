"""End-to-end tests: real tmux, real daemon, fake codex.

Each test creates its own throwaway tmux session, runs the actual `cx-continue` CLI
against it, and asserts on what the fake codex received. The daemon is always launched
with `--only-session`, so it cannot reach any codex session that is not owned by the test.

The fake codex is launched through a wrapper script named `codex`, so pane discovery
exercises the real process-tree matching rather than bypassing it.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
FAKE_TUI = REPO_ROOT / "tests" / "integration" / "fake_codex_tui.py"
CX_CONTINUE = REPO_ROOT / "bin" / "cx-continue"

# Keep temporary state off /tmp: it is a memory-backed tmpfs on this host.
SCRATCH_ROOT = "/data/ycfeng/tmp"

pytestmark = pytest.mark.skipif(
    shutil.which("tmux") is None, reason="tmux is required for e2e tests"
)


class FakeCodexSession:
    """A throwaway tmux session running the fake codex TUI."""

    def __init__(self, mode: str):
        self.mode = mode
        self.name = f"cxc-e2e-{mode}-{os.getpid()}-{int(time.time() * 1000) % 100000}"
        self.workdir = tempfile.mkdtemp(prefix="cxc-e2e-", dir=SCRATCH_ROOT)
        self.transcript = pathlib.Path(self.workdir) / "transcript.tsv"
        self.transcript.touch()

        # Real codex runs as an executable literally named `codex` (e.g.
        # `node /home/.../bin/codex`, or the vendored `.../bin/codex` binary), which is
        # what process-tree discovery matches on. The fake is launched through a symlink
        # named `codex` pointing at the interpreter, so its command line carries the same
        # executable name and discovery is exercised for real rather than bypassed.
        self.python_as_codex = pathlib.Path(self.workdir) / "codex"
        self.python_as_codex.symlink_to(sys.executable)

    def start(self) -> None:
        subprocess.run(
            [
                "tmux", "new-session", "-d",
                "-s", self.name,
                "-x", "120", "-y", "30",
                f"{self.python_as_codex} {FAKE_TUI} {self.mode} {self.transcript}",
            ],
            check=True,
            capture_output=True,
        )

    def capture(self) -> str:
        result = subprocess.run(
            ["tmux", "capture-pane", "-p", "-e", "-t", self.name],
            capture_output=True,
            text=True,
            errors="replace",
        )
        return result.stdout

    def submissions(self) -> list[tuple[float, str]]:
        """(timestamp, text) for each line the fake codex received."""
        rows = []
        for line in self.transcript.read_text(errors="replace").splitlines():
            fields = line.split("\t")
            if len(fields) >= 3 and fields[1] == "SUBMIT":
                rows.append((float(fields[0]), fields[2]))
        return rows

    def raw_mode_active(self) -> bool:
        """Whether the fake put its tty in raw mode.

        Fidelity precondition for the composer tests. In canonical mode the kernel holds
        typed characters until Enter, so the fake would render an empty composer while
        secretly buffering text, and a test asserting "the watchdog did not clobber my
        typing" would pass or fail for reasons unrelated to the watchdog.
        """
        for line in self.transcript.read_text(errors="replace").splitlines():
            fields = line.split("\t")
            if len(fields) >= 3 and fields[1] == "TTY":
                return fields[2] == "raw=True"
        return False

    def wait_for_text(self, needle: str, timeout: float = 10.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if needle in self.capture():
                return True
            time.sleep(0.1)
        return False

    def wait_for_submissions(self, count: int, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if len(self.submissions()) >= count:
                return True
            time.sleep(0.1)
        return False

    def is_discovered(self) -> bool:
        """Whether the real discovery code sees this pane as a codex pane."""
        sys.path.insert(0, str(REPO_ROOT / "src"))
        from cx_continue import tmux

        return any(p.session == self.name for p in tmux.list_codex_panes())

    def cleanup(self) -> None:
        subprocess.run(
            ["tmux", "kill-session", "-t", self.name], capture_output=True
        )
        shutil.rmtree(self.workdir, ignore_errors=True)


class Watchdog:
    """The real cx-continue CLI, fenced to a single session."""

    def __init__(self, session: str, retry_interval: float = 5.0, poll: float = 0.5):
        self.session = session
        self.retry_interval = retry_interval
        self.poll = poll
        self.process: subprocess.Popen | None = None
        self.log = tempfile.NamedTemporaryFile(
            mode="w+", suffix=".log", prefix="cxc-watchdog-", dir=SCRATCH_ROOT, delete=False
        )

    def start(self) -> None:
        self.process = subprocess.Popen(
            [
                str(CX_CONTINUE),
                "--only-session", self.session,
                "--interval", str(self.poll),
                "--retry-interval", str(self.retry_interval),
                "--verbose",
            ],
            stdout=self.log,
            stderr=subprocess.STDOUT,
        )

    def stop(self) -> str:
        if self.process is not None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.log.flush()
        return pathlib.Path(self.log.name).read_text(errors="replace")

    def cleanup(self) -> None:
        pathlib.Path(self.log.name).unlink(missing_ok=True)


@pytest.fixture
def recovering_codex():
    session = FakeCodexSession("recover")
    session.start()
    yield session
    session.cleanup()


@pytest.fixture
def persistent_codex():
    session = FakeCodexSession("persist")
    session.start()
    yield session
    session.cleanup()


@pytest.fixture
def stream_recovering_codex():
    session = FakeCodexSession("stream-recover")
    session.start()
    yield session
    session.cleanup()


def external_daemons_watching(session_name: str) -> list[str]:
    """Any cx-continue daemon outside this test that would also inject into ``session_name``.

    Retry throttling is per process. A daemon a user left running watches every codex
    session it discovers, including the fake ones these tests create, and its injections
    interleave with the test daemon's. Measured effect: 5.0 s cadence observed as ~2.5 s.
    Cadence assertions must therefore verify they are the only writer.
    """
    result = subprocess.run(
        ["ps", "-eo", "pid=,args="], capture_output=True, text=True, errors="replace"
    )
    daemons = []
    for line in result.stdout.splitlines():
        # Match the daemon's actual entry point, not any command line mentioning the repo:
        # `tmux attach-session -t omc-cx-continue-...` and the fake codex launched from
        # this repo both contain "cx-continue" without being watchdogs.
        if "cx_continue.cli" not in line:
            continue
        if "--once" in line or "--dry-run" in line:
            continue
        # A daemon fenced to some other session cannot reach ours.
        if "--only-session" in line and session_name not in line:
            continue
        pid = line.split(None, 1)[0]
        if pid != str(os.getpid()):
            daemons.append(line.strip())
    return daemons


def test_pane_discovery_finds_the_fake_codex(recovering_codex):
    """A7: process-tree discovery recognises a codex pane without configuration."""
    assert recovering_codex.wait_for_text("Selected model is at capacity")
    assert recovering_codex.is_discovered() is True


def test_stalled_session_recovers_after_one_injection(recovering_codex):
    """A8: the watchdog sends continue once, the session recovers, and it stops."""
    assert recovering_codex.wait_for_text("Selected model is at capacity")
    assert recovering_codex.submissions() == []

    intruders = external_daemons_watching(recovering_codex.name)
    if intruders:
        pytest.skip(
            "another cx-continue daemon is watching all sessions and could inject a second "
            "continue, so the exactly-once assertion would not be about this test's "
            "daemon. Stop it with 'bin/cx-continue-ctl stop' to run this test.\n  "
            + "\n  ".join(intruders)
        )

    watchdog = Watchdog(recovering_codex.name, retry_interval=5.0, poll=0.5)
    watchdog.start()
    try:
        assert recovering_codex.wait_for_submissions(1, timeout=15.0), (
            "watchdog never injected; log:\n" + watchdog.stop()
        )
        # The fake enters the working state on the first submission; give the watchdog
        # several more retry windows to prove it does not keep injecting.
        time.sleep(12.0)
        submissions = recovering_codex.submissions()
    finally:
        log = watchdog.stop()
        watchdog.cleanup()

    assert [text for _, text in submissions] == ["continue"], (
        f"expected exactly one continue, got {submissions}; log:\n{log}"
    )
    assert "esc to interrupt" in recovering_codex.capture()


def test_stream_disconnected_session_recovers_after_one_injection(
    stream_recovering_codex,
):
    """The stream-disconnection warning uses the same real tmux retry path."""
    warning = "stream disconnected before completion: stream closed before response.completed"
    assert stream_recovering_codex.wait_for_text(warning)

    intruders = external_daemons_watching(stream_recovering_codex.name)
    if intruders:
        pytest.skip(
            "another cx-continue daemon is watching all sessions and could inject a second "
            "continue, so this test would not isolate the stream-disconnection path.\n  "
            + "\n  ".join(intruders)
        )

    watchdog = Watchdog(stream_recovering_codex.name, retry_interval=2.0, poll=0.5)
    watchdog.start()
    try:
        assert stream_recovering_codex.wait_for_submissions(1, timeout=15.0), (
            "watchdog never injected for stream disconnection; log:\n" + watchdog.stop()
        )
        time.sleep(4.0)
        submissions = stream_recovering_codex.submissions()
        assert "esc to interrupt" in stream_recovering_codex.capture()
    finally:
        log = watchdog.stop()
        watchdog.cleanup()

    assert [text for _, text in submissions] == ["continue"], (
        f"expected exactly one continue, got {submissions}; log:\n{log}"
    )


def test_persistent_outage_retries_at_the_configured_cadence(persistent_codex):
    """A5/A6: retries repeat indefinitely, spaced by the retry interval."""
    assert persistent_codex.wait_for_text("Selected model is at capacity")

    intruders = external_daemons_watching(persistent_codex.name)
    if intruders:
        pytest.skip(
            "another cx-continue daemon is watching all sessions, so its injections would "
            "interleave with this test's and halve the measured cadence. Stop it with "
            "'bin/cx-continue-ctl stop' to run this test.\n  " + "\n  ".join(intruders)
        )

    retry_interval = 5.0
    watchdog = Watchdog(persistent_codex.name, retry_interval=retry_interval, poll=0.5)
    watchdog.start()
    try:
        assert persistent_codex.wait_for_submissions(4, timeout=40.0), (
            "fewer than 4 retries observed; log:\n" + watchdog.stop()
        )
        submissions = persistent_codex.submissions()
    finally:
        log = watchdog.stop()
        watchdog.cleanup()

    texts = [text for _, text in submissions]
    assert set(texts) == {"continue"}, f"unexpected payloads: {texts}"

    stamps = [stamp for stamp, _ in submissions]
    gaps = [b - a for a, b in zip(stamps, stamps[1:])]
    print(f"\nobserved retry gaps (target {retry_interval}s): "
          + ", ".join(f"{g:.2f}s" for g in gaps))

    # The cadence floor is the contract (R2); the poll interval sets how much later than
    # the floor an injection may land.
    tolerance = 1.5
    for gap in gaps:
        assert gap >= retry_interval - 0.2, (
            f"retry gap {gap:.2f}s is below the {retry_interval}s floor; log:\n{log}"
        )
        assert gap <= retry_interval + tolerance, (
            f"retry gap {gap:.2f}s drifted well past {retry_interval}s; log:\n{log}"
        )


def test_typed_composer_is_never_clobbered(persistent_codex):
    """A3, at the system level: user text in the composer suppresses injection.

    The strongest safety property in the design. A stalled session with half-typed input
    must be left exactly as the user left it.
    """
    assert persistent_codex.wait_for_text("Selected model is at capacity")
    assert persistent_codex.raw_mode_active(), (
        "fake codex is not in raw mode; typed text would be invisible on screen and this "
        "test would not exercise the composer guard"
    )

    # Type without submitting, the way a user would.
    subprocess.run(
        ["tmux", "send-keys", "-t", persistent_codex.name, "-l", "my important prompt"],
        check=True,
        capture_output=True,
    )
    assert persistent_codex.wait_for_text("my important prompt"), (
        "typed text never appeared on screen; the fake is not echoing input"
    )

    watchdog = Watchdog(persistent_codex.name, retry_interval=2.0, poll=0.5)
    watchdog.start()
    try:
        time.sleep(10.0)
        submissions = persistent_codex.submissions()
        screen = persistent_codex.capture()
    finally:
        log = watchdog.stop()
        watchdog.cleanup()

    assert submissions == [], (
        f"watchdog submitted while the user had text pending: {submissions}; log:\n{log}"
    )
    assert "my important prompt" in screen
    assert "my important promptcontinue" not in screen


def test_live_codex_sessions_are_not_touched(recovering_codex):
    """A9: --only-session fences the daemon to the session under test."""
    assert recovering_codex.wait_for_text("Selected model is at capacity")

    sys.path.insert(0, str(REPO_ROOT / "src"))
    from cx_continue import tmux
    from cx_continue.monitor import Monitor

    monitor = Monitor(
        tmux_module=tmux,
        dry_run=True,
        confirmations=1,
        only_sessions=frozenset({recovering_codex.name}),
    )
    events = monitor.tick(time.monotonic())

    assert [event.pane.session for event in events] == [recovering_codex.name]
