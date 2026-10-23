"""DB tests for batched upserts (`upsert_listings`) and the `_ingest` buffering."""

from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import text

from scraper.db import upsert_listing, upsert_listings
from scraper.errors import CrawlIncomplete
from scraper.normalize import dedup_key
from scraper.run import _ingest


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
        "lat": 59.3371735,
        "lng": 18.0753784,
        "geocodedAt": datetime(2026, 5, 3, 12, 0),
        "raw": {"fixture": True},
    }
    base["dedupKey"] = dedup_key(base["street"], base["houseNumber"], base["soldAt"], base["priceSek"])
    base.update(overrides)
    return base


def _all(db) -> dict[str, dict]:
    with db.connect() as c:
        rows = c.execute(text('SELECT * FROM "Listing"')).mappings().all()
    return {r["sourceId"]: dict(r) for r in rows}


def test_batch_inserts_many_rows_and_is_idempotent(db) -> None:
    rows = [_row(str(i)) for i in range(25)]
    assert upsert_listings(rows, batch_size=10) == 25
    assert len(_all(db)) == 25
    ids = {r["sourceId"]: r["id"] for r in _all(db).values()}
    # Re-run with new ids and a changed price: updated in place, ids kept.
    again = [_row(str(i), priceSek=5_000_000) for i in range(25)]
    assert upsert_listings(again, batch_size=10) == 25
    after = _all(db)
    assert len(after) == 25
    assert {r["priceSek"] for r in after.values()} == {5_000_000}
    assert {r["sourceId"]: r["id"] for r in after.values()} == ids


def _stamps(db) -> dict[str, tuple[datetime, datetime]]:
    with db.connect() as c:
        rows = c.execute(text('SELECT "sourceId", "scrapedAt", "lastSeenAt" FROM "Listing"')).all()
    return {r[0]: (r[1], r[2]) for r in rows}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.mark.parametrize("batched", [False, True])
def test_every_upsert_bumps_last_seen_at_but_never_scraped_at(db, batched) -> None:
    """B9: `lastSeenAt` is the latest sighting; `scrapedAt` stays the first insert."""

    def put(row: dict) -> None:
        upsert_listings([row]) if batched else upsert_listing(row)

    put(_row("seen"))
    scraped, seen = _stamps(db)["seen"]
    assert abs((seen - _utc_now()).total_seconds()) < 60  # set on insert (DB default, UTC)

    old = datetime(2020, 1, 1)
    with db.begin() as c:
        c.execute(text('UPDATE "Listing" SET "scrapedAt" = :t, "lastSeenAt" = :t'), {"t": old})
    put(_row("seen", priceSek=5_000_000))  # re-scrape of the same sale
    scraped, seen = _stamps(db)["seen"]
    assert scraped == old  # first-insert time untouched
    assert abs((seen - _utc_now()).total_seconds()) < 60  # bumped on conflict


def test_server_stamps_from_the_caller_are_ignored_on_insert_and_update(db) -> None:
    bogus = datetime(2001, 1, 1)
    upsert_listings([_row("x", lastSeenAt=bogus, scrapedAt=bogus)])  # insert path
    scraped, seen = _stamps(db)["x"]
    assert bogus not in (scraped, seen)
    assert abs((seen - _utc_now()).total_seconds()) < 60
    upsert_listings([_row("x", lastSeenAt=bogus, scrapedAt=bogus)])  # conflict path
    assert bogus not in _stamps(db)["x"]


def test_batch_with_empty_input_is_a_no_op(db) -> None:
    assert upsert_listings([]) == 0
    assert _all(db) == {}


def test_duplicate_natural_key_inside_a_batch_last_one_wins(db) -> None:
    """Postgres refuses to affect one row twice in a single ON CONFLICT statement."""
    first = _row("dup", priceSek=1_000_000)
    last = _row("dup", priceSek=2_000_000)
    other = _row("other")
    assert upsert_listings([first, other, last]) == 2  # distinct rows written
    rows = _all(db)
    assert set(rows) == {"dup", "other"}
    assert rows["dup"]["priceSek"] == 2_000_000
    assert rows["dup"]["id"] == first["id"]  # the first row's id is the one inserted


def test_duplicate_in_batch_keeps_earlier_coordinates_when_the_last_has_none(db) -> None:
    """Same result as upserting the two rows one after the other."""
    with_coords = _row("dup")
    without = _row("dup", lat=None, lng=None, geocodedAt=None, priceSek=2_000_000)
    upsert_listings([with_coords, without])
    row = _all(db)["dup"]
    assert (row["lat"], row["lng"]) == (59.3371735, 18.0753784)
    assert row["geocodedAt"] == datetime(2026, 5, 3, 12, 0)
    assert row["priceSek"] == 2_000_000


def test_duplicates_with_different_key_sets_merge_like_sequential_upserts(db) -> None:
    """In-batch duplicates must not drop columns the last row doesn't mention."""
    # (a) the last row has no lat/lng/geocodedAt keys at all
    full = _row("a", rooms=2.0)
    no_coord_keys = {k: v for k, v in _row("a", priceSek=2_000_000, rooms=2.0).items() if k not in {"lat", "lng", "geocodedAt"}}
    # (b) the last row has no `rooms` key
    base_b = _row("b", rooms=3.0)
    no_rooms = {k: v for k, v in _row("b", priceSek=3_000_000).items() if k != "rooms"}
    upsert_listings([full, no_coord_keys, base_b, no_rooms])
    rows = _all(db)
    assert (rows["a"]["lat"], rows["a"]["lng"]) == (59.3371735, 18.0753784)
    assert rows["a"]["geocodedAt"] == datetime(2026, 5, 3, 12, 0)
    assert rows["a"]["priceSek"] == 2_000_000 and rows["a"]["rooms"] == 2
    assert rows["b"]["rooms"] == 3 and rows["b"]["priceSek"] == 3_000_000


