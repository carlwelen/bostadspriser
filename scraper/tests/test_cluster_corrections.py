"""B57: corrections and their cluster repairs commit atomically, without network."""

from datetime import timedelta

import pytest
from click.testing import CliRunner
from sqlalchemy import event, text

from scraper import cluster as cluster_mod
from scraper import hemnet, reparse as reparse_mod, run
from scraper.backfill import backfill_dedup_keys
from scraper.cluster import match_clusters
from scraper.db import refresh_deduped, upsert_listings
from scraper.errors import CrawlIncomplete
from tests.test_cluster import DAY, _clusters, _row


def _count(db, view="DedupedListingMat"):
    assert view in {"DedupedListing", "DedupedListingMat"}
    with db.connect() as c:
        return c.execute(text(f'SELECT count(*) FROM "{view}"')).scalar_one()


def _seed_pair(db, **extra):
    upsert_listings([_row("hemnet", "h", **extra), _row("booli", "b", price=4_905_000)])
    assert match_clusters().rows_updated == 2
    assert refresh_deduped() == "refreshed"
    assert _count(db) == 1


@pytest.mark.parametrize("command", ["scrape", "backfill"])
@pytest.mark.parametrize("partial", [False, True])
def test_explicit_correction_publishes_split_sale(db, monkeypatch, command, partial):
    _seed_pair(db)

    async def corrected(*args, **kwargs):
        yield _row("hemnet", "h", price=6_000_000)
        if partial:
            raise CrawlIncomplete("offline page failure")

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", corrected)
    result = CliRunner().invoke(run.cli, [
        command, "--source", "hemnet", "--district", "ostermalm", "--since", "2026-05-01",
    ])
    assert result.exit_code == (1 if partial else 0), result.output
    if partial:
        assert "offline page failure" in result.output
    assert _count(db) == 2
    assert set(_clusters(db).values()) == {None}


def _raw(price="6 000 000 kr"):
    return {
        "listingId": "h", "streetAddress": "Brahegatan 3A", "soldAt": "1777845600",
        "livingArea": "35 m²", "rooms": "1 rum", "finalPrice": price,
        "squareMeterPrice": "171 429 kr/m²",
    }


def test_reparse_correction_publishes_split_sale(db):
    raw = _raw()
    assert hemnet.card_fields(raw, "ostermalm")["soldAt"] == DAY
    _seed_pair(db, raw=raw)
    result = CliRunner().invoke(run.cli, ["reparse"])
    assert result.exit_code == 0, result.output
    assert _count(db) == 2


@pytest.mark.parametrize("correction", [
    {"priceSek": 6_000_000}, {"street": "Odengatan"}, {"houseNumber": "5"},
    {"soldAt": DAY + timedelta(days=4)}, {"areaSqm": 60}, {"rooms": 3},
    {"dedupKey": None},
])
def test_upsert_repairs_every_matching_fact_before_commit(db, correction):
    _seed_pair(db)
    # Keep the old dedupKey unless explicitly corrected: physical facts aren't
    # part of that key, so testing only key changes misses genuine corrections.
    with db.connect() as c:
        key = c.execute(text('SELECT "dedupKey" FROM "Listing" WHERE "sourceId" = \'h\'')).scalar_one()
    row = _row("hemnet", "h", dedupKey=key)
    row.update(correction)
    upsert_listings([row])
    assert _count(db, "DedupedListing") == 2


def test_later_failed_upsert_batch_keeps_earlier_correction_repaired(db):
    _seed_pair(db)
    with pytest.raises(Exception):  # noqa: B017 - the original NOT NULL failure
        upsert_listings([
            _row("hemnet", "h", price=6_000_000), _row("hemnet", "bad", priceSek=None),
        ], batch_size=1)
    assert _count(db, "DedupedListing") == 2
    assert refresh_deduped() == "refreshed"
    assert _count(db) == 2


def test_correction_cannot_inherit_obsolete_group_from_an_exact_copy(db):
    _seed_pair(db)
    # The extra row inherits h's cluster in the view without its own clusterId.
    upsert_listings([_row("hemnet", "h-copy")])
    assert _clusters(db)["h-copy"] is None
    assert _count(db, "DedupedListing") == 1
    upsert_listings([_row("hemnet", "h", price=6_000_000)])
    assert _count(db, "DedupedListing") == 2
    assert _clusters(db)["h"] is None
    assert _clusters(db)["h-copy"] == _clusters(db)["b"] is not None


def test_still_matching_correction_preserves_valid_and_unrelated_groups(db):
    _seed_pair(db)
    upsert_listings([
        _row("hemnet", "other-h", street="Odengatan"),
        _row("booli", "other-b", street="Odengatan", price=4_905_000),
    ])
    match_clusters()
    before = _clusters(db)
    upsert_listings([_row("hemnet", "h", rooms=1.5)])
    assert _clusters(db) == before
    assert match_clusters().rows_updated == 0


