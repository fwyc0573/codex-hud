"""Integration tests for controller-owned runtime log cleanup."""

from __future__ import annotations

import os
import pathlib
import signal
import subprocess
import time


REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTROL_SCRIPT = REPO_ROOT / "bin" / "cx-continue-ctl"


def run_ctl(control_script: pathlib.Path, state_dir: pathlib.Path, *args: str):
    env = os.environ.copy()
    env["CX_CONTINUE_STATE_DIR"] = str(state_dir)
    return subprocess.run(
        ["bash", str(control_script), *args],
        env=env,
        capture_output=True,
        text=True,
        errors="replace",
    )


def runtime_log_paths(state_dir: pathlib.Path) -> list[pathlib.Path]:
    return [
        state_dir / "cx-continue.log",
        state_dir / "cx-continue.log.1",
        state_dir / "cx-continue.log.2",
        state_dir / "cx-continue.startup-error",
    ]


def test_stop_removes_all_runtime_logs_when_daemon_is_not_running(tmp_path) -> None:
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    for path in runtime_log_paths(state_dir):
        path.write_text(f"stale runtime log: {path.name}\n")

    result = run_ctl(CONTROL_SCRIPT, state_dir, "stop")

    assert result.returncode == 0, result.stdout + result.stderr
    assert not any(path.exists() for path in runtime_log_paths(state_dir))


def test_running_daemon_keeps_startup_error_linked_until_stop(tmp_path) -> None:
    fake_root = tmp_path / "fake-root"
    fake_bin = fake_root / "bin"
    state_dir = tmp_path / "state"
    fake_bin.mkdir(parents=True)
    state_dir.mkdir()

    control_script = fake_bin / "cx-continue-ctl"
    control_script.write_text(CONTROL_SCRIPT.read_text())

    fake_daemon = fake_bin / "cx-continue"
    fake_daemon.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
log_file=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --log-file) log_file="$2"; shift 2 ;;
        *) shift ;;
    esac
done
printf 'fake daemon main log\\n' >> "$log_file"
printf 'fake daemon startup stderr\\n' >&2
exec python3 -c '
import signal
import sys
import time
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
time.sleep(300)
' cx_continue.cli
"""
    )
    fake_daemon.chmod(0o755)

    pid: int | None = None
    try:
        start = run_ctl(control_script, state_dir, "start")
        assert start.returncode == 0, start.stdout + start.stderr

        pid = int((state_dir / "cx-continue.pid").read_text())
        startup_error = state_dir / "cx-continue.startup-error"
        assert startup_error.exists()
        assert startup_error.read_text() == "fake daemon startup stderr\n"

        fd_targets = [
            os.readlink(path)
            for path in pathlib.Path(f"/proc/{pid}/fd").iterdir()
        ]
        assert str(startup_error) in fd_targets
        assert not any("(deleted)" in target for target in fd_targets)

        for suffix in ("", ".1", ".2"):
            (state_dir / f"cx-continue.log{suffix}").write_text(
                f"runtime log {suffix}\n"
            )

        stop = run_ctl(control_script, state_dir, "stop")
        assert stop.returncode == 0, stop.stdout + stop.stderr
        assert not any(path.exists() for path in runtime_log_paths(state_dir))

        repeated_stop = run_ctl(control_script, state_dir, "stop")
        assert repeated_stop.returncode == 0
        assert not any(path.exists() for path in runtime_log_paths(state_dir))
    finally:
        if pid is not None:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.05)

