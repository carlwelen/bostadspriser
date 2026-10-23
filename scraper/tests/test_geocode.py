"""Geocoding (B16, scraper side): status bookkeeping on upsert, the catch-up for rows
mislabelled between the migration and this change, and the rewritten `geocode` pass.
Mapbox is faked with httpx.MockTransport: no network."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from urllib.parse import unquote

import httpx
import pytest
from click.testing import CliRunner
from sqlalchemy import event, text

from scraper import geocode as geo
from scraper import run
from scraper.db import upsert_listing, upsert_listings
from scraper.normalize import dedup_key


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
    base["dedupKey"] = dedup_key(base["street"], base["houseNumber"], base["soldAt"], base["priceSek"])
    base.update(overrides)
    return base


def _all(db) -> dict[str, dict]:
    with db.connect() as c:
        rows = c.execute(text('SELECT * FROM "Listing"')).mappings().all()
    return {r["sourceId"]: dict(r) for r in rows}


def _set(db, sid: str, **cols) -> None:
    assign = ", ".join(f'"{k}" = :{k}' for k in cols)
    with db.begin() as c:
        c.execute(text(f'UPDATE "Listing" SET {assign} WHERE "sourceId" = :sid'), {**cols, "sid": sid})


# ---------------------------------------------------------------------------
# geocodeStatus on upsert
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("batched", [False, True])
def test_upsert_marks_inline_coordinates_and_leaves_the_rest_pending(db, batched) -> None:
    rows = [_row("with", lat=59.3, lng=18.0, geocodedAt=datetime(2026, 5, 3)), _row("without")]
    if batched:
        upsert_listings(rows)
    else:
        for r in rows:
            upsert_listing(r)
    got = _all(db)
    assert got["with"]["geocodeStatus"] == "inline" and got["without"]["geocodeStatus"] == "pending"
    assert got["with"]["geocodeAttempts"] == 0 == got["without"]["geocodeAttempts"]


def test_reupsert_without_coordinates_keeps_the_status_and_with_coordinates_sets_inline(db) -> None:
    upsert_listings([_row("a", lat=59.3, lng=18.0), _row("b")])
    _set(db, "a", geocodeStatus="ok")  # pretend a geocoder produced a's coordinates
    upsert_listings([_row("a"), _row("b", lat=59.4, lng=18.1)])  # a re-scrape: no coords for a, coords for b
    got = _all(db)
    assert got["a"]["geocodeStatus"] == "ok" and got["a"]["lat"] == 59.3
    assert got["b"]["geocodeStatus"] == "inline" and got["b"]["lat"] == 59.4


def test_status_is_not_touched_by_a_half_coordinate_pair(db) -> None:
    upsert_listings([_row("p", lat=59.3)])
    assert _all(db)["p"]["geocodeStatus"] == "pending"


# ---------------------------------------------------------------------------
# catch-up
# ---------------------------------------------------------------------------


def test_catch_up_relabels_pending_rows_that_already_have_coordinates(db) -> None:
    upsert_listings([_row(s) for s in ("mislabelled", "pending", "ok", "nf", "inl")])
    _set(db, "mislabelled", lat=59.3, lng=18.0)  # written between the migration and the scraper change
    _set(db, "ok", lat=59.3, lng=18.0, geocodeStatus="ok")
    _set(db, "nf", geocodeStatus="not_found")
    _set(db, "inl", lat=59.3, lng=18.0, geocodeStatus="inline")
    assert geo.mark_inline_pending() == 1
    got = _all(db)
    assert {k: v["geocodeStatus"] for k, v in got.items()} == {
        "mislabelled": "inline", "pending": "pending", "ok": "ok", "nf": "not_found", "inl": "inline",
    }
    assert geo.mark_inline_pending() == 0  # idempotent


# ---------------------------------------------------------------------------
# the geocode pass
# ---------------------------------------------------------------------------

BBOX = (17.97, 59.29, 18.17, 59.38)  # inner Stockholm
INSIDE = [18.0753, 59.3371]  # lng, lat
GOTHENBURG = [11.9746, 57.7089]


class Mapbox:
    """A programmable fake: `answers` maps a street substring to a response spec."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.answers: dict[str, list] = {}  # substring -> list of responses (consumed in order, last repeats)
        self.default = [("ok", INSIDE)]

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        query = unquote(request.url.path)
        for needle, seq in self.answers.items():
            if needle in query:
                spec = seq.pop(0) if len(seq) > 1 else seq[0]
                break
        else:
            spec = self.default[0]
        kind = spec[0]
        if kind == "ok":
            return httpx.Response(200, json={"features": [{"center": spec[1]}]})
        if kind == "empty":
            return httpx.Response(200, json={"features": []})
        if kind == "status":
            return httpx.Response(spec[1], headers=spec[2] if len(spec) > 2 else {}, json={})
        if kind == "boom":
            raise httpx.ConnectError("connection reset")
        raise AssertionError(kind)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


