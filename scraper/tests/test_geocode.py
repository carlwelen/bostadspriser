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
        if kind == "raw":
            return spec[1]
        raise AssertionError(kind)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


@pytest.fixture()
def mapbox():
    return Mapbox()


@pytest.fixture(autouse=True)
def _id_order(monkeypatch):
    """Passes pick their row order from a fresh random salt; tests want the plain id
    order unless they pass `order_salt` themselves."""
    monkeypatch.setattr(geo, "_new_salt", lambda: "")


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


def test_sustained_429_stops_the_pass_without_burning_the_row_s_attempts(db, mapbox, sleeps) -> None:
    """Circuit breaker: a row that exhausts its 429 retries ends the pass. Rate limiting
    says nothing about the row, so its attempt budget is not spent."""
    upsert_listings(
        [_row("fine", street="Fine", id="id-1"), _row("limited", street="Limited", id="id-2"),
         _row("after", street="After", id="id-3")]
    )
    mapbox.answers = {"Limited": [("status", 429, {"Retry-After": "5"})], "Fine": [("ok", INSIDE)]}
    summary = _pass(mapbox)
    got = _all(db)
    assert summary.rate_limited and summary.ok == 1 and summary.failed == 0
    assert got["fine"]["geocodeStatus"] == "ok"  # finished rows are kept
    assert got["limited"]["geocodeStatus"] == "pending" and got["limited"]["geocodeAttempts"] == 0
    assert got["after"]["geocodeStatus"] == "pending" and got["after"]["geocodeAttempts"] == 0
    asked = [unquote(r.url.path) for r in mapbox.requests]
    assert sum("Limited" in p for p in asked) == geo.REQUEST_ATTEMPTS
    assert not any("After" in p for p in asked)  # the pass stopped, it did not hammer on


def test_three_rate_limited_passes_spend_no_attempts(db, mapbox, sleeps) -> None:
    upsert_listings([_row("a", street="Aaa")])
    mapbox.default = [("status", 429, {"Retry-After": "5"})]
    for _ in range(3):
        _pass(mapbox)
    assert _all(db)["a"]["geocodeAttempts"] == 0  # three rate-limited passes spent nothing


def test_cli_exits_75_with_a_rate_limited_summary(db, mapbox, sleeps, monkeypatch) -> None:
    upsert_listings([_row("a", street="Aaa")])
    mapbox.default = [("status", 429)]
    real = geo.geocode_pending
    monkeypatch.setattr(run, "geocode_pending", lambda **kw: real(client=mapbox.client(), **kw))
    result = CliRunner().invoke(run.cli, ["geocode"])
    assert result.exit_code == 75  # EX_TEMPFAIL: try again later
    assert "rate limited" in result.output


SECRET = "pk.SECRET123"


@pytest.mark.parametrize("status", [400, 404, 422])
def test_non_retryable_4xx_fails_only_that_row_and_never_logs_the_token(db, mapbox, sleeps, monkeypatch, caplog, status) -> None:
    """A non-retryable 4xx is a per-row failure; the token never reaches logs or exceptions."""
    import logging

    monkeypatch.setenv("MAPBOX_TOKEN", SECRET)
    caplog.set_level(logging.DEBUG)  # even the chattiest level must not show the token
    upsert_listings([_row("a", street="Aaa", id="id-a"), _row("b", street="Bbb", id="id-b")])
    mapbox.answers = {"Aaa": [("status", status)]}
    summary = _pass(mapbox)  # must not raise
    got = _all(db)
    assert (summary.failed, summary.ok) == (1, 1)
    assert got["a"]["geocodeStatus"] == "failed" and got["a"]["geocodeAttempts"] == 1
    assert got["b"]["geocodeStatus"] == "ok"  # the pass carried on
    assert SECRET not in caplog.text
    assert any(f"HTTP {status}" in r.getMessage() for r in caplog.records)  # redacted reason is logged


