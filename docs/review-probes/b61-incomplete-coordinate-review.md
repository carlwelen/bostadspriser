# B61 adversarial review

- Verdict: **APPROVE**.
- Immutable target: `d9fcd9c99f8c23e741f2c894916edae66ddd69f0`.
- Parent: `95d51b10cf3e9d3819481ad3f410e8cab4b5fece` (B58 reviewed separately).
- Findings: none. No new backlog item required.
- Scope: `scraper/src/scraper/geocode.py` and its tests. Reviewed both changed SQL predicates, parser/upsert status interactions, row budgets, outcomes and batch flushing. The source gate claim (543 Vitest / 348 browser / 791 pytest) was not used as independent verification and was not rerun.

## Verification

Every command below ran in a detached scratch worktree at `/tmp/review-b61`; main and the implementer's worktree remained untouched. No live provider requests or protected files were used. All HTTP in the exercised geocoder paths used `httpx.MockTransport`. Test database: `bostadspriser_test_r_b61`; reserved browser port: 3113 (unused).

Setup:

```sh
git worktree add --detach /tmp/review-b61 d9fcd9c99f8c23e741f2c894916edae66ddd69f0
cd /tmp/review-b61/web
pnpm install --frozen-lockfile
cd /tmp/review-b61/scraper
uv sync
```

Test commands used these environment values explicitly (shown once for readability):

```sh
export TEST_DB_NAME=bostadspriser_test_r_b61 E2E_PORT=3113
export TEST_DATABASE_URL=postgresql://bostadspriser:bostadspriser@localhost:5432/bostadspriser_test_r_b61
export DATABASE_URL=postgresql://bostadspriser:bostadspriser@localhost:5432/bostadspriser_test_r_b61
```

Initial focused suites: `uv run pytest -q tests/test_geocode.py tests/test_db_upsert.py tests/test_db_batch_upsert.py tests/test_refresh_view.py` → **127 passed**. Initial independent probes: `uv run pytest -q tests/test_b61_review_probe.py` → **33 passed**. The final combined restored run below is the authoritative isolated green run.

### Production-only reversion

Tests stayed at the target commit. From scratch root:

```sh
git checkout d9fcd9c^ -- scraper/src/scraper/geocode.py
cd scraper
uv run pytest -q tests/test_geocode.py -k 'incomplete_source_pairs or incomplete_legacy_pair or complete_pair_arriving'
```

Result: **10 failed, 3 passed, 63 deselected** (`production-reversion.log`). The latitude-present/longitude-missing row is never selected: successes, failure outcomes, outage preservation and the concurrency precondition all fail for that semantic reason. Longitude-present controls and the cap control pass. Proving tests fail without the fix: **yes**.

### Independent flush-predicate reversion

Restore target production file, then change only the second occurrence of `or_(table.c.lat.is_(None), table.c.lng.is_(None)),` back to `table.c.lat.is_(None),` (the `flush()` predicate). Exact mutation:

```python
from pathlib import Path
p = Path('scraper/src/scraper/geocode.py')
s = p.read_text()
old = 'or_(table.c.lat.is_(None), table.c.lng.is_(None)),'
assert s.count(old) == 2
first, middle, last = s.split(old)
p.write_text(first + old + middle + 'table.c.lat.is_(None),' + last)
```

Same 13-case pytest command → **4 failed, 9 passed, 63 deselected** (`flush-only-reversion.log`). Requests occur, but successful and definitive unsuccessful outcomes for the latitude-only rows fail to persist. This independently proves the write change is necessary; selection-only mutation evidence would not establish that.

### Preservation-guard mutation

Restore the target, then use the same script with `True,` replacing only the second predicate. Keep the status guard intact:

```sh
uv run pytest -q tests/test_geocode.py tests/test_b61_review_probe.py -k 'complete_pair_arriving or batch_flush_keeps'
```

Result: **8 failed, 8 passed, 93 deselected** (`coordinate-guard-removed.log`). Both source tests and independent multi-row delayed-flush tests detect overwrites of newer complete pairs still carrying pending/failed status; inline/ok status controls survive. The tests therefore exercise the coordinate guard itself, rather than merely relying on status relabelling.

### Restored final verification

```sh
# scratch root
git checkout d9fcd9c -- scraper/src/scraper/geocode.py
git diff --exit-code d9fcd9c -- scraper/src/scraper/geocode.py scraper/tests/test_geocode.py
cd scraper
uv run pytest -q tests/test_geocode.py tests/test_db_upsert.py tests/test_db_batch_upsert.py tests/test_refresh_view.py tests/test_b61_review_probe.py
uv run ruff check src/scraper/geocode.py tests/test_geocode.py
```

Final combined result: **160 passed**, production/tests identical to reviewed commit, Ruff clean (`restored-green.log`, `ruff.log`). No web behavior, schema, migrations, source traffic, or bot-protection behavior changed. Focused PostgreSQL-backed checks cover the two SQL predicate changes; no unrelated web gate was run.

## Independent probes

33 cases, including a 40-row Cartesian selection matrix across both missing axes/both missing/full pairs, all five statuses, and attempt-cap boundaries; resolved statuses blocking writes even with incomplete pairs; two-row batch flush after a newer complete pair arrives, across successful/empty/422 outcomes and four statuses; and Booli parser-to-DB-to-geocoder coverage for both missing axes. Complete snapshots assert coordinate/status/attempt/timestamp preservation.