@pytest.fixture()
def mapbox():
    return Mapbox()


@pytest.fixture()
def sleeps(monkeypatch):
    recorded: list[float] = []
    monkeypatch.setattr(geo, "_sleep", recorded.append)
    return recorded


def _pass(mapbox, **kw):
    kw.setdefault("limit", 50)
    return geo.geocode_pending(client=mapbox.client(), **kw)


def test_selection_only_takes_pending_or_failed_rows_without_coordinates_under_the_attempt_cap(
    db, mapbox, sleeps
) -> None:
    upsert_listings([_row(s, street=f"Gata{s}") for s in ("pend", "fail2", "fail3", "ok", "nf", "inl", "haslat")])
    _set(db, "fail2", geocodeStatus="failed", geocodeAttempts=2)
    _set(db, "fail3", geocodeStatus="failed", geocodeAttempts=3)
    _set(db, "ok", geocodeStatus="ok", lat=59.3, lng=18.0)
    _set(db, "nf", geocodeStatus="not_found", geocodeAttempts=1)
    _set(db, "inl", geocodeStatus="inline", lat=59.3, lng=18.0)
    _set(db, "haslat", lat=59.3, lng=18.0)  # pending but already has coordinates (catch-up's job)
    summary = _pass(mapbox, max_attempts=3)
    assert summary.ok == 2
    asked = sorted(unquote(r.url.path) for r in mapbox.requests)
    assert any("Gatapend" in p for p in asked) and any("Gatafail2" in p for p in asked)
    assert len(asked) == 2


def test_query_uses_the_display_name_a_bbox_and_a_proximity_bias(db, mapbox, sleeps) -> None:
    upsert_listings([_row("1", street="Sankt Eriksgatan", houseNumber="12-14", district="sodermalm")])
    _pass(mapbox)
    (req,) = mapbox.requests
    path = unquote(req.url.path)
    assert "Södermalm" in path and "sodermalm" not in path.lower().replace("södermalm", "")
    assert "Sankt Eriksgatan 12, " in path  # a house-number range is reduced to its first number
    assert path.rstrip("/").endswith(".json")
    params = dict(req.url.params)
    assert params["country"] == "se" and params["limit"] == "1" and params["access_token"] == "test-token"
    assert tuple(float(x) for x in params["bbox"].split(",")) == BBOX
    assert params["proximity"] == "18.07,59.33"
    assert " " not in req.url.raw_path.decode()  # the query is percent-encoded in the path


def test_a_match_inside_the_bbox_is_stored_as_ok(db, mapbox, sleeps) -> None:
    upsert_listings([_row("1")])
    summary = _pass(mapbox)
    row = _all(db)["1"]
    assert (summary.ok, summary.not_found, summary.failed) == (1, 0, 0)
    assert (row["lng"], row["lat"]) == (INSIDE[0], INSIDE[1])
    assert row["geocodeStatus"] == "ok" and row["geocodeAttempts"] == 1 and row["geocodedAt"] is not None


def test_no_match_and_matches_outside_the_bbox_are_not_found(db, mapbox, sleeps) -> None:
    upsert_listings([_row("nomatch", street="Ingenstans"), _row("far", street="Langtbort")])
    mapbox.answers = {"Ingenstans": [("empty",)], "Langtbort": [("ok", GOTHENBURG)]}
    summary = _pass(mapbox)
    got = _all(db)
    assert summary.not_found == 2 and summary.ok == 0
    for sid in ("nomatch", "far"):
        assert got[sid]["geocodeStatus"] == "not_found" and got[sid]["geocodeAttempts"] == 1
        assert got[sid]["lat"] is None and got[sid]["lng"] is None
        assert got[sid]["geocodedAt"] is not None  # the geocoder answered


def test_a_429_is_retried_with_backoff_and_honours_retry_after(db, mapbox, sleeps) -> None:
    upsert_listings([_row("1")])
    mapbox.answers = {"Brahegatan": [("status", 429, {"Retry-After": "7"}), ("status", 429), ("ok", INSIDE)]}
    summary = _pass(mapbox)
    assert summary.ok == 1 and len(mapbox.requests) == 3
    waits = [s for s in sleeps if s >= 1]  # (the 50 ms politeness pause is below 1)
    assert len(waits) == 2 and waits[0] >= 7 and waits[1] >= 1  # Retry-After first, then plain backoff
    assert _all(db)["1"]["geocodeStatus"] == "ok"