def test_a_poison_row_does_not_block_later_passes(db, mapbox, sleeps) -> None:
    upsert_listings([_row("a", street="Aaa", id="id-a"), _row("b", street="Bbb", id="id-b")])
    mapbox.answers = {"Aaa": [("status", 422)]}
    for expected_attempts in (1, 2, 3):
        _pass(mapbox, max_attempts=3)
        assert _all(db)["a"]["geocodeAttempts"] == expected_attempts
    before = len(mapbox.requests)
    _pass(mapbox, max_attempts=3)
    assert len(mapbox.requests) == before  # a is at the cap; b is done


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"<html>not json</html>"),
        httpx.Response(200, json={"features": [{"no_center": True}]}),
        httpx.Response(200, json={"features": [{"center": []}]}),
        httpx.Response(200, json={"features": [{"center": ["x", "y"]}]}),
        httpx.Response(200, json=["unexpected"]),
    ],
)
def test_bad_payloads_fail_the_row_not_the_pass(db, mapbox, sleeps, response) -> None:
    upsert_listings([_row("a", street="Aaa", id="id-a"), _row("b", street="Bbb", id="id-b")])
    real = mapbox.handler

    def handler(request):
        if "Aaa" in unquote(request.url.path):
            mapbox.requests.append(request)
            return response
        return real(request)

    summary = geo.geocode_pending(client=httpx.Client(transport=httpx.MockTransport(handler)), limit=10)
    got = _all(db)
    assert summary.failed == 1 and summary.ok == 1
    assert got["a"]["geocodeStatus"] == "failed" and got["a"]["geocodeAttempts"] == 1
    assert got["b"]["geocodeStatus"] == "ok"


def test_rejected_token_aborts_without_leaking_it(db, mapbox, sleeps, monkeypatch, caplog) -> None:
    monkeypatch.setenv("MAPBOX_TOKEN", SECRET)
    upsert_listings([_row("a", street="Aaa")])
    mapbox.answers = {"Aaa": [("status", 401)]}
    with pytest.raises(RuntimeError) as e:
        _pass(mapbox)
    assert "401" in str(e.value) and SECRET not in str(e.value)
    assert e.value.__cause__ is None and e.value.__suppress_context__
    assert SECRET not in caplog.text


def test_the_token_is_not_in_the_cli_output_for_any_failure(db, mapbox, sleeps, monkeypatch) -> None:
    monkeypatch.setenv("MAPBOX_TOKEN", SECRET)
    upsert_listings([_row("a", street="Aaa", id="id-a"), _row("b", street="Bbb", id="id-b"), _row("c", street="Ccc", id="id-c")])
    mapbox.answers = {"Aaa": [("status", 422)], "Bbb": [("boom",)], "Ccc": [("status", 401)]}
    real = geo.geocode_pending
    monkeypatch.setattr(run, "geocode_pending", lambda **kw: real(client=mapbox.client(), **kw))
    result = CliRunner().invoke(run.cli, ["--log-level", "DEBUG", "geocode"])
    assert result.exit_code != 0
    assert SECRET not in result.output
    assert SECRET not in repr(result.exception) and SECRET not in "".join(
        str(x) for x in (result.exc_info or ())
    )


def test_httpx_request_logging_cannot_leak_the_token(db, mapbox, sleeps, monkeypatch, caplog) -> None:
    """httpx logs every request URL at INFO on its own logger; it is pinned to WARNING."""
    import logging

    monkeypatch.setenv("MAPBOX_TOKEN", SECRET)
    caplog.set_level(logging.INFO)
    upsert_listings([_row("a")])
    _pass(mapbox)
    assert SECRET not in caplog.text


def test_late_inline_coordinates_are_never_overwritten_by_an_outcome(db, mapbox, sleeps) -> None:
    """An `update` can upsert inline coordinates while geocode waits on Mapbox; the
    outcome write requires an incomplete coordinate pair and pending/failed status."""
    upsert_listings([_row("x", street="Xxx", id="id-x"), _row("y", street="Yyy", id="id-y")])
    real = mapbox.handler

    def handler(request):
        path = unquote(request.url.path)
        for sid, street in (("x", "Xxx"), ("y", "Yyy")):
            if street in path:
                # the scraper's upsert lands now, with coordinates that shipped inline
                upsert_listings([_row(sid, street=street, lat=59.31, lng=18.01)])
        return real(request)

    mapbox.answers = {"Xxx": [("empty",)], "Yyy": [("ok", INSIDE)]}
    geo.geocode_pending(client=httpx.Client(transport=httpx.MockTransport(handler)), limit=10)
    got = _all(db)
    for sid in ("x", "y"):
        assert (got[sid]["lat"], got[sid]["lng"]) == (59.31, 18.01)
        assert got[sid]["geocodeStatus"] == "inline"
        assert got[sid]["geocodeAttempts"] == 0


