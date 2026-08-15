"""Tests for bounded daemon log handling."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler

import pytest

from cx_continue import cli


@pytest.fixture(autouse=True)
def reset_logger_handlers():
    for handler in list(cli.LOGGER.handlers):
        handler.close()
        cli.LOGGER.removeHandler(handler)
    yield
    for handler in list(cli.LOGGER.handlers):
        handler.close()
        cli.LOGGER.removeHandler(handler)


def test_file_logging_uses_one_rotating_handler_with_100_mib_total_budget(
    tmp_path,
) -> None:
    log_file = tmp_path / "cx-continue.log"

    cli.configure_logging(verbose=False, log_file=str(log_file))

    assert len(cli.LOGGER.handlers) == 1
    handler = cli.LOGGER.handlers[0]
    assert isinstance(handler, RotatingFileHandler)
    assert handler.maxBytes * (handler.backupCount + 1) <= 100 * 1024 * 1024


def test_rotation_deletes_logs_older_than_the_configured_budget(
    tmp_path, monkeypatch
) -> None:
    log_file = tmp_path / "cx-continue.log"
    monkeypatch.setattr(cli, "LOG_TOTAL_LIMIT_BYTES", 4 * 1024, raising=False)
    monkeypatch.setattr(cli, "LOG_BACKUP_COUNT", 3, raising=False)

    cli.configure_logging(verbose=False, log_file=str(log_file))

    for index in range(500):
        cli.LOGGER.info("record=%04d payload=%s", index, "x" * 80)

    for handler in cli.LOGGER.handlers:
        handler.flush()

    log_family = sorted(tmp_path.glob("cx-continue.log*"))
    total_bytes = sum(path.stat().st_size for path in log_family)

    assert [path.name for path in log_family] == [
        "cx-continue.log",
        "cx-continue.log.1",
        "cx-continue.log.2",
        "cx-continue.log.3",
    ]
    assert not (tmp_path / "cx-continue.log.4").exists()
    assert total_bytes <= 4 * 1024


def test_reconfiguration_closes_previous_file_handlers(tmp_path) -> None:
    first_log = tmp_path / "first.log"
    second_log = tmp_path / "second.log"

    cli.configure_logging(verbose=False, log_file=str(first_log))
    first_handler = cli.LOGGER.handlers[0]
    cli.configure_logging(verbose=False, log_file=str(second_log))

    assert len(cli.LOGGER.handlers) == 1
    assert cli.LOGGER.handlers[0] is not first_handler
    assert first_handler.stream is None

