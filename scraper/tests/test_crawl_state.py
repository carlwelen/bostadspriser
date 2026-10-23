"""B39: a partial crawl must not advance the `update` cutoff.

Pages are newest-first, so a crawl that dies on page 3 still upserts the newest
rows and pushes MAX(soldAt) forward. If `update` derived its cutoff from the DB,
the next run would start after the failed tail and never refetch it. `update`
therefore keeps its own "complete through" date per source/district, advanced
only by crawls that finished, and only to the newest `soldAt` that crawl itself
yielded (never to the DB max, which a partial run may have pushed past a gap).
No network, browser or DB: iterators, the DB max and the upsert are monkeypatched;
the state file lives in the temp dir from conftest.
"""

from __future__ import annotations

import json
import os
from datetime import date

import pytest
from click.testing import CliRunner

from scraper import crawl_state, run
from scraper.errors import CrawlIncomplete


class World:
    def __init__(self) -> None:
        self.db_max: date | None = None
        self.mode = "complete"  # complete | partial | boom
        self.row_date: date | None = None  # soldAt of the row this run yields (None: no rows)
        self.since_seen: list[date] = []

    def iterator(self):
        async def it(district: str, since: date, **kw):
            self.since_seen.append(since)
            if self.row_date:
                self.db_max = max(self.db_max or self.row_date, self.row_date)  # newest rows upserted
                yield {"source": "hemnet", "district": district, "soldAt": self.row_date}
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
    world.db_max = world.row_date = date(2026, 5, 10)
    assert _update().exit_code == 0  # complete: establishes the state at 2026-05-10
    assert world.since_seen[-1] == date(2026, 5, 3)

    world.mode, world.row_date = "partial", date(2026, 5, 20)  # newest rows land, tail fails
    assert _update().exit_code == 1
    assert world.db_max == date(2026, 5, 20)  # MAX(soldAt) moved...

    world.mode = "complete"
    assert _update().exit_code == 0
    assert world.since_seen[-1] == date(2026, 5, 3)  # ...but the cutoff did not (not 2026-05-13)

    assert _update().exit_code == 0  # the complete run advanced it to what it yielded
    assert world.since_seen[-1] == date(2026, 5, 13)


def test_complete_crawl_with_no_rows_must_not_jump_over_a_partial_gap(world, monkeypatch) -> None:
    """Reviewer probe: the DB max was pushed to 05-20 by a partial run; a later
    'complete' crawl that yields nothing must not record that date."""
    world.db_max = world.row_date = date(2026, 5, 10)
    assert _update().exit_code == 0
    world.mode, world.row_date = "partial", date(2026, 5, 20)
    assert _update().exit_code == 1

    async def empty(district, since, **kw):
        world.since_seen.append(since)
        if False:
            yield {}

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", empty)
    assert _update().exit_code == 0
    assert crawl_state.complete_through("hemnet", "ostermalm") == date(2026, 5, 10)
    assert _update().exit_code == 0
    assert world.since_seen[-1] == date(2026, 5, 3)  # still retrying the gap


def test_state_never_moves_backwards(world) -> None:
    world.row_date = date(2026, 5, 10)
    _update()
    world.row_date = date(2026, 5, 5)  # a complete crawl whose newest row is older than recorded
    _update()
    assert crawl_state.complete_through("hemnet", "ostermalm") == date(2026, 5, 10)


def test_hard_failure_does_not_advance_the_cutoff_either(world) -> None:
    world.row_date = date(2026, 5, 10)
    assert _update().exit_code == 0
    world.mode, world.row_date = "boom", date(2026, 5, 20)
    assert _update().exit_code == 1
    world.mode = "complete"
    _update()
    assert world.since_seen[-1] == date(2026, 5, 3)


def test_state_is_per_source_and_district(world) -> None:
    world.row_date = date(2026, 5, 10)
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
    assert crawl_state.complete_through("hemnet", "ostermalm") is None  # nothing yielded, nothing to record


def test_state_file_lives_next_to_the_storage_state_not_the_repo(world) -> None:
    from scraper.config import load_config

    assert crawl_state.state_path().parent == load_config().storage_state_path.parent
    assert "scraper-tests-" in str(crawl_state.state_path())  # conftest's temp dir, never scraper/.state


def test_writes_go_through_a_unique_temp_file_in_the_same_directory(world, monkeypatch) -> None:
    """A fixed 'crawl_state.json.tmp' would race between concurrent writers."""
    seen: list[tuple[str, str]] = []
    real_replace = os.replace

    def spy(src, dst):
        seen.append((str(src), str(dst)))
        return real_replace(src, dst)

    monkeypatch.setattr(os, "replace", spy)
    world.row_date = date(2026, 5, 10)
    _update()
    _update()
    path = crawl_state.state_path()
    assert len(seen) == 2 and {dst for _, dst in seen} == {str(path)}
    srcs = [src for src, _ in seen]
    assert srcs[0] != srcs[1]  # unique per write
    for src in srcs:
        assert os.path.dirname(src) == str(path.parent) and src != str(path) + ".tmp"
        assert not os.path.exists(src)  # nothing left behind
    assert [p.name for p in path.parent.glob("crawl_state*")] == ["crawl_state.json"]


@pytest.mark.parametrize("content", ["", "not json", "[1, 2]"])
def test_unreadable_state_warns_falls_back_and_is_never_overwritten(world, content: str) -> None:
    crawl_state.state_path().write_text(content)
    world.db_max = date(2026, 5, 10)
    world.row_date = date(2026, 5, 12)
    result = _update()
    assert result.exit_code == 0, result.output
    assert world.since_seen == [date(2026, 5, 3)]  # fell back to the DB max
    assert str(crawl_state.state_path()) in result.output  # the warning names the file
    assert crawl_state.state_path().read_text() == content  # left for a human to fix


def test_a_bad_value_for_one_key_is_replaced_but_other_keys_survive(world) -> None:
    crawl_state.state_path().write_text(
        json.dumps({"hemnet/ostermalm": "garbage", "booli/vasastan": "2026-04-01", "extra": 1})
    )
    world.db_max = date(2026, 5, 10)
    world.row_date = date(2026, 5, 12)
    assert _update().exit_code == 0
    state = json.loads(crawl_state.state_path().read_text())
    assert state == {"hemnet/ostermalm": "2026-05-12", "booli/vasastan": "2026-04-01", "extra": 1}
