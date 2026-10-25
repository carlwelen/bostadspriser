"""B62: bad coordinate data never loses a priced sale or strands geocode repair."""
import copy
from datetime import datetime
from decimal import Decimal

import httpx
import pytest
from click.testing import CliRunner
from sqlalchemy import text

from scraper import booli, geocode, hemnet, run
from scraper.db import refresh_deduped, upsert_listing, upsert_listings
from scraper.reparse import reparse
from tests.test_booli_parser import SAMPLE_CARD as BOOLI_CARD
from tests.test_geocode import INSIDE, _all, _row, _set
from tests.test_hemnet_parser import SAMPLE_CARD as HEMNET_CARD

BAD_PAIRS = [
    (91, 18.07), (-91, 18.07), (59.33, 181), (59.33, -181),
    (float("nan"), 18.07), (59.33, float("inf")), (59.33, float("-inf")),
    ("bad", 18.07), (True, 18.07), ([], 18.07), (None, 18.07), (59.33, None),
]


def _source_row(source, lat, lng):
    if source == "hemnet":
        raw = {**HEMNET_CARD, "coordinates": {"lat": lat, "long": lng}}
        return raw, hemnet._to_row(raw, "ostermalm")
    raw = {**BOOLI_CARD, "latitude": lat, "longitude": lng}
    return raw, booli._to_row(raw, "vasastan")


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("pair", BAD_PAIRS)
def test_source_keeps_priced_sale_with_unknown_pair_for_invalid_coordinates(source, pair):
    raw, row = _source_row(source, *pair)
    before = repr(raw)
    assert row is not None and row["priceSek"] > 0
    assert (row["lat"], row["lng"], row["geocodedAt"]) == (None, None, None)
    assert repr(raw) == before


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("pair", [(0, 0), (90, 180), (-90, -180), (59.33, 18.07),
                                   ("59.33", "18.07"), (Decimal("59.33"), Decimal("18.07"))])
def test_source_accepts_finite_global_boundaries_and_numeric_values(source, pair):
    _, row = _source_row(source, *pair)
    assert row is not None
    assert (row["lat"], row["lng"]) == tuple(float(x) for x in pair)
    assert row["geocodedAt"] is not None


@pytest.mark.parametrize("batched", [False, True])
@pytest.mark.parametrize("pair", BAD_PAIRS)
def test_db_normalizes_invalid_pairs_and_preserves_existing_complete_pair(db, pair, batched):
    stamp = datetime(2026, 5, 3)
    upsert_listing(_row("keep", lat=59.33, lng=18.07, geocodedAt=stamp))
    rows = [_row(sid, lat=pair[0], lng=pair[1], geocodedAt=datetime(2026, 6, 1),
                 geocodeStatus="inline", priceSek=5_000_000) for sid in ("keep", "new")]
    before = repr(rows)
    if batched:
        upsert_listings(rows)
    else:
        for row in rows:
            upsert_listing(row)
    got = _all(db)
    assert (got["new"]["lat"], got["new"]["lng"], got["new"]["geocodedAt"]) == (None, None, None)
    assert got["new"]["geocodeStatus"] == "pending" and got["new"]["priceSek"] == 5_000_000
    assert (got["keep"]["lat"], got["keep"]["lng"], got["keep"]["geocodedAt"]) == (59.33, 18.07, stamp)
    assert got["keep"]["geocodeStatus"] == "inline" and got["keep"]["priceSek"] == 5_000_000
    assert repr(rows) == before


def test_duplicate_invalid_sighting_keeps_earlier_valid_pair(db):
    upsert_listings([_row("same", lat=59.33, lng=18.07), _row("same", lat=91, lng=181)])
    got = _all(db)["same"]
    assert (got["lat"], got["lng"], got["geocodeStatus"]) == (59.33, 18.07, "inline")


@pytest.mark.parametrize("source", ["hemnet", "booli"])
def test_nonfinite_source_and_nested_raw_roundtrip_without_mutation_or_reparse_changes(db, source):
    raw, row = _source_row(source, float("nan"), float("inf"))
    raw["diagnostic"] = {"nested": [float("-inf"), {"value": float("nan")}], "normal": [1, 1.5, True, None, "text"]}
    snapshot = copy.deepcopy(raw)
    before = repr(raw)
    assert row is not None
    upsert_listing(row)
    stored = _all(db)[row["sourceId"]]
    assert (stored["lat"], stored["lng"], stored["geocodedAt"], stored["geocodeStatus"]) == (None, None, None, "pending")
    assert stored["raw"]["diagnostic"]["nested"] == ["-inf", {"value": "nan"}]
    assert stored["raw"]["diagnostic"]["normal"] == snapshot["diagnostic"]["normal"]
    assert [type(v) for v in stored["raw"]["diagnostic"]["normal"]] == [int, float, bool, type(None), str]
    assert repr(raw) == before
    assert reparse().changed == 0 and reparse().changed == 0


