**APPROVE — B62 Python**

Reviewed immutable commit `1b3c70e2b9eeb07c9cf9d3592c5f8fb863b11e3f` against parent `66ce1b1` in `/tmp/review-b62-python`. Main and the implementer's worktree were read-only. The approved F45 dependency and prior B58/B61 work were not part of this verdict; B57 is separate. C's heatmap SQL boundary remains separately pending and is not approved by this report.

Concrete findings: none. New backlog items: none.

The Python acceptance criteria hold: source parsing and the upsert boundary reject incomplete, nonfinite and out-of-range pairs while accepting inclusive global bounds; invalid sightings preserve an existing valid pair and its geocoding status/timestamp/attempt budget; nonfinite raw JSON is serializable without mutating the source or losing the priced row. Legacy cleanup clears invalid coordinates and timestamps, retains attempts, commits before notifying the CLI, and is idempotent. Committed cleanup republishes canonical selection on normal completion, rejected token, provider outage/rate limiting, internal lookup errors, selection/client-construction errors, and an outcome-write failure. Failed maintenance transactions do not publish. The update entry point also publishes cleanup after a later matcher error.

Validation used `TEST_DB_NAME=bostadspriser_test_r_b62 E2E_PORT=3113`, real PostgreSQL, fixture source cards and `httpx.MockTransport`. No live Hemnet, Booli or Mapbox requests; no protected state/cache/env or dev database mutations.

- Full original scraper suite: **872 passed** (`full-pytest.log`, 48.53 s).
- Independent probes: **46 passed** as part of the restored focused run. The initial 40-probe run passed before six extra existing-geocoder-pair preservation cases were added (`independent-probes.log`). Exact final probe file is adjacent and pasted below.
- Restored coordinate/geocoder/probe suites: **203 passed** (`restored-focused.log`, 20.50 s).
- Ruff: passed (`ruff.log`). Reviewed production files restored exactly to the immutable commit before final verification.
- Implementer full gate evidence inspected: `/tmp/b62-full-gate-approved-f45.log` reports green with 543 Vitest, 352 browser and 872 pytest checks. This reviewer independently reran the full Python suite; no unrelated web gate was rerun.

Proving tests fail without the fix: **yes**. All reversion changes were confined to the disposable scratch checkout; the new `coordinates.py` helper was left available so import/collection failures could not masquerade as proof.

1. Restored the five existing changed production modules to the parent and ran the committed B62 tests. Result: **71 failed, 10 passed**, with actual parser, database-write, raw-JSON, preservation, cleanup and stale-snapshot failures; no collection failures. Evidence: `production-reversion.log`.

```sh
git restore --source=66ce1b1 -- scraper/src/scraper/booli.py scraper/src/scraper/db.py scraper/src/scraper/geocode.py scraper/src/scraper/hemnet.py scraper/src/scraper/run.py
cd scraper
TEST_DB_NAME=bostadspriser_test_r_b62 E2E_PORT=3113 uv run pytest -q tests/test_coordinate_validity.py
```

2. Restored the target production tree, then reverted only `run.py`, leaving parsing, cleanup, callback capability and summary fields intact. Result: **9 failed, 1 passed, 71 deselected**; all nine publication cases retained Hemnet in the materialized view instead of publishing the valid Booli partner. Rollback control passed. This independently proves the CLI change is necessary. Evidence: `cli-only-reversion.log`.

```sh
git restore --source=1b3c70e -- scraper/src/scraper
git restore --source=66ce1b1 -- scraper/src/scraper/run.py
TEST_DB_NAME=bostadspriser_test_r_b62 E2E_PORT=3113 uv run --directory scraper pytest -q tests/test_coordinate_validity.py -k 'cleanup_only or cleanup_publication or failed_maintenance'
```

3. Final restoration and verification:

```sh
git restore --source=1b3c70e -- scraper/src/scraper
TEST_DB_NAME=bostadspriser_test_r_b62 E2E_PORT=3113 uv run --directory scraper pytest -q tests/test_coordinate_validity.py tests/test_geocode.py tests/test_r_b62_probe.py
```

Independent probes exercise adjacent floating-point out-of-range values on all axes, non-Stockholm valid pairs, both nonfinite JSON constants and numeric overflow, duplicate sightings across batch boundaries, preservation of preexisting geocoder results, NaN/Infinity cleanup with missing partners and varied statuses, commit visibility and idempotency, actual Session commit failure, post-cleanup outcome-write failure with app notification, missing-token no-write semantics, and update publication after matcher failure.

Exact reviewer probe code:

