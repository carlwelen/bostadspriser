"""Reviewer R probes (r19): run against C's real view + refresh function."""
from __future__ import annotations

import uuid
from datetime import date, timedelta

from click.testing import CliRunner
from sqlalchemy import text

from scraper import run
from scraper.cluster import dedup_keys_in_multiple_clusters, match_clusters
from scraper.db import refresh_deduped, upsert_listings
from scraper.normalize import dedup_key

DAY = date(2026, 5, 4)


def _row(source, sid, *, street="Brahegatan", house="3A", sold=DAY, price=4_900_000, area=35.0, rooms=1.0, **extra):
    r = {
        "id": str(uuid.uuid4()), "source": source, "sourceId": sid, "street": street,
        "houseNumber": house, "district": "ostermalm", "rooms": rooms, "areaSqm": area,
        "priceSek": price, "pricePerSqmSek": int(price / area), "soldAt": sold,
        "lat": None, "lng": None, "geocodedAt": None, "raw": {"fixture": True},
    }
    r.update(extra)
    r["dedupKey"] = dedup_key(street, house, sold, price)
    return r


def _q(db, sql):
    with db.connect() as c:
        return c.execute(text(sql)).all()


def _real_function(db) -> bool:
    (src,) = _q(db, "SELECT pg_get_functiondef('refresh_deduped_listing()'::regprocedure)")[0]
    return 'REFRESH MATERIALIZED VIEW "DedupedListingMat"' in src


def test_refresh_deduped_refreshes_the_real_view(db) -> None:
    assert _real_function(db)
    upsert_listings([_row("hemnet", "h1"), _row("hemnet", "h2", price=5_000_000)])
    assert _q(db, 'SELECT COUNT(*) FROM "DedupedListingMat"')[0][0] == 0
    assert refresh_deduped() == "refreshed"
    assert _q(db, 'SELECT COUNT(*) FROM "DedupedListingMat"')[0][0] == 2


def test_stats_mat_vs_live_on_the_real_view(db) -> None:
    upsert_listings([_row("hemnet", "h1")])
    r = CliRunner().invoke(run.cli, ["stats"])
    assert r.exit_code == 0, r.output
    assert "differ" in r.output  # snapshot empty, live has 1
    assert refresh_deduped() == "refreshed"
    r = CliRunner().invoke(run.cli, ["stats"])
    assert "differ" not in r.output, r.output
    # same count, re-scraped (lastSeenAt moves): content drift is flagged
    upsert_listings([_row("hemnet", "h1")])
    r = CliRunner().invoke(run.cli, ["stats"])
    assert "differ" in r.output, r.output


def test_cluster_then_refresh_collapses_a_cross_source_pair_in_the_web_view(db) -> None:
    upsert_listings([
        _row("hemnet", "h", sold=DAY, price=4_900_000),
        _row("booli", "b", sold=DAY + timedelta(days=1), price=4_905_000),
    ])
    assert refresh_deduped() == "refreshed"
    assert _q(db, 'SELECT COUNT(*) FROM "DedupedListingMat"')[0][0] == 2
    r = CliRunner().invoke(run.cli, ["cluster"])
    assert r.exit_code == 0, r.output
    rows = _q(db, 'SELECT source, sources FROM "DedupedListingMat"')
    assert rows == [("hemnet", ["booli", "hemnet"])]
    assert _q(db, 'SELECT COUNT(*) FROM "DedupedListing"')[0][0] == 1


# --- false-positive / staleness probes (expected to show the weakness) -----------

def test_probe_two_apartments_same_building_both_sources_collapse_into_one(db) -> None:
    # Apartment 1: 35 m2 1 rok 4 900 000 on day 0; apartment 2: 62 m2 2,5 rok
    # 4 920 000 (0.41% apart) on day 2. Both sources list both, exact copies.
    upsert_listings([
        _row("hemnet", "h1", price=4_900_000, area=35.0, rooms=1.0),
        _row("booli", "b1", price=4_900_000, area=35.0, rooms=1.0),
        _row("hemnet", "h2", sold=DAY + timedelta(days=2), price=4_920_000, area=62.0, rooms=2.5),
        _row("booli", "b2", sold=DAY + timedelta(days=2), price=4_920_000, area=62.0, rooms=2.5),
    ])
    match_clusters()
    refresh_deduped()
    n = _q(db, 'SELECT COUNT(*) FROM "DedupedListing"')[0][0]
    print("distinct sales after cluster:", n)
    assert n == 1  # two real sales are now one


def test_probe_reparse_style_price_change_leaves_a_stale_cluster(db) -> None:
    upsert_listings([_row("hemnet", "h", price=4_900_000), _row("booli", "b", price=4_905_000)])
    match_clusters()
    # A corrected re-scrape of the Booli row: now 6 200 000 (a different sale).
    upsert_listings([_row("booli", "b", price=6_200_000)])
    match_clusters()
    refresh_deduped()
    n = _q(db, 'SELECT COUNT(*) FROM "DedupedListing"')[0][0]
    print("distinct sales after correction:", n)
    assert n == 1  # still collapsed: nothing ever un-clusters


def test_probe_same_source_split_key_without_partner_is_never_healed(db) -> None:
    upsert_listings([_row("hemnet", "h1"), _row("hemnet", "h2")])
    with db.begin() as c:
        c.execute(text("""UPDATE "Listing" SET "clusterId" = CASE "sourceId" WHEN 'h1' THEN 'x' ELSE 'y' END"""))
    s = match_clusters()
    print("violations after cluster:", s.violations)
    assert s.violations  # cluster exits 1 on every run