def test_legacy_invalid_pairs_become_repairable_without_resetting_attempts(db, monkeypatch):
    specs = [("inline", 91, 18.07, 0), ("ok", float("nan"), 18.07, 0),
             ("failed", 59.33, float("inf"), 2), ("partial", -91, None, 0),
             ("capped", 59.33, 181, geocode.MAX_ATTEMPTS)]
    for sid, lat, lng, attempts in specs:
        upsert_listing(_row(sid))
        _set(db, sid, lat=lat, lng=lng, geocodeStatus={"inline": "inline", "ok": "ok", "failed": "failed", "partial": "inline", "capped": "failed"}[sid],
             geocodeAttempts=attempts, geocodedAt=datetime(2026, 5, 3))
    upsert_listing(_row("global-boundary", lat=90, lng=180))
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"features": [{"center": INSIDE}]})

    monkeypatch.setattr(geocode, "_sleep", lambda seconds: None)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        summary = geocode.geocode_pending(client=client, order_salt="")
    assert summary.ok == 4 and len(requests) == 4
    got = _all(db)
    for sid, _, _, attempts in specs[:-1]:
        assert (got[sid]["lat"], got[sid]["lng"], got[sid]["geocodeStatus"]) == (INSIDE[1], INSIDE[0], "ok")
        assert got[sid]["geocodeAttempts"] == attempts + 1
    assert (got["capped"]["lat"], got["capped"]["lng"], got["capped"]["geocodeStatus"]) == (None, None, "pending")
    assert got["capped"]["geocodeAttempts"] == geocode.MAX_ATTEMPTS
    assert (got["global-boundary"]["lat"], got["global-boundary"]["lng"], got["global-boundary"]["geocodeStatus"]) == (90, 180, "inline")


def test_catch_up_does_not_classify_invalid_pending_pairs_as_inline(db):
    upsert_listings([_row("invalid"), _row("valid")])
    _set(db, "invalid", lat=91, lng=181)
    _set(db, "valid", lat=-90, lng=-180)
    assert geocode.mark_inline_pending() == 1
    got = _all(db)
    assert (got["invalid"]["lat"], got["invalid"]["lng"], got["invalid"]["geocodeStatus"]) == (None, None, "pending")
    assert got["valid"]["geocodeStatus"] == "inline"
    assert geocode.mark_inline_pending() == 0


def test_missing_coordinate_keys_cannot_insert_an_inline_status(db):
    row = {k: v for k, v in _row("missing", geocodeStatus="inline").items() if k not in {"lat", "lng", "geocodedAt"}}
    upsert_listing(row)
    stored = _all(db)["missing"]
    assert (stored["lat"], stored["lng"], stored["geocodedAt"], stored["geocodeStatus"]) == (None, None, None, "pending")


@pytest.mark.parametrize("coordinates", [[], "unknown", 123])
def test_malformed_coordinate_container_does_not_lose_priced_hemnet_sale(coordinates):
    row = hemnet._to_row({**HEMNET_CARD, "coordinates": coordinates}, "ostermalm")
    assert row and row["priceSek"] > 0
    assert (row["lat"], row["lng"], row["geocodedAt"]) == (None, None, None)


@pytest.mark.parametrize("features", [[], [{"center": INSIDE}]])
def test_legacy_repair_preserves_new_complete_inline_pair_during_lookup(db, monkeypatch, features):
    upsert_listing(_row("legacy"))
    _set(db, "legacy", lat=91, lng=181, geocodeStatus="inline")
    calls = []

    def handler(request):
        calls.append(request)
        upsert_listing(_row("legacy", lat=59.31, lng=18.01))
        return httpx.Response(200, json={"features": features})

    monkeypatch.setattr(geocode, "_sleep", lambda seconds: None)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        geocode.geocode_pending(client=client)
    assert len(calls) == 1
    stored = _all(db)["legacy"]
    assert (stored["lat"], stored["lng"], stored["geocodeStatus"], stored["geocodeAttempts"]) == (59.31, 18.01, "inline", 0)


