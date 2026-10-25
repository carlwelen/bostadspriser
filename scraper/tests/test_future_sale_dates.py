"""B58: future source data cannot advance or strand durable update coverage."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from scraper import booli, crawl_state, hemnet, run, scrape_run
from scraper.db import upsert_listing
from scraper.source_base import CrawlProgress
from tests.test_pagination import SOURCES, _run_crawl
from tests.test_run_update import _row


def _today():
    return datetime.now(ZoneInfo("Europe/Stockholm")).date()


def _card(source, day):
    _, make_card, _ = SOURCES[source]
    sold = datetime.combine(day, time(), ZoneInfo("Europe/Stockholm")).timestamp() if source == "hemnet" else day.isoformat()
    return make_card("sale", sold=sold)


@pytest.mark.parametrize("source", SOURCES)
def test_source_rejects_tomorrow_but_accepts_today_and_history(source):
    module = hemnet if source == "hemnet" else booli
    assert module._to_row(_card(source, _today() + timedelta(days=1)), "ostermalm") is None
    for day in (_today(), date(2025, 1, 1)):
        assert module._to_row(_card(source, day), "ostermalm")["soldAt"] == day


@pytest.mark.parametrize("source", SOURCES)
def test_future_only_page_is_rejected_without_hiding_following_current_cards(source, monkeypatch):
    module, make_card, extract = SOURCES[source]
    future = _card(source, date(2099, 1, 1))
    progress = CrawlProgress()
    ids, incomplete = _run_crawl(module, monkeypatch, extract, {1: [future], 2: [make_card("current")]}, progress=progress)
    assert incomplete is None and ids == ["current"]
    assert progress.rejected == 1
    assert progress.oldest_sold_at == date(2026, 5, 2)


def _finished_update(through, since):
    rid = scrape_run.start_run("hemnet", "ostermalm", kind="update", since=since)
    scrape_run.finish_run(rid, "ok", pages=1, rows_upserted=1, rows_rejected=0,
                          oldest_sold_at=since, complete_through=through, required=True)
    return rid


def test_ingestion_rejects_future_rows_and_bounds_inherited_watermark(db, monkeypatch):
    today = _today()

    async def source(*args, **kwargs):
        yield _row("hemnet", "future", "ostermalm", date(2099, 1, 1))
        yield _row("hemnet", "current", "ostermalm", today)

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", source)
    report = run._run_recorded("hemnet", "ostermalm", today - timedelta(days=14),
                               kind="update", watermark=date(2099, 1, 1))
    assert report.error is None and report.upserted == 1
    assert report.progress.rejected == 1
    with db.connect() as c:
        assert c.execute(text('SELECT "sourceId" FROM "Listing"')).scalars().all() == ["current"]
        assert c.execute(text('SELECT "completeThrough" FROM "ScrapeRun"')).scalar_one() == today


@pytest.mark.parametrize("prior", [False, True])
def test_legacy_future_watermark_and_retry_window_recover_without_listing_max(db, monkeypatch, prior):
    today = _today()
    historical = today - timedelta(days=20)
    if prior:
        _finished_update(historical, historical - timedelta(days=14))
    _finished_update(date(2099, 1, 1), today - timedelta(days=14))
    retry = scrape_run.start_run("hemnet", "ostermalm", kind="update", since=date(2098, 12, 25))
    scrape_run.finish_run(retry, "failed", pages=0, rows_upserted=0, rows_rejected=0,
                          oldest_sold_at=None, required=True)
    upsert_listing(_row("hemnet", "legacy-future", "ostermalm", date(2099, 1, 1)))
    monkeypatch.setattr(run, "latest_sold_at", lambda *a: pytest.fail("Listing max is not coverage"))
    expected = (historical - timedelta(days=7), historical) if prior else (today - timedelta(days=14), None)
    assert crawl_state.update_window("hemnet", "ostermalm", timedelta(days=7), 14) == expected
    seen = []

    async def source(district, since, **kwargs):
        seen.append(since)
        yield _row("hemnet", "recovered", district, today)

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", source)
    assert run._refresh("hemnet", "ostermalm", timedelta(days=7), 14).error is None
    assert seen == [expected[0]]
    assert crawl_state.update_window("hemnet", "ostermalm", timedelta(days=7), 14) == (today - timedelta(days=7), today)


def test_future_initial_window_cannot_strand_a_cold_update(db):
    rid = scrape_run.start_run("hemnet", "ostermalm", kind="update", since=date(2099, 1, 1))
    scrape_run.finish_run(rid, "failed", pages=0, rows_upserted=0, rows_rejected=0, oldest_sold_at=None, required=True)
    assert crawl_state.update_window("hemnet", "ostermalm", timedelta(days=7), 14) == (_today() - timedelta(days=14), None)


@pytest.mark.parametrize("source", SOURCES)
@pytest.mark.parametrize("instant, local_day", [
    ("2026-05-01T22:30:00+00:00", date(2026, 5, 2)),
    ("2026-10-25T23:30:00+00:00", date(2026, 10, 26)),
])
def test_source_and_coverage_use_stockholm_day_across_utc_midnight(source, instant, local_day, monkeypatch):
    from scraper import dates

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromisoformat(instant).astimezone(tz)

    monkeypatch.setattr(dates, "datetime", FrozenDatetime)
    module = hemnet if source == "hemnet" else booli
    assert module._to_row(_card(source, local_day), "ostermalm")["soldAt"] == local_day
    assert module._to_row(_card(source, local_day + timedelta(days=1)), "ostermalm") is None
    assert crawl_state.update_window("hemnet", "ostermalm", timedelta(days=7), 14) == (local_day - timedelta(days=14), None)

    async def source_rows(*args, **kwargs):
        yield {"soldAt": local_day}

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", source_rows)
    monkeypatch.setattr(run, "upsert_listings", lambda rows, **kwargs: len(rows))
    report = run._run_recorded("hemnet", "ostermalm", local_day - timedelta(days=14), kind="update")
    assert report.error is None and report.upserted == 1
    assert crawl_state.complete_through("hemnet", "ostermalm") == local_day


def test_future_only_empty_update_preserves_previous_valid_watermark(db, monkeypatch):
    today = _today()
    historical = today - timedelta(days=20)
    _finished_update(historical, historical - timedelta(days=14))

    async def source(*args, **kwargs):
        yield _row("hemnet", "future", "ostermalm", date(2099, 1, 1))

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", source)
    result = run._refresh("hemnet", "ostermalm", timedelta(days=7), 14)
    assert result.error is None and result.upserted == 0
    assert crawl_state.complete_through("hemnet", "ostermalm") == historical


def test_recovery_keeps_valid_initial_window_from_future_poisoned_run(db):
    initial = _today() - timedelta(days=60)
    _finished_update(date(2099, 1, 1), initial)
    assert crawl_state.update_window("hemnet", "ostermalm", timedelta(days=7), 14) == (initial, None)