@pytest.mark.parametrize("failure", [("status", 503), ("boom",)])
def test_a_row_that_only_ever_hits_server_or_network_errors_is_not_charged(db, mapbox, sleeps, failure) -> None:
    """Nothing in the pass was answered: that says "Mapbox/network down", not "bad row"."""
    upsert_listings([_row("1")])
    mapbox.answers = {"Brahegatan": [failure]}
    summary = _pass(mapbox)
    assert summary.unavailable and summary.failed == 0
    row = _all(db)["1"]
    assert row["geocodeStatus"] == "pending" and row["geocodeAttempts"] == 0
    assert len(mapbox.requests) == geo.REQUEST_ATTEMPTS


def test_rejected_rows_are_retried_by_a_later_pass_until_the_attempt_cap(db, mapbox, sleeps) -> None:
    upsert_listings([_row("1")])
    mapbox.answers = {"Brahegatan": [("status", 422)]}  # a definitive per-row failure
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
    assert len(updates) == 5  # plus legacy cleanup and the inline catch-up at the start
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


# ---------------------------------------------------------------------------
# B16 review 2: outage circuit breaker, per-row catch-all
# ---------------------------------------------------------------------------


def test_sustained_503_with_retry_after_trips_the_breaker_and_spends_no_attempts(db, sleeps) -> None:
    upsert_listings([_row(str(i), street=f"Gata{i}") for i in range(10)])
    mb = Mapbox()
    mb.default = [("status", 503, {"Retry-After": "120"})]
    for _ in range(3):
        summary = geo.geocode_pending(limit=50, client=mb.client())
        assert summary.unavailable and not summary.rate_limited
    assert all(r["geocodeAttempts"] == 0 and r["geocodeStatus"] == "pending" for r in _all(db).values())
    # The first row gets the full retry budget; once a streak has started the next
    # rows get a single try (10 rows x 4 tries x 3 passes would be 120 requests).
    per_pass = geo.REQUEST_ATTEMPTS + (geo.OUTAGE_ROW_LIMIT - 1)
    assert len(mb.requests) == 3 * per_pass
    # Only the first row's retries wait (3 x ~120 s); the rest fail fast. ~6 min a pass, not 18.
    assert sum(s for s in sleeps if s >= 1) <= 3 * (geo.REQUEST_ATTEMPTS - 1) * 120


def test_sustained_connect_error_stops_after_a_few_rows(db, sleeps) -> None:
    upsert_listings([_row(str(i), street=f"Gata{i}") for i in range(10)])
    mb = Mapbox()
    mb.default = [("boom",)]
    summary = geo.geocode_pending(limit=50, client=mb.client())
    assert summary.unavailable
    assert len(mb.requests) < 10 * geo.REQUEST_ATTEMPTS
    assert len(mb.requests) == geo.REQUEST_ATTEMPTS + (geo.OUTAGE_ROW_LIMIT - 1)
    assert all(r["geocodeAttempts"] == 0 for r in _all(db).values())


def test_a_success_resets_the_streak_and_charges_only_rows_that_had_the_full_budget(db, mapbox, sleeps) -> None:
    ids = [("a", "Aaa", "id-1"), ("b", "Bbb", "id-2"), ("c", "Ccc", "id-3")]
    upsert_listings([_row(sid, street=street, id=rid) for sid, street, rid in ids])
    mapbox.answers = {"Aaa": [("status", 503)], "Bbb": [("status", 503)], "Ccc": [("ok", INSIDE)]}
    summary = _pass(mapbox)
    got = _all(db)
    assert not summary.unavailable and (summary.failed, summary.ok) == (1, 1)
    assert got["a"]["geocodeStatus"] == "failed" and got["a"]["geocodeAttempts"] == 1  # full retry budget
    # b was tried once (a streak had started), so a brief blip must not charge it
    assert got["b"]["geocodeStatus"] == "pending" and got["b"]["geocodeAttempts"] == 0
    assert got["c"]["geocodeStatus"] == "ok"


def test_rows_failing_at_the_end_of_a_short_pass_are_not_charged(db, mapbox, sleeps) -> None:
    """Only a later *answered* row proves the held rows were at fault; at the tail
    nothing does. (A handful of pending rows and an offline machine used to give up
    on all of them within three cron passes.)"""
    upsert_listings([_row("a", street="Aaa", id="id-1"), _row("b", street="Bbb", id="id-2")])
    mapbox.default = [("status", 503)]
    summary = _pass(mapbox)
    assert summary.unavailable and summary.failed == 0  # nothing was answered: non-zero exit
    assert {r["geocodeAttempts"] for r in _all(db).values()} == {0}