def test_unchanged_decimal_and_nonmatching_fields_do_not_rebuild(db, monkeypatch):
    upsert_listings([
        _row("hemnet", "h", areaSqm=35.3, rooms=1.3),
        _row("booli", "b", price=4_905_000, areaSqm=35.3, rooms=1.3),
    ])
    match_clusters()
    before = _clusters(db)

    def unexpected(**kwargs):
        raise AssertionError("unchanged matching facts must not rebuild")

    monkeypatch.setattr(cluster_mod, "match_clusters", unexpected)
    upsert_listings([_row("hemnet", "h", areaSqm=35.3, rooms=1.3,
                          raw={"changed": True}, pricePerSqmSek=150_000)])
    assert _clusters(db) == before


def test_matcher_failure_rolls_back_current_correction_only(db, monkeypatch):
    _seed_pair(db)
    before = _clusters(db)

    def broken(**kwargs):
        raise RuntimeError("offline matcher failure")

    monkeypatch.setattr(cluster_mod, "match_clusters", broken)
    with pytest.raises(RuntimeError, match="offline matcher failure"):
        upsert_listings([_row("hemnet", "new", street="Odengatan"),
                         _row("hemnet", "h", price=6_000_000)], batch_size=1)
    assert _clusters(db) == {**before, "new": None}
    with db.connect() as c:
        assert c.execute(text('SELECT "priceSek" FROM "Listing" WHERE "sourceId" = \'h\'')).scalar_one() == 4_900_000
    assert _count(db, "DedupedListing") == 2  # original pair and prior committed new row


def test_reparse_partial_failure_preserves_error_and_repairs_committed_batch(db, monkeypatch):
    _seed_pair(db, id="a", raw=_raw())
    upsert_listings([_row("hemnet", "later", id="z", raw={"fail": True}, street="Odengatan")])
    real = reparse_mod._DERIVERS["hemnet"]

    def derive(raw, district):
        if raw.get("fail"):
            raise RuntimeError("offline later parser failure")
        return real(raw, district)

    monkeypatch.setitem(reparse_mod._DERIVERS, "hemnet", derive)
    result = CliRunner().invoke(run.cli, ["reparse", "--batch-size", "1"])
    assert result.exit_code == 1
    assert isinstance(result.exception, RuntimeError)
    assert str(result.exception) == "offline later parser failure"
    assert _count(db) == 3


def test_reparse_dry_run_preserves_clusters_and_snapshot(db):
    _seed_pair(db, raw=_raw())
    before = _clusters(db)
    result = CliRunner().invoke(run.cli, ["reparse", "--dry-run"])
    assert result.exit_code == 0, result.output
    assert _clusters(db) == before
    assert _count(db) == 1


def test_reparse_correction_and_groups_are_not_visible_before_commit(db):
    _seed_pair(db, raw=_raw())
    observations = []

    def before_commit(session):  # noqa: ARG001
        # An independent connection sees the old facts/group together until the
        # correcting transaction commits, even after the matcher has written.
        with db.connect() as c:
            observations.append(c.execute(text('SELECT "priceSek" FROM "Listing" WHERE "sourceId" = \'h\'')).scalar_one())
            observations.append(_count(db, "DedupedListing"))

    from sqlalchemy.orm import Session

    event.listen(Session, "before_commit", before_commit)
    try:
        reparse_mod.reparse()
    finally:
        event.remove(Session, "before_commit", before_commit)
    assert observations == [4_900_000, 1]
    assert _count(db, "DedupedListing") == 2


def test_correction_rebuild_retains_one_key_per_source(db):
    _seed_pair(db)
    upsert_listings([_row("hemnet", "h2", price=6_000_000)])
    upsert_listings([_row("hemnet", "h2", price=4_910_000)])
    assert _count(db, "DedupedListing") == 2
    with db.connect() as c:
        assert c.execute(text(
            'SELECT "clusterId", source FROM "Listing" WHERE "clusterId" IS NOT NULL '
            'GROUP BY "clusterId", source HAVING count(DISTINCT "dedupKey") > 1'
        )).all() == []


def test_backfill_dedup_repairs_legacy_cluster_when_assigning_changed_key(db):
    upsert_listings([
        _row("hemnet", "h", price=6_000_000, dedupKey=None, clusterId="legacy"),
        _row("booli", "b", price=4_905_000, clusterId="legacy"),
    ])
    assert _count(db, "DedupedListing") == 1
    assert backfill_dedup_keys() == 1
    assert _count(db, "DedupedListing") == 2
