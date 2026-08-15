"""Audit-only retained-state stress test for the monitor."""

from __future__ import annotations

import gc
import tracemalloc

from cx_continue.monitor import Monitor
from cx_continue.tmux import Pane


class ChurnTmux:
    def __init__(self) -> None:
        self.panes: tuple[Pane, ...] = ()

    def list_codex_panes(self) -> list[Pane]:
        return list(self.panes)

    def capture(self, pane_id: str) -> str:
        return "healthy pane without a capacity error"

    def send_text_and_enter(self, pane_id: str, text: str) -> bool:
        raise AssertionError("healthy panes must never receive input")


def test_monitor_retained_state_is_bounded_under_session_churn() -> None:
    fake = ChurnTmux()
    monitor = Monitor(tmux_module=fake, confirmations=1)
    cycles = 50_000
    max_record_count = 0

    gc.collect()
    tracemalloc.start()
    baseline_current, _ = tracemalloc.get_traced_memory()

    for index in range(cycles):
        fake.panes = (
            Pane(
                session=f"audit-{index}",
                pane_id=f"%{index}",
                pane_pid=100_000 + index,
                in_copy_mode=False,
            ),
        )
        monitor.tick(now=float(index * 2))
        max_record_count = max(max_record_count, len(monitor.records))

        fake.panes = ()
        monitor.tick(now=float(index * 2 + 1))

    gc.collect()
    current_bytes, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    retained_growth_bytes = current_bytes - baseline_current

    print(
        "resource_bound_metrics "
        f"cycles={cycles} "
        f"max_record_count={max_record_count} "
        f"final_record_count={len(monitor.records)} "
        f"retained_growth_bytes={retained_growth_bytes} "
        f"peak_traced_bytes={peak_bytes}"
    )

    assert max_record_count == 1
    assert monitor.records == {}
    assert retained_growth_bytes < 2 * 1024 * 1024