Exact scratch-only probe code (also retained as `test_b61_review_probe.py`):

```python
"""Independent B61 PostgreSQL probes; every HTTP call uses MockTransport."""

from datetime import datetime

import httpx
import pytest

from scraper import geocode as geo
from scraper.db import upsert_listing, upsert_listings
from tests.test_geocode import INSIDE, Mapbox, _all, _row, _set


@pytest.fixture(autouse=True)
def hermetic(monkeypatch):
    monkeypatch.setattr(geo, "_sleep", lambda _: None)
    monkeypatch.setattr(geo, "_new_salt", lambda: "")


def test_selection_cartesian_matrix(db):
    shapes = [(None, None), (59.33, None), (None, 18.07), (59.33, 18.07)]
    statuses = ["pending", "failed", "inline", "ok", "not_found"]
    expected = set()
    for shape, (lat, lng) in enumerate(shapes):
        for status in statuses:
            for attempts in (0, geo.MAX_ATTEMPTS):
                sid = f"{shape}-{status}-{attempts}"
                upsert_listing(_row(sid, lat=lat, lng=lng))
                _set(db, sid, geocodeStatus=status, geocodeAttempts=attempts)
                if shape != 3 and status in ("pending", "failed") and attempts == 0:
                    expected.add(sid)
    before = _all(db)
    fake = Mapbox()
    with fake.client() as client:
        summary = geo.geocode_pending(client=client, limit=100, write_batch_size=2)
    assert summary.ok == len(expected) == len(fake.requests) == 6
    after = _all(db)
    for sid, old in before.items():
        new = after[sid]
        if sid in expected:
            assert (new["lat"], new["lng"]) == (INSIDE[1], INSIDE[0])
            assert new["geocodeStatus"] == "ok"
            assert new["geocodeAttempts"] == 1
        else:
            if old["geocodeStatus"] == "pending" and old["lat"] is not None and old["lng"] is not None:
                old = {**old, "geocodeStatus": "inline"}
            assert new == old


@pytest.mark.parametrize("coordinates", [{"lat": 59.33}, {"lng": 18.07}])
@pytest.mark.parametrize("new_status", ["inline", "ok", "not_found"])
@pytest.mark.parametrize("answer", [("ok", INSIDE), ("empty",), ("status", 422)])
def test_status_resolution_without_complete_pair_blocks_delayed_flush(db, coordinates, new_status, answer):
    upsert_listing(_row("changed", **coordinates))
    fake = Mapbox()
    fake.default = [answer]
    snapshot = {}

    def handler(request):
        _set(db, "changed", geocodeStatus=new_status, geocodeAttempts=2)
        snapshot.update(_all(db)["changed"])
        return fake.handler(request)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        geo.geocode_pending(client=client)
    assert len(fake.requests) == 1
    assert _all(db)["changed"] == snapshot


@pytest.mark.parametrize("new_status", ["pending", "failed", "inline", "ok"])
@pytest.mark.parametrize("answer", [("ok", INSIDE), ("empty",), ("status", 422)])
def test_batch_flush_keeps_newer_complete_pair_and_updates_other_partial_row(db, new_status, answer):
    upsert_listings([
        _row("first", id="a", lat=59.33),
        _row("second", id="b", lng=18.07),
    ])
    fake = Mapbox()
    fake.default = [answer]
    snapshot = {}

    def handler(request):
        if len(fake.requests) == 1:
            # First response is already queued, but the multi-row flush has not run.
            _set(db, "first", lat=59.31, lng=18.01, geocodeStatus=new_status,
                 geocodeAttempts=2, geocodedAt=datetime(2026, 10, 25, 12))
            snapshot.update(_all(db)["first"])
        return fake.handler(request)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        geo.geocode_pending(client=client, write_batch_size=2)
    assert len(fake.requests) == 2
    after = _all(db)
    assert after["first"] == snapshot
    assert after["second"]["geocodeAttempts"] == 1
    if answer[0] == "ok":
        assert (after["second"]["lat"], after["second"]["lng"]) == (INSIDE[1], INSIDE[0])
        assert after["second"]["geocodeStatus"] == "ok"
    else:
        assert after["second"]["lat"] is None and after["second"]["lng"] is None
        assert after["second"]["geocodeStatus"] == ("not_found" if answer[0] == "empty" else "failed")


@pytest.mark.parametrize("coordinates", [{"latitude": 59.33}, {"longitude": 18.07}])
def test_booli_partial_pair_reaches_geocoder(db, coordinates):
    from scraper import booli
    from tests.test_booli_parser import SAMPLE_CARD

    card = {**SAMPLE_CARD, "latitude": None, "longitude": None, **coordinates}
    row = booli._to_row(card, "vasastan")
    assert row is not None
    upsert_listing(row)
    fake = Mapbox()
    with fake.client() as client:
        geo.geocode_pending(client=client)
    stored = _all(db)[row["sourceId"]]
    assert len(fake.requests) == 1
    assert (stored["lat"], stored["lng"]) == (INSIDE[1], INSIDE[0])
    assert stored["geocodeStatus"] == "ok"

```

Cleanup: `git worktree remove --force /tmp/review-b61` completed; report, logs, and probe source retained in `/tmp/r-b61/`.
