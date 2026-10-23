"""DB-backed tests for the upsert path (uses the `db` fixture → test database)."""

from __future__ import annotations

import uuid
from datetime import date

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