def test_small_backlog_offline_is_not_given_up_after_three_passes(db, mapbox, sleeps) -> None:
    upsert_listings([_row("a", street="Aaa", id="id-1"), _row("b", street="Bbb", id="id-2")])
    mapbox.default = [("boom",)]
    for _ in range(3):
        assert _pass(mapbox).unavailable
    got = _all(db)
    assert {r["geocodeAttempts"] for r in got.values()} == {0}
    assert {r["geocodeStatus"] for r in got.values()} == {"pending"}
    mapbox.default = [("ok", INSIDE)]  # the network is back: a 4th pass still finds them
    summary = _pass(mapbox)
    assert summary.ok == 2 and {r["geocodeStatus"] for r in _all(db).values()} == {"ok"}


def test_a_short_failing_tail_after_answered_rows_stays_uncharged_but_is_not_an_outage(db, mapbox, sleeps) -> None:
    upsert_listings([_row("good", street="Fine", id="id-1"), _row("t1", street="Tail1", id="id-2"), _row("t2", street="Tail2", id="id-3")])
    mapbox.answers = {"Fine": [("ok", INSIDE)], "Tail1": [("status", 503)], "Tail2": [("status", 503)]}
    summary = _pass(mapbox)
    got = _all(db)
    assert summary.ok == 1 and not summary.unavailable  # something was answered
    assert got["t1"]["geocodeAttempts"] == 0 and got["t2"]["geocodeAttempts"] == 0


def test_the_breaker_leaves_untried_and_tripping_rows_untouched_but_keeps_earlier_results(db, mapbox, sleeps) -> None:
    rows = [("ok", "Fine", "id-0")] + [(f"d{i}", f"Down{i}", f"id-{i + 1}") for i in range(3)] + [("late", "Late", "id-9")]
    upsert_listings([_row(sid, street=street, id=rid) for sid, street, rid in rows])
    mapbox.answers = {f"Down{i}": [("status", 503)] for i in range(3)} | {"Fine": [("ok", INSIDE)]}
    summary = _pass(mapbox)
    got = _all(db)
    assert summary.unavailable and summary.ok == 1
    assert got["ok"]["geocodeStatus"] == "ok"
    for sid in ("d0", "d1", "d2", "late"):
        assert got[sid]["geocodeStatus"] == "pending" and got[sid]["geocodeAttempts"] == 0
    assert not any("Late" in unquote(r.url.path) for r in mapbox.requests)


def test_cli_reports_an_outage_and_exits_75(db, mapbox, sleeps, monkeypatch) -> None:
    upsert_listings([_row(str(i), street=f"Gata{i}") for i in range(5)])
    mapbox.default = [("boom",)]
    real = geo.geocode_pending
    monkeypatch.setattr(run, "geocode_pending", lambda **kw: real(client=mapbox.client(), **kw))
    result = CliRunner().invoke(run.cli, ["geocode"])
    assert result.exit_code == 75
    assert "unavailable" in result.output


def test_an_undecodable_response_fails_only_that_row_on_every_pass(db, sleeps) -> None:
    upsert_listings([_row("a", street="Aaa", id="id-a"), _row("b", street="Bbb", id="id-b")])

    def h(req):
        if "Aaa" in unquote(req.url.path):
            return httpx.Response(200, headers={"Content-Encoding": "gzip"}, content=b"notgzip")
        return httpx.Response(200, json={"features": [{"center": INSIDE}]})

    for expected in (1, 2):
        summary = geo.geocode_pending(limit=50, client=httpx.Client(transport=httpx.MockTransport(h)))
        got = _all(db)
        assert (summary.failed, summary.ok) == ((1, 1) if expected == 1 else (1, 0))
        assert got["a"]["geocodeStatus"] == "failed" and got["a"]["geocodeAttempts"] == expected
        assert got["b"]["geocodeStatus"] == "ok"


