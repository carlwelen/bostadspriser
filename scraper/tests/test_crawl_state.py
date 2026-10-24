"""B45: update watermarks are successful-run state, never Listing maxima or JSON."""
from datetime import date, timedelta

import pytest
from click.testing import CliRunner

from scraper import crawl_state, run, scrape_run
from scraper.errors import CrawlIncomplete


class World:
    def __init__(self):
        self.mode = "complete"
        self.row_date = None
        self.since_seen = []

    async def iterator(self, district, since, **kwargs):
        self.since_seen.append(since)
        if self.row_date:
            yield {"source": "hemnet", "district": district, "soldAt": self.row_date}
        if self.mode != "complete":
            raise CrawlIncomplete("page 3 failed")


@pytest.fixture()
def world(monkeypatch):
    w = World()
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", w.iterator)
    monkeypatch.setattr(run, "upsert_listings", lambda rows, **kw: len(rows))
    monkeypatch.setattr(run, "latest_sold_at", lambda *args: (_ for _ in ()).throw(AssertionError("MAX is not coverage")))
    return w


def update(*args):
    return CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm", *args])


def test_partial_and_empty_runs_do_not_advance_watermark(world):
    world.row_date = date(2026, 5, 10)
    assert update().exit_code == 0
    world.row_date, world.mode = date(2026, 5, 20), "partial"
    assert update().exit_code == 1
    world.row_date, world.mode = None, "complete"
    assert update().exit_code == 0
    assert crawl_state.complete_through("hemnet", "ostermalm") == date(2026, 5, 10)
    assert world.since_seen[-2:] == [date(2026, 5, 3)] * 2


def test_successful_updates_never_move_watermark_backwards(world):
    world.row_date = date(2026, 5, 10)
    update()
    world.row_date = date(2026, 5, 5)
    update()
    assert crawl_state.complete_through("hemnet", "ostermalm") == date(2026, 5, 10)


def test_initial_window_survives_partial_and_empty_retries(world, scrape_runs):
    world.row_date, world.mode = date.today(), "partial"
    assert update("--lookback-days", "14").exit_code == 1
    world.row_date, world.mode = None, "complete"
    assert update("--lookback-days", "1").exit_code == 0
    assert world.since_seen == [date.today() - timedelta(days=14)] * 2
    assert all(r["kind"] == "update" and r["since"] == world.since_seen[0] for r in scrape_runs.runs)
    assert crawl_state.complete_through("hemnet", "ostermalm") is None


def test_state_is_scoped_to_source_district_and_kind(world):
    world.row_date = date(2026, 5, 10)
    update()
    assert crawl_state.complete_through("booli", "ostermalm") is None
    assert crawl_state.complete_through("hemnet", "vasastan") is None
    assert crawl_state.backfill_progress("hemnet", "ostermalm") is None


@pytest.mark.parametrize("method", ["start_run", "bump", "finish_run"])
def test_required_state_failures_are_command_failures(world, monkeypatch, method):
    world.row_date = date.today()
    monkeypatch.setattr(scrape_run, method, lambda *a, **k: (_ for _ in ()).throw(RuntimeError("state DB down")))
    result = update()
    assert result.exit_code == 1
    assert "state DB down" in result.output
    assert crawl_state.complete_through("hemnet", "ostermalm") is None
    if method == "start_run":
        assert world.since_seen == []


@pytest.mark.parametrize("lookback", ["0", "-1"])
def test_nonpositive_initial_lookback_cannot_be_persisted(world, scrape_runs, monkeypatch, lookback):
    monkeypatch.setattr(run, "refresh_deduped", lambda: None)
    result = update("--lookback-days", lookback)
    assert result.exit_code == 2
    assert world.since_seen == [] and scrape_runs.runs == []
