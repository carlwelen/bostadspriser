"""B46: the scraper refreshes C's DedupedListingMat snapshot after runs that wrote rows.

The real `refresh_deduped_listing()` ships with C's migration; until then (and so these
tests don't depend on it) a stand-in function that inserts into an audit table is
created in the *test* database and removed afterwards, restoring the real definition
if one was there. Mapbox and the sources are faked: no network.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date
from urllib.parse import unquote

import httpx
import pytest
from click.testing import CliRunner
from sqlalchemy import text

from scraper import backfill, hemnet, run
from scraper import db as db_module
from scraper import geocode as geo
from scraper.db import refresh_deduped, upsert_listings
from scraper.errors import CrawlIncomplete
from scraper.normalize import dedup_key
from tests.conftest import _TEST_NAME_RE

STUB = """
CREATE OR REPLACE FUNCTION refresh_deduped_listing() RETURNS void
LANGUAGE sql AS $$ INSERT INTO refresh_audit DEFAULT VALUES $$
"""
LOCK_STUB = """
CREATE OR REPLACE FUNCTION refresh_deduped_listing() RETURNS void
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'lock timeout' USING ERRCODE = '55P03'; END $$
"""
FAILING_STUB = """
CREATE OR REPLACE FUNCTION refresh_deduped_listing() RETURNS void
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'snapshot is busted'; END $$
"""


def _row(sid: str, **overrides) -> dict:
    base = {
        "id": str(uuid.uuid4()),
        "source": "hemnet",
        "sourceId": sid,
        "street": "Brahegatan",
        "houseNumber": "3A",
        "district": "ostermalm",
        "rooms": 1.0,
        "areaSqm": 35.0,
        "priceSek": 4_900_000,
        "pricePerSqmSek": 140_000,
        "soldAt": date(2026, 5, 2),
        "lat": None,
        "lng": None,
        "geocodedAt": None,
        "raw": {"fixture": True},
    }
    base.update(overrides)
    if "dedupKey" not in overrides:  # derived from the final street/house/date/price
        base["dedupKey"] = dedup_key(base["street"], base["houseNumber"], base["soldAt"], base["priceSek"])
    return base


@pytest.fixture()
def audit(db):
    """Install the stand-in refresh function; yields a callable returning the call count."""
    with db.connect() as c:
        name = c.execute(text("SELECT current_database()")).scalar_one()
    assert _TEST_NAME_RE.search(name)  # only ever touch a throwaway test database
    with db.begin() as c:
        saved = c.execute(
            text("SELECT pg_get_functiondef(to_regprocedure('refresh_deduped_listing()'))")
        ).scalar_one()
        c.execute(text("DROP FUNCTION IF EXISTS refresh_deduped_listing()"))
        c.execute(text("DROP TABLE IF EXISTS refresh_audit"))
        c.execute(text("CREATE TABLE refresh_audit (id serial PRIMARY KEY)"))
        c.execute(text(STUB))

    def count() -> int:
        with db.connect() as c:
            return c.execute(text("SELECT COUNT(*) FROM refresh_audit")).scalar_one()

    yield count
    with db.begin() as c:
        c.execute(text("DROP FUNCTION IF EXISTS refresh_deduped_listing()"))
        c.execute(text("DROP TABLE IF EXISTS refresh_audit"))
        if saved:  # C's real function was there before: put it back
            c.execute(text(saved))


@pytest.fixture()
def use_function(db, audit):
    """Swap refresh_deduped_listing() for the given SQL (None: drop it). Depends on
    `audit`, whose teardown puts C's real definition back, so no test can ever leave
    the shared test database without the real function."""

    def use(sql: str | None) -> None:
        with db.begin() as c:
            c.execute(text("DROP FUNCTION IF EXISTS refresh_deduped_listing()"))
            if sql:
                c.execute(text(sql))

    return use


def _iterator(rows_by_district: dict[str, list[dict]], fail_after: dict[str, bool] | None = None):
    async def it(district, since, *, progress=None, max_pages=None, start_page=1, **kw):
        for row in rows_by_district.get(district, []):
            yield row
            progress.pages += 1
            progress.last_completed_page = progress.pages
        if (fail_after or {}).get(district):
            raise CrawlIncomplete(f"hemnet {district} page 9 failed")

    return it


# ---------------------------------------------------------------------------
# the helper
# ---------------------------------------------------------------------------


def test_refresh_calls_the_function_in_its_own_transaction(db, audit) -> None:
    assert refresh_deduped() == "refreshed"
    assert audit() == 1


def test_upserting_never_refreshes_the_snapshot(db, audit) -> None:
    upsert_listings([_row("1"), _row("2")])
    assert audit() == 0


def test_a_missing_function_is_a_silent_no_op(use_function, caplog) -> None:
    use_function(None)
    caplog.set_level(logging.DEBUG)
    assert refresh_deduped() == "missing"
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert any(r.levelno == logging.DEBUG and "refresh_deduped_listing" in r.getMessage() for r in caplog.records)


def test_a_failing_refresh_returns_failed_logs_a_warning_and_never_raises(use_function, caplog) -> None:
    use_function(FAILING_STUB)
    assert refresh_deduped() == "failed"
    warning = next(r for r in caplog.records if r.levelno == logging.WARNING and "refresh" in r.getMessage())
    assert "sqlstate=P0001" in warning.getMessage()  # the code says why (55P03 = lock timeout)


def test_a_lock_timeout_is_reported_as_busy(use_function, caplog) -> None:
    use_function(LOCK_STUB)
    assert refresh_deduped() == "busy"
    assert any("sqlstate=55P03" in r.getMessage() for r in caplog.records)


# ---------------------------------------------------------------------------
# commands call it exactly once, after the work
# ---------------------------------------------------------------------------

SINCE = ["--since", "2026-01-01"]


def test_update_refreshes_once_after_all_combinations_even_when_one_is_partial(db, audit, monkeypatch) -> None:
    rows = {"ostermalm": [_row("a1")], "vasastan": [_row("b1", district="vasastan")]}
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", _iterator(rows, fail_after={"vasastan": True}))
    result = CliRunner().invoke(
        run.cli, ["update", "--source", "hemnet", "--district", "ostermalm", "--district", "vasastan"]
    )
    assert result.exit_code == 1  # the partial run still fails the command...
    assert audit() == 1  # ...but the snapshot was refreshed once, for both districts' rows


def test_update_refreshes_even_when_nothing_was_written(db, audit, monkeypatch) -> None:
    """`update` is the cron entry point: a refresh that failed last time must be retried
    even when later crawls find nothing new."""
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", _iterator({}))
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    assert result.exit_code == 0 and audit() == 1


def test_scrape_that_wrote_nothing_does_not_refresh(db, audit, monkeypatch) -> None:
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", _iterator({}))
    assert CliRunner().invoke(run.cli, ["scrape", "--district", "ostermalm", *SINCE]).exit_code == 0
    assert audit() == 0


def test_scrape_refreshes_once_on_success_and_on_an_incomplete_crawl(db, audit, monkeypatch) -> None:
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", _iterator({"ostermalm": [_row("1")]}))
    assert CliRunner().invoke(run.cli, ["scrape", "--district", "ostermalm", *SINCE]).exit_code == 0
    assert audit() == 1
    monkeypatch.setitem(
        run._SOURCE_ITER, "hemnet", _iterator({"ostermalm": [_row("2")]}, fail_after={"ostermalm": True})
    )
    assert CliRunner().invoke(run.cli, ["scrape", "--district", "ostermalm", *SINCE]).exit_code == 1
    assert audit() == 2  # exactly one more


def test_backfill_refreshes_once_on_success_and_when_it_stops_early(db, audit, monkeypatch) -> None:
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", _iterator({"ostermalm": [_row("1")]}))
    assert CliRunner().invoke(run.cli, ["backfill", "--district", "ostermalm", *SINCE]).exit_code == 0
    assert audit() == 1
    monkeypatch.setitem(
        run._SOURCE_ITER, "hemnet", _iterator({"ostermalm": [_row("2")]}, fail_after={"ostermalm": True})
    )
    assert CliRunner().invoke(run.cli, ["backfill", "--district", "ostermalm", *SINCE]).exit_code == 1
    assert audit() == 2


def _legacy_row(street: str) -> dict:
    card = {
        "listingId": "100", "soldAt": "1777672800.0", "streetAddress": street,
        "finalPrice": "4 900 000 kr", "livingArea": "35 m²", "squareMeterPrice": "140 000 kr/m²",
    }
    row = hemnet._to_row(card, "sodermalm")
    assert row is not None
    row.update(street="Sankt Eriksgatan 10", houseNumber="B")  # a bad legacy split reparse will fix
    return row


def test_reparse_refreshes_only_when_it_changed_rows_and_not_on_a_dry_run(db, audit) -> None:
    upsert_listings([_legacy_row("Sankt Eriksgatan 10 B")])
    assert CliRunner().invoke(run.cli, ["reparse", "--dry-run"]).exit_code == 0
    assert audit() == 0
    assert CliRunner().invoke(run.cli, ["reparse"]).exit_code == 0
    assert audit() == 1
    assert CliRunner().invoke(run.cli, ["reparse"]).exit_code == 0  # second run changes nothing
    assert audit() == 1


def _mapbox(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_geocode_refreshes_when_it_wrote_rows_only(db, audit, monkeypatch) -> None:
    upsert_listings([_row("1")])
    real = geo.geocode_pending
    monkeypatch.setattr(
        run, "geocode_pending",
        lambda **kw: real(client=_mapbox(lambda r: httpx.Response(200, json={"features": [{"center": [18.07, 59.33]}]})), **kw),
    )
    assert CliRunner().invoke(run.cli, ["geocode"]).exit_code == 0
    assert audit() == 1
    assert CliRunner().invoke(run.cli, ["geocode"]).exit_code == 0  # nothing left to geocode
    assert audit() == 1


def test_geocode_refreshes_rows_stored_before_a_rejected_token_aborts(db, audit, monkeypatch) -> None:
    monkeypatch.setattr(geo, "_new_salt", lambda: "")  # plain id order: a is geocoded before b is rejected
    upsert_listings([_row("a", street="Aaa", id="id-a"), _row("b", street="Bbb", id="id-b")])

    def handler(request):
        if "Bbb" in unquote(request.url.path):
            return httpx.Response(401, json={})
        return httpx.Response(200, json={"features": [{"center": [18.07, 59.33]}]})

    real = geo.geocode_pending
    monkeypatch.setattr(run, "geocode_pending", lambda **kw: real(client=_mapbox(handler), **kw))
    result = CliRunner().invoke(run.cli, ["geocode"])
    assert result.exit_code == 78  # the token was rejected...
    assert audit() == 1  # ...but a's coordinates were stored, so the snapshot is refreshed


def test_backfill_dedup_refreshes_when_it_filled_keys_only(db, audit) -> None:
    upsert_listings([_row("1", dedupKey=None)])
    assert CliRunner().invoke(run.cli, ["backfill-dedup"]).exit_code == 0
    assert audit() == 1
    assert CliRunner().invoke(run.cli, ["backfill-dedup"]).exit_code == 0
    assert audit() == 1


def _fail_dedup_batch(db, monkeypatch, *, fail_at: int = 2) -> RuntimeError:
    upsert_listings([
        _row("legacy-a", id="legacy-a", dedupKey=None),
        _row("legacy-b", id="legacy-b", street="Odengatan", dedupKey=None),
    ])
    failure = RuntimeError("later dedup batch failed")
    derive = backfill.dedup_key
    worker = run.backfill_dedup_keys
    calls = 0

    def fail(*args):
        nonlocal calls
        calls += 1
        if calls == fail_at:
            # A separate connection proves the previous batch committed before
            # this failure; it is not merely visible in the worker's transaction.
            with db.connect() as c:
                stored = c.execute(text(
                    'SELECT "dedupKey" FROM "Listing" WHERE id = \'legacy-a\''
                )).scalar_one()
            assert (stored is not None) == (fail_at > 1)
            raise failure
        return derive(*args)

    monkeypatch.setattr(backfill, "dedup_key", fail)
    monkeypatch.setattr(run, "backfill_dedup_keys", lambda **kw: worker(batch_size=1, **kw))
    return failure


@pytest.mark.parametrize("fail_at", [1, 2])
def test_backfill_dedup_refreshes_committed_batches_despite_a_later_failure(db, monkeypatch, fail_at) -> None:
    failure = _fail_dedup_batch(db, monkeypatch, fail_at=fail_at)
    assert refresh_deduped() == "refreshed"
    notifications = []
    monkeypatch.setattr(db_module, "revalidate_app", lambda: notifications.append(True))

    result = CliRunner().invoke(run.cli, ["backfill-dedup"])

    assert result.exit_code == 1 and result.exception is failure
    assert "backfilled" not in result.output
    with db.connect() as c:
        live = dict(c.execute(text('SELECT id, "dedupKey" FROM "Listing"')).all())
        snapshot = dict(c.execute(text('SELECT id, "dedupKey" FROM "DedupedListingMat"')).all())
    assert (live["legacy-a"] is not None) == (fail_at > 1)
    assert live["legacy-b"] is None
    assert snapshot == live
    assert notifications == ([True] if fail_at > 1 else [])


@pytest.mark.parametrize("stub,status", [(None, "missing"), (LOCK_STUB, "busy"), (FAILING_STUB, "failed")])
def test_backfill_dedup_keeps_original_failure_when_its_refresh_cannot_complete(
    db, use_function, monkeypatch, stub, status,
) -> None:
    failure = _fail_dedup_batch(db, monkeypatch)
    use_function(stub)
    attempts, notifications = [], []

    def refresh():
        attempts.append(refresh_deduped())

    monkeypatch.setattr(run, "refresh_deduped", refresh)
    monkeypatch.setattr(db_module, "revalidate_app", lambda: notifications.append(True))
    result = CliRunner().invoke(run.cli, ["backfill-dedup"])

    assert result.exit_code == 1 and result.exception is failure
    assert "backfilled" not in result.output and "refreshed" not in result.output
    assert attempts == [status]
    assert notifications == []


def test_refresh_view_command_refreshes_and_takes_the_lock(db, audit) -> None:
    from scraper.lock import single_instance

    result = CliRunner().invoke(run.cli, ["refresh-view"])
    assert result.exit_code == 0 and "refreshed" in result.output and audit() == 1
    with single_instance():
        busy = CliRunner().invoke(run.cli, ["refresh-view"])
    assert busy.exit_code == 75 and audit() == 1


def test_refresh_view_reports_a_missing_function_a_failure_and_a_busy_database(use_function) -> None:
    use_function(None)
    missing = CliRunner().invoke(run.cli, ["refresh-view"])
    assert missing.exit_code == 0 and "refresh_deduped_listing" in missing.output and "nothing to do" in missing.output
    use_function(FAILING_STUB)
    failed = CliRunner().invoke(run.cli, ["refresh-view"])
    assert failed.exit_code == 1 and "failed" in failed.output
    use_function(LOCK_STUB)
    busy = CliRunner().invoke(run.cli, ["refresh-view"])
    assert busy.exit_code == 75 and "busy" in busy.output  # a lock timeout: try again later


@pytest.mark.parametrize("stub", [None, FAILING_STUB])
def test_a_missing_or_failing_refresh_never_changes_a_crawl_exit_code(db, use_function, monkeypatch, stub) -> None:
    use_function(stub)
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", _iterator({"ostermalm": [_row("1")]}))
    update = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    scrape = CliRunner().invoke(run.cli, ["scrape", "--district", "ostermalm", *SINCE])
    assert update.exit_code == 0 and scrape.exit_code == 0
    with db.connect() as c:  # the crawl's rows are committed regardless
        assert c.execute(text('SELECT COUNT(*) FROM "Listing"')).scalar_one() == 1


# ---------------------------------------------------------------------------
# stats
# ---------------------------------------------------------------------------


@pytest.fixture()
def mat_view(db):
    """The snapshot relation: C's real one if the migration is there, else a stand-in table."""
    with db.connect() as c:
        real = c.execute(text("SELECT to_regclass('\"DedupedListingMat\"') IS NOT NULL")).scalar_one()
    if not real:
        with db.begin() as c:
            c.execute(text('CREATE TABLE "DedupedListingMat" AS SELECT * FROM "DedupedListing" WITH NO DATA'))

    def refresh() -> None:
        with db.begin() as c:
            if real:
                c.execute(text("SELECT refresh_deduped_listing()"))
            else:
                c.execute(text('INSERT INTO "DedupedListingMat" SELECT * FROM "DedupedListing"'))

    yield refresh
    if not real:
        with db.begin() as c:
            c.execute(text('DROP TABLE IF EXISTS "DedupedListingMat"'))


