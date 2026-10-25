"""Independent round-2 probes. Run after copying to scraper/tests/."""
from contextlib import contextmanager
from datetime import date, datetime, timezone
from unittest.mock import Mock

import pytest
from click.testing import CliRunner
from sqlalchemy import text

from scraper import geocode, run
from scraper.db import refresh_deduped, upsert_listing, upsert_listings
from tests.test_refresh_view import _row


def test_geocode_late_database_failure_publishes_previously_committed_coordinates(db, monkeypatch):
    rows = [_row(f"audit2-{i}", id=f"audit2-{i:03d}", houseNumber=str(i + 1)) for i in range(101)]
    upsert_listings(rows)
    assert refresh_deduped() == "refreshed"
    original_session = geocode.session
    sessions = 0

    @contextmanager
    def failing_late_session():
        nonlocal sessions
        sessions += 1
        with original_session() as session:
            # Session 1 is legacy maintenance; 2 selection; 3 commits 100 outcomes.
            # Fail the later write (and its final retry), as a lost DB connection does.
            if sessions >= 4:
                monkeypatch.setattr(session, "execute", Mock(side_effect=RuntimeError("late database failure")))
            yield session

    monkeypatch.setattr(geocode, "session", failing_late_session)
    monkeypatch.setattr(geocode, "_lookup", lambda *_args: (18.07, 59.33))
    monkeypatch.setattr(geocode, "_sleep", lambda *_args: None)
    monkeypatch.setattr(geocode, "_new_salt", lambda: "")
    calls = []
    monkeypatch.setattr(run, "refresh_deduped", lambda: calls.append(refresh_deduped()))
    result = CliRunner().invoke(run.cli, ["geocode", "--limit", "101"])
    assert result.exit_code == 1
    assert "late database failure" in str(result.exception)
    with db.connect() as connection:
        live = connection.execute(text('SELECT count(*) FROM "Listing" WHERE lat IS NOT NULL')).scalar_one()
        snapshot = connection.execute(text('SELECT count(*) FROM "DedupedListingMat" WHERE lat IS NOT NULL')).scalar_one()
    print({"exit": result.exit_code, "committed_geocodes": live, "published_geocodes": snapshot, "refreshes": calls})
    assert live == 100
    assert snapshot == live, "Earlier committed geocodes must publish even when a later DB batch fails"


def test_changed_address_does_not_keep_geocoded_old_location(db):
    original = _row("changed-address", street="Brahegatan", houseNumber="3A", lat=59.34, lng=18.08,
                    geocodedAt=datetime.now(timezone.utc))
    upsert_listing(original)
    with db.begin() as connection:
        connection.execute(text('UPDATE "Listing" SET "geocodeStatus" = \'ok\''))
    corrected = _row("changed-address", street="Götgatan", houseNumber="80", district="sodermalm")
    upsert_listing(corrected)
    assert refresh_deduped() == "refreshed"
    with db.connect() as connection:
        row = connection.execute(text('SELECT street, "houseNumber", district, lat, lng, "geocodeStatus" FROM "DedupedListingMat"')).mappings().one()
    print(dict(row))
    assert (row["lat"], row["lng"]) == (None, None), "Coordinates for the old address cannot describe its correction"


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("closed_script", [False, True])
def test_malformed_middle_page_does_not_publish_complete_coverage(db, monkeypatch, source, closed_script):
    import json
    from scraper import booli, hemnet, source_base, crawl_state
    from tests.test_pagination import _PW, _booli_card, _hemnet_card
    module, card = (hemnet, _hemnet_card) if source == "hemnet" else (booli, _booli_card)
    today = date(2026, 5, 2)
    monkeypatch.setattr(run, "stockholm_today", lambda: today)
    monkeypatch.setattr(crawl_state, "stockholm_today", lambda: today)
    def html(cards):
        apollo = {str(i): {**value, "__typename": module.SOURCE.ready_marker} for i, value in enumerate(cards)}
        payload = {"props": {"pageProps": {"__APOLLO_STATE__": apollo}}}
        return '<script id="__NEXT_DATA__" type="application/json">' + json.dumps(payload) + '</script>'
    pages = {1: html([card("new")]), 2: '<script id="__NEXT_DATA__" type="application/json">{"__APOLLO_STATE__":"' + module.SOURCE.ready_marker,
             3: html([card("old", sold="1775692800" if source == "hemnet" else "2026-04-09")])}
    if closed_script:
        pages[2] += '</script>'
    fetched = []
    async def fetch(_ctx, _cfg, desc, url):
        page = int(url.rsplit("page=", 1)[1])
        fetched.append(page)
        value = pages.get(page, html([]))
        assert desc.looks_real(value)
        return value
    async def noop(*_args):
        pass
    monkeypatch.setattr(source_base, "async_playwright", lambda: _PW())
    monkeypatch.setattr(source_base, "warmup", noop)
    monkeypatch.setattr(source_base, "fetch", fetch)
    report = run._run_recorded(source, "ostermalm", date(2026, 4, 1), kind="update")
    print({"fetched": fetched, "error": report.error, "watermark": crawl_state.complete_through(source, "ostermalm")})
    assert report.error is not None, "Malformed payload cannot prove the end of source history"
    assert crawl_state.complete_through(source, "ostermalm") is None


@pytest.mark.parametrize("source", ["hemnet", "booli"])
def test_large_final_price_rejects_before_bigint_insert(db, source):
    from scraper import booli, hemnet
    from tests.test_pagination import _booli_card, _hemnet_card
    module, card = (hemnet, _hemnet_card("huge")) if source == "hemnet" else (booli, _booli_card("huge"))
    if source == "hemnet":
        card["finalPrice"] = "100000000000000000000 kr"
    else:
        card["soldPrice"]["raw"] = 100000000000000000000
    parsed = module._to_row(card, "ostermalm")
    from sqlalchemy.exc import DataError
    if parsed is not None:
        with pytest.raises(DataError, match="bigint out of range"):
            upsert_listings([_row("valid-neighbor"), parsed])
        with db.connect() as connection:
            count = connection.execute(text('SELECT count(*) FROM "Listing"')).scalar_one()
        print({"accepted_price": parsed["priceSek"], "valid_neighbor_stored": count})
    assert parsed is None