def test_a_superscript_retry_after_is_ignored_and_the_row_fails_normally(db, sleeps) -> None:
    """b"\xb2" decodes to "²", which str.isdigit() accepts but float() rejects."""
    upsert_listings([_row("a", street="Aaa", id="id-a"), _row("b", street="Bbb", id="id-b")])
    mb = Mapbox()
    mb.answers = {
        "Aaa": [("raw", httpx.Response(503, headers=[(b"Retry-After", b"\xb2")]))],
        "Bbb": [("ok", INSIDE)],
    }
    summary = geo.geocode_pending(limit=50, client=mb.client())
    assert (summary.failed, summary.ok) == (1, 1)  # a's 503 is charged because b was answered
    assert _all(db)["a"]["geocodeStatus"] == "failed"


@pytest.mark.parametrize("hint,expected", [("7", 7.0), ("7.5", 7.5), ("\xb2", None), ("", None), ("-3", None), ("1e3", None), ("٣", None)])
def test_retry_after_parsing_accepts_only_plain_decimals(hint, expected) -> None:
    assert geo._parse_retry_after(hint) == expected


def test_any_other_error_while_handling_a_row_fails_that_row_and_logs_only_its_type(
    db, mapbox, sleeps, monkeypatch, caplog
) -> None:
    upsert_listings([_row("a", street="Aaa", id="id-a"), _row("b", street="Bbb", id="id-b")])
    real = geo._lookup

    def flaky(http, token, q, attempts=1):
        if "Aaa" in q:
            raise ZeroDivisionError(f"surprise containing {token}")
        return real(http, token, q, attempts)

    monkeypatch.setenv("MAPBOX_TOKEN", SECRET)
    monkeypatch.setattr(geo, "_lookup", flaky)
    summary = _pass(mapbox)
    assert (summary.failed, summary.ok) == (1, 1)
    assert _all(db)["a"]["geocodeAttempts"] == 1
    assert SECRET not in caplog.text and "ZeroDivisionError" in caplog.text


def test_a_rejected_token_still_aborts_the_pass(db, mapbox, sleeps) -> None:
    upsert_listings([_row("a", street="Aaa")])
    mapbox.answers = {"Aaa": [("status", 403)]}
    with pytest.raises(RuntimeError, match="403"):
        _pass(mapbox)


def _rows(n: int) -> None:
    upsert_listings([_row(str(i), street=f"Gata{i}", id=f"id-{i}") for i in range(n)])


def test_systemic_bug_stops_the_pass_uncharged_with_a_nonzero_exit(db, mapbox, sleeps, monkeypatch) -> None:
    _rows(5)
    monkeypatch.setattr(geo, "_lookup", lambda http, token, q, attempts=1: 1 / 0)
    summary = _pass(mapbox)
    assert summary.internal_error and summary.failed == 0
    assert {r["geocodeAttempts"] for r in _all(db).values()} == {0}
    # ...and through the CLI, three cron passes in a row
    monkeypatch.setattr(run, "geocode_pending", lambda **kw: geo.geocode_pending(client=mapbox.client(), **kw))
    for _ in range(3):
        result = CliRunner().invoke(run.cli, ["geocode"])
        assert result.exit_code == 1 and "internal error" in result.output
    assert {r["geocodeAttempts"] for r in _all(db).values()} == {0}


def test_one_odd_row_among_answered_ones_is_charged_and_the_pass_continues(db, mapbox, sleeps, monkeypatch) -> None:
    _rows(3)
    real = geo._lookup

    def lookup(http, token, q, attempts=1):
        if "Gata0 " in q:
            raise ZeroDivisionError("odd row")
        return real(http, token, q, attempts)

    monkeypatch.setattr(geo, "_lookup", lookup)
    summary = _pass(mapbox)
    got = _all(db)
    assert (summary.failed, summary.ok) == (1, 2) and not summary.internal_error
    assert got["0"]["geocodeStatus"] == "failed" and got["0"]["geocodeAttempts"] == 1


def test_a_rejected_token_exits_78_without_a_traceback(db, mapbox, sleeps, monkeypatch) -> None:
    monkeypatch.setenv("MAPBOX_TOKEN", SECRET)
    _rows(1)
    mapbox.default = [("status", 401)]
    real = geo.geocode_pending
    monkeypatch.setattr(run, "geocode_pending", lambda **kw: real(client=mapbox.client(), **kw))
    result = CliRunner().invoke(run.cli, ["geocode"])
    assert result.exit_code == 78  # EX_CONFIG
    assert "rejected the token" in result.output and SECRET not in result.output
    assert result.exception is None or isinstance(result.exception, SystemExit)  # no traceback