def test_stats_compares_the_view_with_its_snapshot(db, mat_view) -> None:
    upsert_listings([_row("1"), _row("2", street="Odengatan", houseNumber="5")])
    stale = CliRunner().invoke(run.cli, ["stats"])
    assert stale.exit_code == 0, stale.output
    assert "DedupedListing" in stale.output and "DedupedListingMat" in stale.output
    assert "differ" in stale.output  # 2 rows in the view, none in the snapshot yet
    mat_view()
    fresh = CliRunner().invoke(run.cli, ["stats"])
    assert "differ" not in fresh.output and "DedupedListingMat" in fresh.output


def test_stats_notices_content_drift_when_the_counts_still_match(db, mat_view) -> None:
    upsert_listings([_row("1")])
    mat_view()
    assert "differ" not in CliRunner().invoke(run.cli, ["stats"]).output
    with db.begin() as c:  # same row count, newer content than the snapshot
        c.execute(text("UPDATE \"Listing\" SET \"lastSeenAt\" = \"lastSeenAt\" + interval '1 day'"))
    drift = CliRunner().invoke(run.cli, ["stats"])
    assert "differ" in drift.output


def test_stats_without_a_snapshot_prints_no_comparison(db) -> None:
    with db.connect() as c:
        if c.execute(text("SELECT to_regclass('\"DedupedListingMat\"') IS NOT NULL")).scalar_one():
            return  # C's real view is present; the comparison is exercised above
    upsert_listings([_row("1")])
    out = CliRunner().invoke(run.cli, ["stats"]).output
    assert "DedupedListingMat" not in out

