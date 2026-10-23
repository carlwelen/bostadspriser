"""B39: a partial crawl must not advance the `update` cutoff.

Pages are newest-first, so a crawl that dies on page 3 still upserts the newest
rows and pushes MAX(soldAt) forward. If `update` derived its cutoff from the DB,
the next run would start after the failed tail and never refetch it. `update`
therefore keeps its own "complete through" date per source/district, advanced
only by crawls that finished. No network, browser or DB: iterators, the DB max and
the upsert are monkeypatched; the state file lives in the temp dir from conftest.
"""

from __future__ import annotations

import json
from datetime import date

import pytest
from click.testing import CliRunner

from scraper import crawl_state, run
from scraper.errors import CrawlIncomplete


class World:
    def __init__(self) -> None:
        self.db_max: date | None = None
        self.mode = "complete"  # complete | partial | boom
        self.new_max: date | None = None  # what the rows of this run push MAX(soldAt) to
        self.since_seen: list[date] = []

    def iterator(self):
        async def it(district: str, since: date):
            self.since_seen.append(since)
            yield {"source": "hemnet", "district": district}
            if self.new_max:
                self.db_max = self.new_max  # the newest rows were upserted
            if self.mode == "partial":
                raise CrawlIncomplete("hemnet ostermalm page 3 failed")
            if self.mode == "boom":
                raise RuntimeError("boom")

        return it


@pytest.fixture()
def world(monkeypatch):
    w = World()
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", w.iterator())
    monkeypatch.setattr(run, "upsert_listings", lambda rows, **kw: len(rows))
    monkeypatch.setattr(run, "latest_sold_at", lambda source, district: w.db_max)
    crawl_state.state_path().unlink(missing_ok=True)
    yield w
    crawl_state.state_path().unlink(missing_ok=True)


def _update(*extra: str):
    return CliRunner().invoke(
        run.cli, ["update", "--source", "hemnet", "--district", "ostermalm", *extra]
    )


def test_partial_run_does_not_advance_the_cutoff(world) -> None:
    world.db_max = date(2026, 5, 10)
    assert _update().exit_code == 0  # complete: establishes the state at 2026-05-10
    assert world.since_seen[-1] == date(2026, 5, 3)

    world.mode, world.new_max = "partial", date(2026, 5, 20)  # newest rows land, tail fails
    assert _update().exit_code == 1
    assert world.db_max == date(2026, 5, 20)  # MAX(soldAt) moved...

    world.mode = "complete"
    assert _update().exit_code == 0
    assert world.since_seen[-1] == date(2026, 5, 3)  # ...but the cutoff did not (not 2026-05-13)

    assert _update().exit_code == 0  # the complete run advanced it
    assert world.since_seen[-1] == date(2026, 5, 13)


def test_hard_failure_does_not_advance_the_cutoff_either(world) -> None:
    world.db_max = date(2026, 5, 10)
    assert _update().exit_code == 0
    world.mode, world.new_max = "boom", date(2026, 5, 20)
    assert _update().exit_code == 1
    world.mode = "complete"
    _update()
    assert world.since_seen[-1] == date(2026, 5, 3)


def test_state_is_per_source_and_district(world) -> None:
    world.db_max = date(2026, 5, 10)
    _update()
    state = json.loads(crawl_state.state_path().read_text())
    assert state == {"hemnet/ostermalm": "2026-05-10"}
    assert crawl_state.complete_through("hemnet", "vasastan") is None
    assert crawl_state.complete_through("booli", "ostermalm") is None


def test_without_state_the_cutoff_falls_back_to_the_db_max(world) -> None:
    """Bootstrap (and rows written before this state file existed)."""
    world.db_max = date(2026, 5, 10)
    _update()
    assert world.since_seen == [date(2026, 5, 3)]


def test_no_state_and_empty_db_uses_the_lookback_window(world) -> None:
    _update("--lookback-days", "14")
    assert (date.today() - world.since_seen[0]).days == 14
    assert crawl_state.complete_through("hemnet", "ostermalm") is None  # nothing stored, nothing to record


def test_state_file_lives_next_to_the_storage_state_not_the_repo(world) -> None:
    from scraper.config import load_config

    assert crawl_state.state_path().parent == load_config().storage_state_path.parent
    assert "scraper-tests-" in str(crawl_state.state_path())  # conftest's temp dir, never scraper/.state


@pytest.mark.parametrize("content", ["", "not json", "[1, 2]", '{"hemnet/ostermalm": "garbage"}'])
def test_corrupt_state_is_ignored(world, content: str) -> None:
    crawl_state.state_path().write_text(content)
    world.db_max = date(2026, 5, 10)
    assert _update().exit_code == 0
    assert world.since_seen == [date(2026, 5, 3)]
    # ...and the next complete run rewrites it cleanly.
    assert crawl_state.complete_through("hemnet", "ostermalm") == date(2026, 5, 10)
