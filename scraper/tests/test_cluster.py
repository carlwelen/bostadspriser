"""The fuzzy cross-source matcher (B13): paired fixtures, near misses, merges,
idempotency, the one-clusterId-per-dedupKey invariant. DB tests (`db` fixture)."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from click.testing import CliRunner
from sqlalchemy import text

from scraper import cluster as cluster_mod
from scraper import run
from scraper.cluster import dedup_keys_in_multiple_clusters, match_clusters
from scraper.db import upsert_listings
from scraper.normalize import dedup_key

DAY = date(2026, 5, 4)


def _row(source: str, sid: str, *, street="Brahegatan", house="3A", sold=DAY, price=4_900_000, **extra) -> dict:
    row = {
        "id": str(uuid.uuid4()),
        "source": source,
        "sourceId": sid,
        "street": street,
        "houseNumber": house,
        "district": "ostermalm",
        "rooms": 1.0,
        "areaSqm": 35.0,
        "priceSek": price,
        "pricePerSqmSek": 140_000,
        "soldAt": sold,
        "lat": None,
        "lng": None,
        "geocodedAt": None,
        "raw": {"fixture": True},
    }
    row.update(extra)
    if "dedupKey" not in extra:
        row["dedupKey"] = dedup_key(street, house, sold, price)
    return row


def _clusters(db) -> dict[str, str | None]:
    with db.connect() as c:
        rows = c.execute(text('SELECT "sourceId", "clusterId" FROM "Listing"')).all()
    return {sid: cid for sid, cid in rows}


def _keys(db) -> dict[str, str | None]:
    with db.connect() as c:
        rows = c.execute(text('SELECT "sourceId", "dedupKey" FROM "Listing"')).all()
    return dict(rows)


def _assert_invariant(db) -> None:
    assert dedup_keys_in_multiple_clusters() == []


def test_same_sale_one_day_and_a_few_kronor_apart_is_clustered(db) -> None:
    upsert_listings([
        _row("hemnet", "h", sold=DAY, price=4_900_000),
        _row("booli", "b", sold=DAY + timedelta(days=1), price=4_905_000),
    ])
    keys = _keys(db)
    assert keys["h"] != keys["b"]  # the exact dedupKey misses this pair
    summary = match_clusters()
    assert summary.pairs == 1 and summary.components == 1 and summary.rows_updated == 2
    cl = _clusters(db)
    assert cl["h"] == cl["b"] == min(keys["h"], keys["b"])  # the smallest dedupKey
    _assert_invariant(db)


@pytest.mark.parametrize(
    "name,booli",
    [
        ("four days apart", dict(sold=DAY + timedelta(days=4))),
        ("a 1% price difference", dict(price=4_949_000)),
        ("a different house letter", dict(house="3B")),
        ("a different street", dict(street="Odengatan")),
        ("a different house number", dict(house="5A")),
        ("a zero price", dict(price=0)),
    ],
)
def test_near_misses_are_not_clustered(db, name, booli) -> None:
    upsert_listings([_row("hemnet", "h"), _row("booli", "b", **booli)])
    summary = match_clusters()
    assert summary.pairs == 0 and summary.rows_updated == 0, name
    assert set(_clusters(db).values()) == {None}


def test_the_window_edges_are_inclusive(db) -> None:
    upsert_listings([
        _row("hemnet", "h"),
        _row("booli", "b", sold=DAY - timedelta(days=3), price=4_900_000 - 24_500),  # 3 days, 0.5% of the larger
    ])
    assert match_clusters().pairs == 1


def test_the_same_source_is_never_matched_with_itself(db) -> None:
    upsert_listings([_row("hemnet", "h1"), _row("hemnet", "h2", sold=DAY + timedelta(days=1))])
    assert match_clusters().pairs == 0


def test_spelling_variants_of_one_address_match(db) -> None:
    """normalize_address collapses spaces, case and the å/ä/ö folds."""
    upsert_listings([
        _row("hemnet", "h", street="Götgatan", house="22A"),
        _row("booli", "b", street="GOTGATAN", house="22 a", sold=DAY + timedelta(days=2)),
    ])
    assert match_clusters().pairs == 1


def test_closest_candidate_wins_over_same_source_chain(db) -> None:
    upsert_listings([
        _row("hemnet", "h", sold=DAY, price=4_900_000),
        _row("booli", "b1", sold=DAY + timedelta(days=1), price=4_905_000),
        _row("booli", "b2", sold=DAY + timedelta(days=2), price=4_910_000),
    ])
    match_clusters()
    keys, cl = _keys(db), _clusters(db)
    assert len(set(keys.values())) == 3
    assert cl["h"] == cl["b1"] and cl["b2"] is None
    _assert_invariant(db)


def test_two_booli_keys_cannot_join_through_hemnet(db) -> None:
    """b1 and b2 are 6 days apart (no direct match) but both match h in between."""
    upsert_listings([
        _row("hemnet", "h", sold=DAY),
        _row("booli", "b1", sold=DAY - timedelta(days=3)),
        _row("booli", "b2", sold=DAY + timedelta(days=3)),
    ])
    match_clusters()
    cl = _clusters(db)
    assert cl["h"] is not None
    assert sum(cl[b] == cl["h"] for b in ("b1", "b2")) == 1


def test_rerunning_is_a_no_op(db) -> None:
    upsert_listings([
        _row("hemnet", "h", sold=DAY),
        _row("booli", "b", sold=DAY + timedelta(days=1), price=4_905_000),
        _row("hemnet", "lonely", street="Odengatan", house="9"),
    ])
    first = match_clusters()
    before = _clusters(db)
    second = match_clusters()
    third = match_clusters(batch_size=1)
    assert first.rows_updated == 2
    assert (second.rows_updated, second.components, second.pairs) == (0, 0, 0)
    assert third.rows_updated == 0
    assert _clusters(db) == before and before["lonely"] is None


def test_dry_run_reports_without_writing(db) -> None:
    upsert_listings([_row("hemnet", "h"), _row("booli", "b", sold=DAY + timedelta(days=1))])
    summary = match_clusters(dry_run=True)
    assert summary.dry_run and summary.pairs == 1 and summary.rows_updated == 2 and summary.examples
    assert set(_clusters(db).values()) == {None}


def test_bridge_cannot_merge_two_sales_from_the_same_source(db) -> None:
    # Two separate clusters of the same address, 6 days apart...
    upsert_listings([
        _row("hemnet", "h1", sold=DAY),
        _row("booli", "b1", sold=DAY + timedelta(days=1), price=4_905_000),
        _row("hemnet", "h2", sold=DAY + timedelta(days=6)),
        _row("booli", "b2", sold=DAY + timedelta(days=7), price=4_905_000),
    ])
    match_clusters()
    before = _clusters(db)
    assert before["h1"] == before["b1"] != before["h2"] == before["b2"]
    # A fuzzy bridge cannot combine these separate sales.
    upsert_listings([_row("booli", "link", sold=DAY + timedelta(days=3), price=4_902_000)])
    summary = match_clusters(batch_size=1)
    cl = _clusters(db)
    assert cl["h1"] == cl["b1"] != cl["h2"] == cl["b2"]
    assert cl["link"] is None
    assert summary.components == 0
    _assert_invariant(db)
    assert match_clusters().rows_updated == 0


def test_a_late_exact_copy_inherits_its_dedup_group_s_cluster(db) -> None:
    upsert_listings([_row("hemnet", "h"), _row("booli", "b", sold=DAY + timedelta(days=1))])
    match_clusters()
    cid = _clusters(db)["h"]
    # a second booli copy with exactly the same dedupKey as b arrives (no clusterId yet)
    upsert_listings([_row("booli", "b-again", sold=DAY + timedelta(days=1))])
    assert _clusters(db)["b-again"] is None
    summary = match_clusters()
    assert _clusters(db)["b-again"] == cid
    assert summary.propagated + summary.rows_updated >= 1
    _assert_invariant(db)


def test_rows_sharing_a_dedup_key_always_share_a_cluster(db) -> None:
    """hemnet and booli copies that agree exactly (same key) next to a fuzzy partner."""
    upsert_listings([
        _row("hemnet", "h"),
        _row("booli", "b-exact"),  # same dedupKey as h
        _row("booli", "b-fuzzy", sold=DAY + timedelta(days=1), price=4_905_000),
    ])
    match_clusters()
    cl = _clusters(db)
    assert cl["h"] == cl["b-exact"] and cl["b-fuzzy"] is None
    _assert_invariant(db)


def test_rows_without_a_dedup_key_are_left_alone(db) -> None:
    upsert_listings([_row("hemnet", "h"), _row("booli", "b", dedupKey=None)])
    assert match_clusters().pairs == 0
    assert _clusters(db)["b"] is None


def test_the_violation_check_reports_and_the_matcher_heals_a_split_key(db) -> None:
    upsert_listings([_row("hemnet", "h"), _row("booli", "b")])  # same dedupKey, both sources
    with db.begin() as c:
        c.execute(text("UPDATE \"Listing\" SET \"clusterId\" = 'zzz' WHERE \"sourceId\" = 'h'"))
        c.execute(text("UPDATE \"Listing\" SET \"clusterId\" = 'yyy' WHERE \"sourceId\" = 'b'"))
    (key, cids), = dedup_keys_in_multiple_clusters()
    assert cids == ["yyy", "zzz"] and key == _keys(db)["h"]
    summary = match_clusters()
    assert summary.violations == []
    cl = _clusters(db)
    assert cl["h"] == cl["b"] == key
    _assert_invariant(db)


def test_stats_warns_about_a_split_key(db) -> None:
    upsert_listings([_row("hemnet", "h"), _row("booli", "b")])
    with db.begin() as c:
        c.execute(text("UPDATE \"Listing\" SET \"clusterId\" = 'zzz' WHERE \"sourceId\" = 'h'"))
        c.execute(text("UPDATE \"Listing\" SET \"clusterId\" = 'yyy' WHERE \"sourceId\" = 'b'"))
    out = CliRunner().invoke(run.cli, ["stats"]).output
    assert "more than one cluster" in out and _keys(db)["h"] in out
    with db.begin() as c:
        c.execute(text('UPDATE "Listing" SET "clusterId" = NULL'))
    assert "more than one cluster" not in CliRunner().invoke(run.cli, ["stats"]).output


# ---------------------------------------------------------------------------
# the command and `update`
# ---------------------------------------------------------------------------


def test_cluster_command_refreshes_every_non_dry_run(db, monkeypatch) -> None:
    refreshed: list[int] = []
    monkeypatch.setattr(run, "refresh_deduped", lambda: refreshed.append(1) or "refreshed")
    upsert_listings([_row("hemnet", "h"), _row("booli", "b", sold=DAY + timedelta(days=1))])
    dry = CliRunner().invoke(run.cli, ["cluster", "--dry-run"])
    assert dry.exit_code == 0 and "dry run" in dry.output.lower() and refreshed == []
    real = CliRunner().invoke(run.cli, ["cluster"])
    assert real.exit_code == 0 and "2 rows" in real.output and refreshed == [1]
    again = CliRunner().invoke(run.cli, ["cluster"])
    assert again.exit_code == 0 and refreshed == [1, 1]


def test_cluster_command_exits_1_when_a_violation_remains(db, monkeypatch) -> None:
    monkeypatch.setattr(
        cluster_mod, "dedup_keys_in_multiple_clusters", lambda: [("k1", ["a", "b"])]
    )
    result = CliRunner().invoke(run.cli, ["cluster"])
    assert result.exit_code == 1 and "k1" in result.output


def test_cluster_command_takes_the_lock(db) -> None:
    from scraper.lock import single_instance

    with single_instance():
        assert CliRunner().invoke(run.cli, ["cluster"]).exit_code == 75


def test_update_clusters_before_it_refreshes_the_snapshot(db, monkeypatch) -> None:
    from scraper.errors import CrawlIncomplete  # noqa: F401  (documented partial-run path below)

    order: list[str] = []
    monkeypatch.setattr(run, "match_clusters", lambda **kw: order.append("cluster") or cluster_mod.ClusterSummary())
    monkeypatch.setattr(run, "refresh_deduped", lambda: order.append("refresh") or "refreshed")

    async def it(district, since, *, progress=None, **kw):
        yield _row("hemnet", "h")
        progress.pages += 1

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", it)
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    assert result.exit_code == 0, result.output
    assert order == ["cluster", "refresh"]


def test_a_failing_cluster_step_never_changes_the_update_exit_code(db, monkeypatch) -> None:
    def boom(**kw):
        raise RuntimeError("matcher exploded")

    monkeypatch.setattr(run, "match_clusters", boom)

    async def it(district, since, *, progress=None, **kw):
        yield _row("hemnet", "h")

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", it)
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    assert result.exit_code == 0 and "matcher exploded" in result.output


@pytest.mark.parametrize("extra", [{"areaSqm": 37}, {"rooms": 2}])
def test_physical_details_prevent_false_matches(db, extra):
    upsert_listings([_row("hemnet", "h"), _row("booli", "b", price=4_905_000, **extra)])
    assert match_clusters().rows_updated == 0


def test_correction_undoes_stale_cluster(db):
    upsert_listings([_row("hemnet", "h"), _row("booli", "b", price=4_905_000)])
    match_clusters()
    upsert_listings([_row("booli", "b", price=6_200_000)])
    assert match_clusters().rows_updated == 2
    assert set(_clusters(db).values()) == {None}


def test_split_key_without_cross_source_partner_is_healed(db):
    upsert_listings([_row("hemnet", "h1"), _row("hemnet", "h2")])
    with db.begin() as c:
        c.execute(text('UPDATE "Listing" SET "clusterId" = "sourceId"'))
    assert match_clusters().violations == []
    assert len(set(_clusters(db).values())) == 1


def test_dry_run_counts_late_copy_once(db):
    upsert_listings([_row("hemnet", "h"), _row("booli", "b", price=4_905_000)])
    match_clusters()
    upsert_listings([_row("booli", "b2", price=4_905_000)])
    predicted = match_clusters(dry_run=True)
    actual = match_clusters()
    assert predicted.rows_updated == actual.rows_updated == 1


@pytest.mark.parametrize("street", ["ÅÄÖÉÈgatan", "åäöéègatan"])
def test_sql_address_fold_handles_both_cases(db, street):
    upsert_listings([_row("hemnet", "h", street=street),
                     _row("booli", "b", street="AAOEEgatan", price=4_905_000)])
    assert match_clusters().pairs == 1


def test_two_apartments_reported_by_both_sources_remain_two_sales(db):
    upsert_listings([
        _row("hemnet", "h1"), _row("booli", "b1"),
        _row("hemnet", "h2", sold=DAY + timedelta(days=2), price=4_920_000, areaSqm=62, rooms=2.5),
        _row("booli", "b2", sold=DAY + timedelta(days=2), price=4_920_000, areaSqm=62, rooms=2.5),
    ])
    match_clusters()
    with db.connect() as c:
        assert c.execute(text('SELECT COUNT(*) FROM "DedupedListing"')).scalar_one() == 2


@pytest.mark.parametrize("area,rooms", [(36, 1.5), (35.7, 1), (None, None)])
def test_physical_detail_boundaries_and_missing_values_allow_matches(db, area, rooms):
    upsert_listings([_row("hemnet", "h"),
                     _row("booli", "b", price=4_905_000, areaSqm=area, rooms=rooms)])
    assert match_clusters().rows_updated == 2


def test_cluster_retry_repairs_failed_snapshot_refresh(db, monkeypatch):
    upsert_listings([_row("hemnet", "h"), _row("booli", "b", price=4_905_000)])
    outcomes = iter(["busy", "refreshed"])
    attempts = []

    def refresh():
        outcome = next(outcomes)
        attempts.append(outcome)
        return outcome

    monkeypatch.setattr(run, "refresh_deduped", refresh)
    first = CliRunner().invoke(run.cli, ["cluster"])
    assert first.exit_code == 0 and "updated 2 rows" in first.output
    retry = CliRunner().invoke(run.cli, ["cluster"])
    assert retry.exit_code == 0 and "updated 0 rows" in retry.output
    assert attempts == ["busy", "refreshed"]
