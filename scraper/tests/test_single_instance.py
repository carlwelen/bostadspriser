"""B43: one scraper run at a time (flock on .state/update.lock).

Enforces the single-worker guardrail across processes and protects the shared
crawl_state / storageState files from concurrent writers. The lock lives next to
the storage state, i.e. in conftest's temp dir under test.
"""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from datetime import date
from pathlib import Path

import pytest
from click.testing import CliRunner

from scraper import run
from scraper.lock import SingleInstanceError, lock_path, single_instance

SRC = str(Path(__file__).resolve().parents[1] / "src")


def test_lock_file_lives_next_to_the_storage_state_in_tests() -> None:
    assert lock_path().name == "update.lock"
    assert "scraper-tests-" in str(lock_path())


def test_second_acquisition_fails_while_the_first_is_held_and_works_after_release() -> None:
    with single_instance():
        with pytest.raises(SingleInstanceError) as e:
            with single_instance():
                pytest.fail("the second acquisition must not succeed")
        assert str(lock_path()) in str(e.value)
    with single_instance():  # released: acquirable again
        pass


def test_lock_is_released_when_the_body_raises() -> None:
    with pytest.raises(RuntimeError):
        with single_instance():
            raise RuntimeError("boom")
    with single_instance():
        pass


@pytest.mark.parametrize("command", [["scrape", "--district", "ostermalm", "--since", "2026-05-01"], ["update"], ["reparse"]])
def test_commands_refuse_to_run_while_another_run_holds_the_lock(command, monkeypatch) -> None:
    called: list[str] = []
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", lambda *a, **k: called.append("iter"))
    monkeypatch.setattr(run, "reparse", lambda **kw: called.append("reparse"))
    with single_instance():
        result = CliRunner().invoke(run.cli, command)
    assert result.exit_code == 75, result.output
    assert "another scraper run" in result.output and str(lock_path()) in result.output
    assert called == []  # nothing ran


def test_a_command_holds_the_lock_while_it_runs(monkeypatch) -> None:
    seen: list[bool] = []

    def fake_reparse(**kw):
        try:
            with single_instance():
                seen.append(False)
        except SingleInstanceError:
            seen.append(True)
        from scraper.reparse import ReparseSummary

        return ReparseSummary()

    monkeypatch.setattr(run, "reparse", fake_reparse)
    assert CliRunner().invoke(run.cli, ["reparse"]).exit_code == 0
    assert seen == [True]


def test_lock_excludes_a_second_process() -> None:
    """Real cross-process check: a child holds the lock; we must be refused."""
    child_code = textwrap.dedent(
        """
        import sys
        from scraper.lock import single_instance
        with single_instance():
            print("held", flush=True)
            sys.stdin.readline()  # hold until the parent closes our stdin
        """
    )
    env = {**os.environ, "PYTHONPATH": SRC}
    child = subprocess.Popen(
        [sys.executable, "-c", child_code],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        env=env,
    )
    try:
        assert child.stdout is not None and child.stdout.readline().strip() == "held"
        with pytest.raises(SingleInstanceError):
            with single_instance():
                pytest.fail("acquired a lock that another process holds")
        assert CliRunner().invoke(run.cli, ["update"]).exit_code == 75
    finally:
        assert child.stdin is not None
        child.stdin.close()
        child.wait(timeout=10)
    with single_instance():  # the child's exit released it
        pass


def test_stale_lock_file_from_a_dead_process_does_not_block() -> None:
    """flock is released by the kernel on exit; a leftover file means nothing."""
    lock_path().write_text("99999999\n")
    with single_instance():
        pass


def test_update_still_works_when_the_lock_is_free(monkeypatch) -> None:
    async def it(district: str, since: date):
        if False:
            yield {}

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", it)
    monkeypatch.setattr(run, "latest_sold_at", lambda s, d: None)
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    assert result.exit_code == 0, result.output