def test_a_missing_token_exits_78(db, monkeypatch) -> None:
    monkeypatch.setenv("MAPBOX_TOKEN", "")
    result = CliRunner().invoke(run.cli, ["geocode"])
    assert result.exit_code == 78 and "MAPBOX_TOKEN" in result.output


def test_help_documents_the_geocode_exit_codes() -> None:
    out = CliRunner().invoke(run.cli, ["--help"]).output
    assert "78" in out and "EX_CONFIG" in out
    geocode_help = CliRunner().invoke(run.cli, ["geocode", "--help"]).output
    assert "75" in geocode_help and "78" in geocode_help


# ---------------------------------------------------------------------------
# B16 review 4: starvation, reduced-budget charging, documented bound
# ---------------------------------------------------------------------------


def test_persistently_failing_rows_cannot_starve_the_rest_of_the_backlog(db, sleeps) -> None:
    """Three always-5xx rows used to sort first on every pass (same attempts, same ids),
    trip the breaker each time, and keep the good row from ever being requested."""
    upsert_listings(
        [_row(f"p{i}", street=f"Poison{i}", id=f"id-{i}") for i in range(3)]
        + [_row("good", street="Fine", id="id-9")]
    )
    mb = Mapbox()
    mb.answers = {"Poison": [("status", 503)], "Fine": [("ok", INSIDE)]}
    for i in range(40):
        geo.geocode_pending(limit=50, client=mb.client(), order_salt=f"pass-{i}")
        if _all(db)["good"]["geocodeStatus"] == "ok":
            break
    assert _all(db)["good"]["geocodeStatus"] == "ok", "the good row was never reached"
    assert i < 40


def test_the_order_rotates_between_passes_but_is_stable_for_one_salt(db, mapbox, sleeps) -> None:
    upsert_listings([_row(str(i), street=f"Gata{i}", id=f"id-{i}") for i in range(8)])

    def order(salt: str) -> tuple[str, ...]:
        with db.begin() as c:  # back to un-geocoded
            c.execute(text(
                'UPDATE "Listing" SET lat = NULL, lng = NULL, "geocodeStatus" = \'pending\', "geocodeAttempts" = 0'
            ))
        mapbox.requests.clear()
        geo.geocode_pending(limit=8, client=mapbox.client(), order_salt=salt)
        return tuple(unquote(r.url.path) for r in mapbox.requests)

    assert order("same") == order("same")
    assert len({order(f"other-{i}") for i in range(6)}) > 1


def test_only_rows_that_got_the_full_retry_budget_are_charged(db, mapbox, sleeps) -> None:
    """After the first failing row a streak is under way and later rows get a single try;
    a brief blip must not charge them."""
    upsert_listings(
        [_row("first", street="First", id="id-1"), _row("second", street="Second", id="id-2"),
         _row("good", street="Fine", id="id-3")]
    )
    mapbox.answers = {"First": [("status", 503)], "Second": [("status", 503)], "Fine": [("ok", INSIDE)]}
    summary = geo.geocode_pending(limit=50, client=mapbox.client(), order_salt="x")
    got = _all(db)
    # the order is salted; make the assertion order-independent: whichever failing row came
    # first had the full budget (charged), the one after it was reduced (not charged)
    assert got["good"]["geocodeStatus"] == "ok"
    charged = sorted(got[k]["geocodeAttempts"] for k in ("first", "second"))
    assert charged in ([0, 1], [0, 0]) and summary.failed == charged.count(1)


def test_reduced_budget_rows_stay_uncharged_when_a_later_row_is_answered(db, sleeps, monkeypatch) -> None:
    """Deterministic version: force the order first, second, good."""
    upsert_listings(
        [_row("first", street="First", id="id-1"), _row("second", street="Second", id="id-2"),
         _row("good", street="Fine", id="id-3")]
    )
    mb = Mapbox()
    mb.answers = {"First": [("status", 503)], "Second": [("status", 503)], "Fine": [("ok", INSIDE)]}
    summary = geo.geocode_pending(limit=50, client=mb.client())
    got = _all(db)
    assert got["first"]["geocodeAttempts"] == 1 and got["first"]["geocodeStatus"] == "failed"
    assert got["second"]["geocodeAttempts"] == 0 and got["second"]["geocodeStatus"] == "pending"
    assert got["good"]["geocodeStatus"] == "ok" and summary.failed == 1
    asked = [unquote(r.url.path) for r in mb.requests]
    assert sum("First" in p for p in asked) == geo.REQUEST_ATTEMPTS
    assert sum("Second" in p for p in asked) == 1