@pytest.mark.parametrize("mode, exit_code", [
    ("limit-zero", 0), ("attempt-cap", 0), ("not-found", 0),
    ("outage", 75), ("rate-limit", 75), ("rejected-token", 78), ("internal-error", 1),
])
def test_cleanup_only_geocode_cli_publishes_valid_partner_even_when_lookups_stop(db, monkeypatch, mode, exit_code):
    upsert_listings([_row("preferred"), _row("partner", source="booli", lat=59.31, lng=18.01)])
    _set(db, "preferred", lat=91, lng=181, geocodeStatus="inline",
         geocodeAttempts=geocode.MAX_ATTEMPTS if mode == "attempt-cap" else 0)
    assert refresh_deduped() == "refreshed"

    def canonical_source():
        with db.connect() as conn:
            return conn.execute(text('SELECT source FROM "DedupedListingMat"')).scalar_one()

    assert canonical_source() == "hemnet"
    requests, summaries = [], []

    def handler(request):
        requests.append(request)
        if mode == "internal-error":
            raise ValueError("offline internal-error fixture")
        code = {"outage": 503, "rate-limit": 429, "rejected-token": 401}.get(mode, 200)
        return httpx.Response(code, json={"features": []})

    real = geocode.geocode_pending
    monkeypatch.setattr(geocode, "_sleep", lambda seconds: None)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        def pending(**kwargs):
            try:
                summary = real(client=client, order_salt="", **kwargs)
            except geocode.GeocodeConfigError as error:
                summaries.append(error.summary)
                raise
            summaries.append(summary)
            return summary

        monkeypatch.setattr(run, "geocode_pending", pending)
        result = CliRunner().invoke(run.cli, ["geocode", "--limit", "0" if mode == "limit-zero" else "200"])
    assert result.exit_code == exit_code, result.output
    assert (_all(db)["preferred"]["lat"], _all(db)["preferred"]["lng"]) == (None, None)
    assert canonical_source() == "booli", "Committed coordinate cleanup must republish canonical choice"
    assert len(summaries) == 1 and summaries[0].coordinates_cleared == 1
    if mode in ("limit-zero", "attempt-cap"):
        assert requests == []
    assert geocode.mark_inline_pending() == 0


@pytest.mark.parametrize("failure", ["selection", "client-construction"])
def test_cleanup_publication_survives_post_commit_failure(db, monkeypatch, failure):
    from sqlalchemy import event

    upsert_listings([_row("preferred"), _row("partner", source="booli", lat=59.31, lng=18.01)])
    _set(db, "preferred", lat=91, lng=181, geocodeStatus="inline")
    assert refresh_deduped() == "refreshed"

    def fail_selection(conn, cursor, statement, parameters, context, executemany):
        if failure == "selection" and statement.startswith('SELECT "Listing".id, "Listing".street'):
            raise RuntimeError("offline selection failure fixture")

    def fail_client(*args, **kwargs):
        raise RuntimeError("offline client-construction failure fixture")

    monkeypatch.setattr(geocode.httpx, "Client", fail_client)
    event.listen(db, "before_cursor_execute", fail_selection)
    try:
        result = CliRunner().invoke(run.cli, ["geocode"])
    finally:
        event.remove(db, "before_cursor_execute", fail_selection)
    assert result.exit_code == 1 and isinstance(result.exception, RuntimeError)
    assert f"offline {failure} failure" in str(result.exception)
    assert (_all(db)["preferred"]["lat"], _all(db)["preferred"]["lng"]) == (None, None)
    with db.connect() as conn:
        assert conn.execute(text('SELECT source FROM "DedupedListingMat"')).scalar_one() == "booli"


def test_failed_maintenance_commit_does_not_refresh_or_publish_uncommitted_cleanup(db, monkeypatch, caplog):
    from sqlalchemy import event

    upsert_listing(_row("invalid"))
    _set(db, "invalid", lat=91, lng=181, geocodeStatus="inline")
    refreshes = []
    monkeypatch.setattr(run, "refresh_deduped", lambda: refreshes.append(True))

    def fail_second_maintenance_write(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith('UPDATE "Listing" SET "geocodeStatus" ='):
            raise RuntimeError("offline maintenance rollback fixture")

    event.listen(db, "before_cursor_execute", fail_second_maintenance_write)
    try:
        result = CliRunner().invoke(run.cli, ["geocode"])
    finally:
        event.remove(db, "before_cursor_execute", fail_second_maintenance_write)
    assert result.exit_code == 1 and "maintenance rollback" in str(result.exception)
    assert refreshes == []
    assert "cleared invalid legacy coordinates" not in caplog.text
    assert (_all(db)["invalid"]["lat"], _all(db)["invalid"]["lng"]) == (91, 181)