def test_a_single_persistent_429_does_not_abort_the_batch(db, mapbox, sleeps) -> None:
    upsert_listings([_row("limited", street="Limited"), _row("fine", street="Fine")])
    mapbox.answers = {"Limited": [("status", 429)], "Fine": [("ok", INSIDE)]}
    summary = _pass(mapbox)
    got = _all(db)
    assert (summary.ok, summary.failed) == (1, 1)
    assert got["fine"]["geocodeStatus"] == "ok"
    assert got["limited"]["geocodeStatus"] == "failed" and got["limited"]["geocodeAttempts"] == 1
    assert got["limited"]["geocodedAt"] is None  # no answer was received
    assert sum(1 for r in mapbox.requests if "Limited" in unquote(r.url.path)) == geo.REQUEST_ATTEMPTS


@pytest.mark.parametrize("failure", [("status", 503), ("boom",)])
def test_server_errors_and_transport_errors_are_retried_then_marked_failed(db, mapbox, sleeps, failure) -> None:
    upsert_listings([_row("1")])
    mapbox.answers = {"Brahegatan": [failure]}
    summary = _pass(mapbox)
    assert summary.failed == 1
    assert _all(db)["1"]["geocodeStatus"] == "failed"
    assert len(mapbox.requests) == geo.REQUEST_ATTEMPTS


def test_failed_rows_are_retried_by_a_later_pass_until_the_attempt_cap(db, mapbox, sleeps) -> None:
    upsert_listings([_row("1")])
    mapbox.answers = {"Brahegatan": [("status", 503)]}
    for _ in range(3):
        _pass(mapbox, max_attempts=3)
    assert _all(db)["1"]["geocodeAttempts"] == 3
    before = len(mapbox.requests)
    _pass(mapbox, max_attempts=3)  # at the cap: left alone
    assert len(mapbox.requests) == before
    _set(db, "1", geocodeAttempts=1)
    mapbox.answers = {"Brahegatan": [("ok", INSIDE)]}
    _pass(mapbox, max_attempts=3)
    row = _all(db)["1"]
    assert row["geocodeStatus"] == "ok" and row["geocodeAttempts"] == 2


def test_bad_credentials_abort_but_keep_what_was_already_geocoded(db, mapbox, sleeps) -> None:
    upsert_listings([_row("a", street="Aaa", id="id-a"), _row("b", street="Bbb", id="id-b")])  # processed in id order
    mapbox.answers = {"Aaa": [("ok", INSIDE)], "Bbb": [("status", 401)]}
    with pytest.raises(RuntimeError, match="401"):
        _pass(mapbox)
    got = _all(db)
    assert got["a"]["geocodeStatus"] == "ok"
    assert got["b"]["geocodeStatus"] == "pending" and got["b"]["geocodeAttempts"] == 0


def test_writes_are_batched(db, mapbox, sleeps) -> None:
    upsert_listings([_row(str(i), street=f"Gata{i}") for i in range(5)])
    updates: list[tuple[str, bool]] = []

    def spy(conn, cursor, statement, params, context, executemany):
        if statement.lstrip().upper().startswith("UPDATE"):
            updates.append((statement, executemany))

    event.listen(db, "before_cursor_execute", spy)
    try:
        summary = _pass(mapbox, write_batch_size=2)
    finally:
        event.remove(db, "before_cursor_execute", spy)
    assert summary.ok == 5
    writes = [(u, many) for u, many in updates if "b_id" in u]  # the batched outcome writes
    assert len(writes) == 3  # ceil(5/2) statements, not 5 UPDATEs (the last holds a single row)
    assert [many for _, many in writes[:2]] == [True, True]
    assert len(updates) == 4  # plus the catch-up UPDATE at the start of the pass
    assert {r["geocodeStatus"] for r in _all(db).values()} == {"ok"}


def test_the_pass_runs_the_catch_up_first(db, mapbox, sleeps) -> None:
    upsert_listings([_row("mislabelled")])
    _set(db, "mislabelled", lat=59.3, lng=18.0)
    _pass(mapbox)
    assert mapbox.requests == []  # it has coordinates: relabelled, not geocoded
    assert _all(db)["mislabelled"]["geocodeStatus"] == "inline"


def test_missing_token_is_an_error(db, monkeypatch) -> None:
    monkeypatch.setenv("MAPBOX_TOKEN", "")
    with pytest.raises(RuntimeError, match="MAPBOX_TOKEN"):
        geo.geocode_pending(limit=1, client=httpx.Client(transport=httpx.MockTransport(lambda r: None)))


def test_cli_reports_the_outcome_counts(db, mapbox, sleeps, monkeypatch) -> None:
    upsert_listings([_row("1"), _row("2", street="Ingenstans")])
    mapbox.answers = {"Ingenstans": [("empty",)]}
    real = geo.geocode_pending
    monkeypatch.setattr(run, "geocode_pending", lambda **kw: real(client=mapbox.client(), **kw))
    result = CliRunner().invoke(run.cli, ["geocode", "--limit", "10"])
    assert result.exit_code == 0, result.output
    assert "ok 1" in result.output and "not found 1" in result.output and "failed 0" in result.output