def test_three_way_duplicate_merges_in_order(db) -> None:
    first = _row("t", rooms=1.0, lat=1.0, lng=2.0, geocodedAt=datetime(2026, 5, 1))
    second = _row("t", priceSek=2_000_000, lat=None, lng=None, geocodedAt=None)  # no coords: keep first's
    third_dict = _row("t", priceSek=3_000_000, lat=5.0, lng=6.0, geocodedAt=datetime(2026, 6, 1))
    third = {k: v for k, v in third_dict.items() if k != "rooms"}  # has coords, no rooms key
    upsert_listings([first, second, third])
    row = _all(db)["t"]
    assert (row["lat"], row["lng"], row["geocodedAt"]) == (5.0, 6.0, datetime(2026, 6, 1))
    assert row["priceSek"] == 3_000_000 and row["rooms"] == 1
    assert row["id"] == first["id"]


def test_same_source_id_in_different_sources_is_not_a_duplicate(db) -> None:
    assert upsert_listings([_row("1"), _row("1", source="booli")]) == 2
    with db.connect() as c:
        assert c.execute(text('SELECT COUNT(*) FROM "Listing"')).scalar_one() == 2


def test_batch_preserves_existing_coordinates_row_by_row(db) -> None:
    stamp = datetime(2026, 5, 3, 12, 0)
    upsert_listing(_row("keep", geocodedAt=stamp))
    upsert_listing(_row("replace", lat=1.0, lng=2.0, geocodedAt=stamp))
    batch = [
        _row("keep", lat=None, lng=None, geocodedAt=None, priceSek=5_000_000),  # no coords: keep
        _row("replace", lat=3.0, lng=4.0, geocodedAt=datetime(2026, 6, 1)),  # coords: replace
        _row("new", lat=None, lng=None, geocodedAt=None),  # new row without coords
    ]
    upsert_listings(batch)
    rows = _all(db)
    assert (rows["keep"]["lat"], rows["keep"]["lng"], rows["keep"]["geocodedAt"]) == (
        59.3371735, 18.0753784, stamp,
    )
    assert rows["keep"]["priceSek"] == 5_000_000
    assert (rows["replace"]["lat"], rows["replace"]["lng"]) == (3.0, 4.0)
    assert rows["replace"]["geocodedAt"] == datetime(2026, 6, 1)
    assert (rows["new"]["lat"], rows["new"]["lng"], rows["new"]["geocodedAt"]) == (None, None, None)


def test_rows_with_different_key_sets_are_all_written(db) -> None:
    no_coords = {k: v for k, v in _row("a").items() if k not in {"lat", "lng", "geocodedAt"}}
    assert upsert_listings([_row("b"), no_coords]) == 2
    assert set(_all(db)) == {"a", "b"}


def test_mid_batch_failure_rolls_back_only_that_batch(db) -> None:
    rows = [_row("1"), _row("2"), _row("3"), _row("4", priceSek=None)]  # NOT NULL violation
    with pytest.raises(Exception):  # noqa: B017 - IntegrityError, wrapped by SQLAlchemy
        upsert_listings(rows, batch_size=2)
    # Batch [1, 2] committed; batch [3, 4] rolled back as a whole.
    assert set(_all(db)) == {"1", "2"}


def _fake_iter(rows: list[dict], error: Exception | None = None):
    async def it():
        for r in rows:
            yield r
        if error:
            raise error

    return it()


def test_ingest_buffers_in_batches_and_flushes_the_tail(db, monkeypatch) -> None:
    sizes: list[int] = []
    real = upsert_listings

    def spy(batch, **kw):
        sizes.append(len(batch))
        return real(batch, **kw)

    kwargs: list[dict] = []

    def spy_kw(batch, **kw):
        kwargs.append(kw)
        return spy(batch, **kw)

    monkeypatch.setattr("scraper.run.upsert_listings", spy_kw)
    n = asyncio.run(_ingest(_fake_iter([_row(str(i)) for i in range(7)]), batch_size=3))
    assert n == 7
    assert sizes == [3, 3, 1]
    assert all(kw == {"batch_size": 3} for kw in kwargs)  # the batch size is passed through
    assert len(_all(db)) == 7


def test_ingest_counts_what_upsert_listings_reports(db) -> None:
    """Duplicates inside a batch collapse; the count follows the return value."""
    rows = [_row("same"), _row("same", priceSek=2), _row("other")]
    assert asyncio.run(_ingest(_fake_iter(rows), batch_size=10)) == 2


def test_ingest_keeps_buffered_rows_when_the_iterator_fails(db) -> None:
    flushed: list[int] = []
    with pytest.raises(CrawlIncomplete):
        asyncio.run(
            _ingest(
                _fake_iter([_row("1"), _row("2")], CrawlIncomplete("page 3 failed")),
                batch_size=100,
                on_batch=flushed.append,
            )
        )
    assert set(_all(db)) == {"1", "2"}  # the unflushed buffer was written before re-raising
    assert flushed == [2]