def test_help_documents_the_always_failing_row_bound() -> None:
    out = CliRunner().invoke(run.cli, ["geocode", "--help"]).output
    assert "never charged" in out and f"{geo.REQUEST_ATTEMPTS} requests" in out


@pytest.mark.parametrize("coordinates", [{"lat": 59.33}, {"long": 18.07}])
@pytest.mark.parametrize("status, attempts", [("pending", 0), ("failed", 2)])
def test_geocoder_repairs_incomplete_source_pairs(db, mapbox, sleeps, coordinates, status, attempts):
    from scraper import hemnet
    from tests.test_hemnet_parser import SAMPLE_CARD

    row = hemnet._to_row({**SAMPLE_CARD, "coordinates": coordinates}, "ostermalm")
    assert row is not None
    upsert_listing(row)
    _set(db, row["sourceId"], geocodeStatus=status, geocodeAttempts=attempts)
    summary = _pass(mapbox)
    assert summary.ok == 1 and len(mapbox.requests) == 1
    stored = _all(db)[row["sourceId"]]
    assert (stored["lat"], stored["lng"]) == (INSIDE[1], INSIDE[0])
    assert stored["geocodeStatus"] == "ok" and stored["geocodeAttempts"] == attempts + 1
    assert stored["geocodedAt"] is not None
    _pass(mapbox)
    assert len(mapbox.requests) == 1


@pytest.mark.parametrize("answer, status, attempts, flag", [
    (("empty",), "not_found", 1, None),
    (("status", 422), "failed", 1, None),
    (("status", 429), "pending", 0, "rate_limited"),
    (("status", 503), "pending", 0, "unavailable"),
])
def test_incomplete_legacy_pair_preserves_outcome_and_retry_semantics(db, mapbox, sleeps, answer, status, attempts, flag):
    upsert_listing(_row("partial"))
    _set(db, "partial", lat=59.33)  # legacy half-pair, bypass current ingest normalization
    mapbox.default = [answer]
    summary = _pass(mapbox)
    assert len(mapbox.requests) == (geo.REQUEST_ATTEMPTS if flag else 1)
    stored = _all(db)["partial"]
    assert stored["geocodeStatus"] == status and stored["geocodeAttempts"] == attempts
    if flag:
        assert getattr(summary, flag)
        assert (stored["lat"], stored["lng"]) == (59.33, None)
    else:
        assert stored["lat"] is None and stored["lng"] is None


@pytest.mark.parametrize("answer", [("empty",), ("ok", INSIDE)])
@pytest.mark.parametrize("new_status", ["inline", "pending"])
def test_complete_pair_arriving_during_incomplete_lookup_is_preserved(db, mapbox, sleeps, answer, new_status):
    upsert_listing(_row("partial"))
    _set(db, "partial", lat=59.33)  # legacy half-pair, bypass current ingest normalization
    mapbox.default = [answer]
    original = mapbox.handler

    def handler(request):
        # Simulate a new source result, and also a legacy writer without a status update.
        if new_status == "inline":
            upsert_listing(_row("partial", lat=59.31, lng=18.01))
        else:
            _set(db, "partial", lat=59.31, lng=18.01)
        return original(request)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        geo.geocode_pending(client=client)
    assert len(mapbox.requests) == 1
    stored = _all(db)["partial"]
    assert (stored["lat"], stored["lng"]) == (59.31, 18.01)
    assert stored["geocodeStatus"] == new_status and stored["geocodeAttempts"] == 0


def test_incomplete_legacy_pair_at_attempt_cap_is_left_unchanged(db, mapbox, sleeps):
    upsert_listing(_row("partial"))
    _set(db, "partial", lat=59.33, geocodeStatus="failed", geocodeAttempts=geo.MAX_ATTEMPTS)
    assert _pass(mapbox).ok == 0 and mapbox.requests == []
    stored = _all(db)["partial"]
    assert stored["geocodeAttempts"] == geo.MAX_ATTEMPTS
    assert (stored["lat"], stored["lng"]) == (59.33, None)
