"""Audit-only end-to-end coverage for sessions created after watchdog startup."""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import time
import uuid


REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
WATCHDOG = REPO_ROOT / "bin" / "cx-continue"
FAKE_TUI = REPO_ROOT / "tests" / "integration" / "fake_codex_tui.py"
SCRATCH_ROOT = pathlib.Path("/data/ycfeng/tmp")


def run_tmux(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["tmux", *args],
        check=True,
        capture_output=True,
        text=True,
        errors="replace",
    )


def wait_until(predicate, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.1)
    return False


def read_submissions(transcript: pathlib.Path) -> list[tuple[float, str]]:
    rows: list[tuple[float, str]] = []
    for line in transcript.read_text(errors="replace").splitlines():
        fields = line.split("\t")
        if len(fields) >= 3 and fields[1] == "SUBMIT":
            rows.append((float(fields[0]), fields[2]))
    return rows


def test_session_created_after_watchdog_start_is_discovered_and_retried() -> None:
    suffix = f"{os.getpid()}-{uuid.uuid4().hex[:8]}"
    sentinel_session = f"cxc-audit-sentinel-{suffix}"
    codex_session = f"cxc-audit-late-{suffix}"
    workdir = SCRATCH_ROOT / f"cxc-audit-late-{suffix}"
    workdir.mkdir(parents=True)
    transcript = workdir / "transcript.tsv"
    transcript.touch()
    python_as_codex = workdir / "codex"
    python_as_codex.symlink_to(sys.executable)
    log_path = workdir / "watchdog.log"

    run_tmux(
        "new-session",
        "-d",
        "-s",
        sentinel_session,
        "-x",
        "80",
        "-y",
        "20",
        "sleep 120",
    )

    started_at = time.time()
    with log_path.open("w") as log_file:
        watchdog = subprocess.Popen(
            [
                "bash",
                str(WATCHDOG),
                "--only-session",
                codex_session,
                "--interval",
                "0.2",
                "--retry-interval",
                "2",
                "--confirmations",
                "1",
            ],
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )

        try:
            assert wait_until(
                lambda: "watching 0 codex pane(s): none yet"
                in log_path.read_text(errors="replace"),
                timeout=10.0,
            )
            assert watchdog.poll() is None

            run_tmux(
                "new-session",
                "-d",
                "-s",
                codex_session,
                "-x",
                "120",
                "-y",
                "30",
                f"{python_as_codex} {FAKE_TUI} recover {transcript}",
            )

            assert wait_until(
                lambda: len(read_submissions(transcript)) >= 1,
                timeout=15.0,
            ), log_path.read_text(errors="replace")
            first_retry_latency = read_submissions(transcript)[0][0] - started_at

            time.sleep(3.0)
            submissions = read_submissions(transcript)
            assert [text for _, text in submissions] == ["continue"]

            run_tmux("kill-session", "-t", codex_session)
            time.sleep(0.5)
            assert watchdog.poll() is None

            print(
                "dynamic_discovery_metrics "
                f"first_retry_latency_s={first_retry_latency:.3f} "
                f"submission_count={len(submissions)} "
                "watchdog_alive_after_session_exit=1"
            )
        finally:
            watchdog.terminate()
            try:
                watchdog.wait(timeout=10)
            except subprocess.TimeoutExpired:
                watchdog.kill()
                watchdog.wait(timeout=5)
            subprocess.run(
                ["tmux", "kill-session", "-t", codex_session],
                capture_output=True,
            )
            subprocess.run(
                ["tmux", "kill-session", "-t", sentinel_session],
                capture_output=True,
            )
