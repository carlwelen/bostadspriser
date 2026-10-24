"""B45: database state survives failed initial windows and failed resumptions."""
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from scraper import crawl_state, run, scrape_run
from scraper.errors import CrawlIncomplete
from tests.test_run_update import _row
from scraper.db import upsert_listing


def test_partial_cold_start_cannot_bootstrap_from_listing_max(db, monkeypatch):
    seen = []
    upsert_listing(_row("hemnet", "legacy", "ostermalm", date.today()))

    async def iterator(district, since, **kwargs):
        seen.append(since)
        yield _row("hemnet", "new", district, date.today())
        raise CrawlIncomplete("page 2 failed")

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", iterator)
    first = run._refresh("hemnet", "ostermalm", timedelta(days=7), 14)
    second = run._refresh("hemnet", "ostermalm", timedelta(days=7), 1)
    assert first.error and second.error
    assert seen == [date.today() - timedelta(days=14)] * 2
    with db.connect() as conn:
        rows = conn.execute(text('SELECT kind, since, "completeThrough" FROM "ScrapeRun"')).all()
    assert len(rows) == 2
    assert all(str(r.kind) == "update" and r.since == seen[0] and r.completeThrough is None for r in rows)


def test_no_protected_json_read_or_write(db, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("JSON state must not be accessed")

    monkeypatch.setattr(Path, "read_text", forbidden)
    monkeypatch.setattr(Path, "write_text", forbidden)
    assert crawl_state.complete_through("hemnet", "ostermalm") is None
    assert crawl_state.backfill_progress("hemnet", "ostermalm") is None


def test_durable_start_failure_prevents_fetch(db, monkeypatch):
    seen = []

    async def iterator(*args, **kwargs):
        seen.append(True)
        if False:
            yield {}

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", iterator)
    monkeypatch.setattr(scrape_run, "table", lambda name: (_ for _ in ()).throw(RuntimeError("DB down")))
    result = run._refresh("hemnet", "ostermalm", timedelta(days=7), 14)
    assert result.error
    assert seen == []


def test_latest_backfill_completion_clears_resume_without_json(db):
    first = scrape_run.start_run("hemnet", "ostermalm", kind="backfill", since=date(2025, 1, 1))
    scrape_run.finish_run(first, "partial", pages=3, rows_upserted=1, rows_rejected=0,
                          oldest_sold_at=date(2026, 1, 1), last_page=7, required=True)
    assert crawl_state.backfill_progress("hemnet", "ostermalm")["next_page"] == 8
    second = scrape_run.start_run("hemnet", "ostermalm", kind="backfill", since=date(2025, 1, 1))
    scrape_run.finish_run(second, "ok", pages=2, rows_upserted=1, rows_rejected=0,
                          oldest_sold_at=date(2025, 1, 1), last_page=9, required=True)
    assert crawl_state.backfill_progress("hemnet", "ostermalm") is None
    assert crawl_state.complete_through("hemnet", "ostermalm") is None


def test_required_recording_errors_propagate(db, monkeypatch):
    monkeypatch.setattr(scrape_run, "table", lambda name: (_ for _ in ()).throw(RuntimeError("DB down")))
    with pytest.raises(RuntimeError):
        scrape_run.start_run("hemnet", "ostermalm", kind="update", since=date(2026, 1, 1))


def test_backfill_retry_carries_committed_position_and_oldest_without_new_rows(db, monkeypatch):
    async def blocked(*args, **kwargs):
        raise CrawlIncomplete("blocked before next page")
        yield {}

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", blocked)
    report = run._run_recorded("hemnet", "ostermalm", date(2025, 1, 1), kind="backfill", start_page=7,
                               base_last_page=7, base_oldest=date(2026, 1, 1))
    assert report.error and report.state_saved
    with db.connect() as conn:
        row = conn.execute(text('SELECT * FROM "ScrapeRun"')).mappings().one()
    assert (row["kind"], row["lastPage"], row["pages"], row["oldestSoldAt"]) == (
        "backfill", 7, 0, date(2026, 1, 1))
    assert crawl_state.backfill_progress("hemnet", "ostermalm")["next_page"] == 8


def test_database_checkpoint_never_claims_uncommitted_page(db, monkeypatch):
    async def iterator(district, since, *, progress, **kwargs):
        for page in range(1, 251):
            yield _row("hemnet", str(page), district, date(2026, 5, 1))
            progress.last_completed_page = page
            progress.pages += 1

    real_upsert = run.upsert_listings
    calls = []

    def write(rows, **kwargs):
        calls.append(len(rows))
        if len(calls) == 2:
            raise RuntimeError("batch commit failed")
        return real_upsert(rows, **kwargs)

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", iterator)
    monkeypatch.setattr(run, "upsert_listings", write)
    report = run._run_recorded("hemnet", "ostermalm", date(2025, 1, 1), kind="backfill")
    assert report.upserted == 100 and report.error
    with db.connect() as conn:
        row = conn.execute(text('SELECT * FROM "ScrapeRun"')).mappings().one()
        count = conn.execute(text('SELECT count(*) FROM "Listing"')).scalar_one()
    assert count == 100
    assert row["lastPage"] == 99  # page 100's yield resumed only after that commit
    assert row["pages"] == 199  # invocation count may include uncommitted pages


def test_finish_failure_keeps_initial_window_and_never_creates_watermark(db, monkeypatch):
    seen = []

    async def iterator(district, since, **kwargs):
        seen.append(since)
        yield _row("hemnet", "one", district, date.today())

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", iterator)
    finish = scrape_run.finish_run
    monkeypatch.setattr(scrape_run, "finish_run", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("finish failed")))
    result = run._refresh("hemnet", "ostermalm", timedelta(days=7), 14)
    assert result.error and crawl_state.complete_through("hemnet", "ostermalm") is None
    monkeypatch.setattr(scrape_run, "finish_run", finish)
    assert run._refresh("hemnet", "ostermalm", timedelta(days=7), 1).error is None
    assert seen == [date.today() - timedelta(days=14)] * 2


def test_legacy_runs_never_supply_a_watermark_or_resume(db):
    rid = scrape_run.start_run("hemnet", "ostermalm")
    scrape_run.finish_run(rid, "ok", pages=30, rows_upserted=100, rows_rejected=0,
                          oldest_sold_at=date(2020, 1, 1))
    assert crawl_state.complete_through("hemnet", "ostermalm") is None
    assert crawl_state.backfill_progress("hemnet", "ostermalm") is None
    assert crawl_state.update_window("hemnet", "ostermalm", timedelta(days=7), 14)[0] == date.today() - timedelta(days=14)