```python
"""Independent B62 review probes: fixture-only sources and dedicated test DB."""
import copy
import json
import math
from datetime import datetime

import httpx
import pytest
from click.testing import CliRunner
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from scraper import booli, db as database, geocode, hemnet, run
from scraper.db import refresh_deduped, upsert_listing, upsert_listings
from tests.test_booli_parser import SAMPLE_CARD as BOOLI_CARD
from tests.test_geocode import INSIDE, _all, _row, _set
from tests.test_hemnet_parser import SAMPLE_CARD as HEMNET_CARD


def source_row(source, lat, lng):
    card = copy.deepcopy(HEMNET_CARD if source == "hemnet" else BOOLI_CARD)
    if source == "hemnet":
        card["coordinates"] = {"lat": lat, "long": lng}
    else:
        card.update(latitude=lat, longitude=lng)
    before = repr(card)
    row = (hemnet if source == "hemnet" else booli)._to_row(card, "ostermalm")
    assert repr(card) == before
    return row


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("pair", [
    (math.nextafter(90, math.inf), 0), (math.nextafter(-90, -math.inf), 0),
    (0, math.nextafter(180, math.inf)), (0, math.nextafter(-180, -math.inf)),
    ("1e999", "18"), ("59", "NaN"), ("-Infinity", "18"),
    (0, False), ({"value": 59}, 18), (59, [18]),
])
def test_independent_source_to_database_invalid_pair_retains_sale(db, source, pair):
    row = source_row(source, *pair)
    before = repr(row)
    upsert_listing(row)
    got = _all(db)[row["sourceId"]]
    assert got["priceSek"] == row["priceSek"] > 0
    assert (got["lat"], got["lng"], got["geocodedAt"], got["geocodeStatus"]) == (None, None, None, "pending")
    assert repr(row) == before


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("pair", [(-90, 180), (90, -180), (-0.0, 0.0), (-33.86, 151.21)])
def test_independent_global_pairs_survive_parsing_storage_and_maintenance(db, source, pair):
    row = source_row(source, *pair)
    upsert_listing(row)
    callbacks = []
    with httpx.Client(transport=httpx.MockTransport(lambda request: pytest.fail("valid coordinate must not request geocoding"))) as client:
        result = geocode.geocode_pending(client=client, on_cleanup=callbacks.append)
    got = _all(db)[row["sourceId"]]
    assert (got["lat"], got["lng"]) == pair
    assert got["geocodeStatus"] == "inline" and got["geocodeAttempts"] == 0
    assert result.coordinates_cleared == 0 and callbacks == [0]


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("batched", [False, True])
def test_independent_raw_json_nonfinite_ingest_is_lossless_for_sale(db, source, batched):
    numbers = json.loads('{"a": NaN, "b": Infinity, "c": -Infinity, "overflow": 1e999, "nested": [[NaN], {"x": Infinity}]}')
    row = source_row(source, numbers["a"], numbers["b"])
    row["raw"]["diagnostics"] = numbers
    before = repr(row)
    if batched:
        upsert_listings([row, _row("ordinary", source="other", lat=0, lng=0)])
    else:
        upsert_listing(row)
    got = _all(db)[row["sourceId"]]
    assert got["raw"]["diagnostics"] == {"a": "nan", "b": "inf", "c": "-inf", "overflow": "inf", "nested": [["nan"], {"x": "inf"}]}
    assert got["priceSek"] > 0 and got["lat"] is None and got["lng"] is None
    assert repr(row) == before


@pytest.mark.parametrize("batch_size", [1, 2, 100])
def test_independent_mixed_duplicates_preserve_last_valid_pair_and_attempt_budget(db, batch_size):
    old_stamp, new_stamp = datetime(2024, 1, 1), datetime(2025, 1, 1)
    upsert_listing(_row("same", lat=-33.86, lng=151.21, geocodedAt=old_stamp))
    _set(db, "same", geocodeStatus="ok", geocodeAttempts=2)
    rows = [_row("same", lat="nan", lng=18, priceSek=4_000_000),
            _row("same", lat=-90, lng=180, geocodedAt=new_stamp, priceSek=5_000_000),
            _row("same", lat=59, lng=True, priceSek=6_000_000)]
    upsert_listings(rows, batch_size=batch_size)
    got = _all(db)["same"]
    assert (got["lat"], got["lng"], got["geocodedAt"], got["geocodeStatus"]) == (-90, 180, new_stamp, "inline")
    assert got["priceSek"] == 6_000_000 and got["geocodeAttempts"] == 2


@pytest.mark.parametrize("batched", [False, True])
@pytest.mark.parametrize("pair", [(float("nan"), 18), (59, False), (None, 18)])
def test_independent_invalid_resighting_preserves_preexisting_geocoder_pair(db, batched, pair):
    stamp = datetime(2024, 1, 1)
    upsert_listing(_row("geocoded", lat=-33.86, lng=151.21, geocodedAt=stamp))
    _set(db, "geocoded", geocodeStatus="ok", geocodeAttempts=2)
    incoming = _row("geocoded", lat=pair[0], lng=pair[1], priceSek=5_500_000)
    if batched:
        upsert_listings([incoming, incoming])
    else:
        upsert_listing(incoming)
    got = _all(db)["geocoded"]
    assert (got["lat"], got["lng"], got["geocodedAt"], got["geocodeStatus"]) == (-33.86, 151.21, stamp, "ok")
    assert got["geocodeAttempts"] == 2 and got["priceSek"] == 5_500_000


def seed_canonical_pair(db):
    upsert_listings([_row("preferred"), _row("partner", source="booli", lat=59.32, lng=18.02)])
    _set(db, "preferred", lat=float("nan"), lng=float("-inf"), geocodeStatus="inline")
    assert refresh_deduped() == "refreshed"
    assert canonical(db) == "hemnet"


def canonical(db):
    with db.connect() as conn:
        return conn.execute(text('SELECT source FROM "DedupedListingMat"')).scalar_one()


def test_independent_cleanup_full_invalid_axis_matrix_commits_before_callback_and_is_idempotent(db):
    pairs = [(float("nan"), None), (None, float("nan")), (float("inf"), 0),
             (0, float("-inf")), (0, float("nan")), (-91, None), (None, -181)]
    statuses = ["inline", "ok", "not_found", "failed", "pending", "inline", "ok"]
    for index, ((lat, lng), status) in enumerate(zip(pairs, statuses)):
        upsert_listing(_row(str(index)))
        _set(db, str(index), lat=lat, lng=lng, geocodeStatus=status,
             geocodedAt=datetime(2024, 1, 1), geocodeAttempts=3 + index)
    callbacks = []

    def committed(count):
        callbacks.append(count)
        rows = _all(db)
        for index in range(len(pairs)):
            row = rows[str(index)]
            assert (row["lat"], row["lng"], row["geocodedAt"], row["geocodeStatus"]) == (None, None, None, "pending")
            assert row["geocodeAttempts"] == 3 + index

    with httpx.Client(transport=httpx.MockTransport(lambda request: pytest.fail("attempt capped"))) as client:
        one = geocode.geocode_pending(client=client, on_cleanup=committed)
        two = geocode.geocode_pending(client=client, on_cleanup=committed)
    assert (one.coordinates_cleared, two.coordinates_cleared) == (7, 0)
    assert callbacks == [7, 0]


def test_independent_actual_maintenance_commit_failure_rolls_back_without_publication(db, monkeypatch):
    seed_canonical_pair(db)
    notifications = []
    monkeypatch.setattr(database, "revalidate_app", lambda: notifications.append(True))

    def fail_commit(session):
        raise RuntimeError("independent maintenance commit failure")

    event.listen(Session, "before_commit", fail_commit)
    try:
        result = CliRunner().invoke(run.cli, ["geocode", "--limit", "0"])
    finally:
        event.remove(Session, "before_commit", fail_commit)
    assert result.exit_code == 1 and "maintenance commit failure" in str(result.exception)
    got = _all(db)["preferred"]
    assert math.isnan(got["lat"]) and got["lng"] == -math.inf
    assert got["geocodeStatus"] == "inline" and canonical(db) == "hemnet"
    assert notifications == []


def test_independent_outcome_write_failure_still_publishes_committed_cleanup(db, monkeypatch):
    seed_canonical_pair(db)
    notifications = []
    monkeypatch.setattr(database, "revalidate_app", lambda: notifications.append(True))
    monkeypatch.setattr(geocode, "_sleep", lambda seconds: None)

    def fail_outcome(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith('UPDATE "Listing" SET') and "b_id" in statement:
            raise RuntimeError("independent outcome write failure")

    real_pending = geocode.geocode_pending
    event.listen(db, "before_cursor_execute", fail_outcome)
    try:
        with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"features": [{"center": INSIDE}]}))) as client:
            monkeypatch.setattr(run, "geocode_pending", lambda **kwargs: real_pending(client=client, **kwargs))
            result = CliRunner().invoke(run.cli, ["geocode"])
    finally:
        event.remove(db, "before_cursor_execute", fail_outcome)
    assert result.exit_code == 1 and "outcome write failure" in str(result.exception)
    got = _all(db)["preferred"]
    assert (got["lat"], got["lng"], got["geocodeStatus"], got["geocodeAttempts"]) == (None, None, "pending", 0)
    assert canonical(db) == "booli" and notifications == [True]


def test_independent_missing_token_has_no_cleanup_or_publication(db, monkeypatch):
    seed_canonical_pair(db)
    monkeypatch.setenv("MAPBOX_TOKEN", "")
    refreshes = []
    monkeypatch.setattr(run, "refresh_deduped", lambda: refreshes.append(True))
    result = CliRunner().invoke(run.cli, ["geocode", "--limit", "0"])
    assert result.exit_code == 78 and refreshes == []
    assert math.isnan(_all(db)["preferred"]["lat"]) and canonical(db) == "hemnet"


def test_independent_update_cleanup_is_published_despite_later_matcher_failure(db, monkeypatch):
    seed_canonical_pair(db)
    monkeypatch.setattr(run, "_refresh", lambda *args: run.UpdateResult(source="hemnet", district="ostermalm", since=None, upserted=0))

    def fail_matcher():
        raise RuntimeError("independent matcher failure")

    monkeypatch.setattr(run, "match_clusters", fail_matcher)
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    assert result.exit_code == 0, result.output
    assert "independent matcher failure" in result.output
    assert (_all(db)["preferred"]["lat"], _all(db)["preferred"]["lng"]) == (None, None)
    assert canonical(db) == "booli"

```

Scratch worktree `/tmp/review-b62-python` was removed after verification. Evidence remains in `/tmp/r-b62-python/`.
