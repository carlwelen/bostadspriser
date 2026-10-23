"""DB-backed tests for the upsert path (uses the `db` fixture → test database)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import text

from scraper.db import upsert_listing
from scraper.normalize import dedup_key


def _row(**overrides) -> dict:
    base = {
        "id": str(uuid.uuid4()),
        "source": "hemnet",
        "sourceId": "123",
        "street": "Brahegatan",
        "houseNumber": "3A",
        "district": "ostermalm",
        "rooms": 1.0,
        "areaSqm": 35.0,
        "priceSek": 4_900_000,
        "pricePerSqmSek": 140_000,
        "soldAt": date(2026, 5, 2),
        "lat": 59.3371735,
        "lng": 18.0753784,
        "geocodedAt": None,
        "raw": {"fixture": True},
    }
    base["dedupKey"] = dedup_key(base["street"], base["houseNumber"], base["soldAt"], base["priceSek"])
    base.update(overrides)
    return base


def test_harness_uses_a_test_database(db) -> None:
    with db.connect() as c:
        assert "test" in c.execute(text("SELECT current_database()")).scalar_one()


def test_upsert_inserts_then_updates_on_natural_key(db) -> None:
    upsert_listing(_row())
    # Same (source, sourceId), new id and price: must update in place.
    upsert_listing(_row(priceSek=5_000_000))
    with db.connect() as c:
        rows = c.execute(text('SELECT "priceSek" FROM "Listing"')).all()
    assert [int(r[0]) for r in rows] == [5_000_000]


def test_upsert_keeps_sources_separate(db) -> None:
    upsert_listing(_row())
    upsert_listing(_row(source="booli"))
    with db.connect() as c:
        n = c.execute(text('SELECT COUNT(*) FROM "Listing"')).scalar_one()
        deduped = c.execute(text('SELECT COUNT(*) FROM "DedupedListing"')).scalar_one()
    assert n == 2
    assert deduped == 1


def _coords(db) -> tuple:
    with db.connect() as c:
        return tuple(c.execute(text('SELECT lat, lng, "geocodedAt" FROM "Listing"')).one())


def test_upsert_keeps_existing_coordinates_when_incoming_are_null(db) -> None:
    stamp = datetime(2026, 5, 3, 12, 0)
    upsert_listing(_row(geocodedAt=stamp))
    # A re-scrape of the same sale that carries no coordinates.
    upsert_listing(_row(priceSek=5_000_000, lat=None, lng=None, geocodedAt=None))
    lat, lng, geocoded_at = _coords(db)
    assert (lat, lng) == (59.3371735, 18.0753784)
    assert geocoded_at == stamp
    with db.connect() as c:
        assert c.execute(text('SELECT "priceSek" FROM "Listing"')).scalar_one() == 5_000_000


def test_upsert_keeps_trio_together_when_only_one_incoming_coordinate_is_null(db) -> None:
    stamp = datetime(2026, 5, 3, 12, 0)
    upsert_listing(_row(geocodedAt=stamp))
    upsert_listing(_row(lat=1.0, lng=None, geocodedAt=datetime(2026, 6, 1)))
    lat, lng, geocoded_at = _coords(db)
    assert (lat, lng, geocoded_at) == (59.3371735, 18.0753784, stamp)


def test_upsert_overwrites_coordinates_when_incoming_has_them(db) -> None:
    upsert_listing(_row(geocodedAt=None))
    new_stamp = datetime(2026, 6, 1, 9, 0)
    upsert_listing(_row(lat=59.4, lng=18.1, geocodedAt=new_stamp))
    assert _coords(db) == (59.4, 18.1, new_stamp)


def test_upsert_stores_null_coordinates_on_first_insert(db) -> None:
    upsert_listing(_row(lat=None, lng=None, geocodedAt=None))
    assert _coords(db) == (None, None, None)


def test_upsert_never_overwrites_id(db) -> None:
    first = _row()
    upsert_listing(first)
    upsert_listing(_row(id=str(uuid.uuid4()), priceSek=5_000_000))
    with db.connect() as c:
        assert c.execute(text('SELECT id FROM "Listing"')).scalar_one() == first["id"]


def test_session_timezone_is_pinned_to_utc_whatever_the_server_default(db) -> None:
    """geocodedAt/scrapedAt are `timestamp(3)` (no zone): the value stored for an aware
    datetime must not depend on the DB's TimeZone setting."""
    with db.connect() as c:
        name = c.execute(text("SELECT current_database()")).scalar_one()
    assert "test" in name  # only ever alter a throwaway test database
    with db.begin() as c:
        c.execute(text(f'ALTER DATABASE "{name}" SET timezone = \'Asia/Tokyo\''))
    try:
        db.dispose()  # drop pooled connections so new ones pick up the setting
        stamp = datetime(2026, 5, 3, 12, 0, tzinfo=timezone.utc)
        upsert_listing(_row(geocodedAt=stamp))
        with db.connect() as c:
            assert c.execute(text("SHOW timezone")).scalar_one() == "UTC"
            stored = c.execute(text('SELECT "geocodedAt" FROM "Listing"')).scalar_one()
        assert stored == datetime(2026, 5, 3, 12, 0)
    finally:
        with db.begin() as c:
            c.execute(text(f'ALTER DATABASE "{name}" RESET timezone'))
        db.dispose()
