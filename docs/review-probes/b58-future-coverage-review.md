# B58 immutable commit review

Commit: `95d51b10cf3e9d3819481ad3f410e8cab4b5fece` (`fix(scraper): bound sale dates and recover update coverage (B58)`).

Verdict: **APPROVE**. No blocker, major, minor or nit finding identified.

Scope: B58 only. The source branch may contain subsequent B61/B62 work; this review used a detached scratch checkout of the exact commit. B57 cluster invalidation is separate and is not assessed here.

## Evidence

- New committed tests: 14 passed (`targeted-green.log`).
- Meaningful production reversion: all 14 committed tests failed (`production-reversion.log`) after restoring the six modified pre-existing production modules to the parent commit. The new date helper remained present but unused by those reverted modules, avoiding import/collection failures. Failures concern accepted future cards, incorrect watermark/window recovery, and Stockholm date behavior. All production modules were then restored to the reviewed commit.
- Full reviewer scraper suite: **801 passed in 62.16s** (778 committed tests plus 23 independent probes), `full-pytest.log`.
- Focused production reversion: restoring only `source_base.py` to the parent makes all six independent future-only pagination cases fail because they record `oldest_sold_at=2099-01-01`; `pagination-reversion.log`.
- Independent review tests: **23 passed in 2.35s** after final restoration (`independent-green.log`); cases in `test_r_b58_probe.py`, copied below. They use the real PostgreSQL test database and real source parsers/pagination where applicable; provider transport/browser are fully replaced with fixtures.
- Source full-gate log `/tmp/b58-full-gate.log` independently inspected: 543 Vitest, 348 Playwright, 778 pytest passed, plus the remaining gate stages. This is implementer gate evidence; reviewer reruns are recorded separately.

## Acceptance and edge cases exercised

- Both source parsers reject tomorrow/far-future dates and accept today/history; Stockholm-local dates remain correct around spring and autumn DST changes, including Booli's epoch fallback.
- Future-only pages continue to later valid pages. Future-only empty, repeated and capped pagination never creates coverage or a future oldest-sale marker.
- Real database recovery ignores a poisoned 2099 watermark and future retry window. It preserves either earlier valid completed coverage or the original valid initial window, including a 90-day window rather than silently resetting to a shorter lookback.
- Empty, future-only, partial and cancelled retries do not advance coverage. A subsequent valid retry uses the preserved window, closes interrupted run state, and establishes bounded coverage. Upserts remain idempotent.
- Real parser/pagination partial runs resume correctly for both update and backfill; rejected future cards cannot make later valid rows disappear. Backfill leaves update coverage alone.
- Earlier valid coverage survives poisoned state and a subsequent successful update containing only older valid data. Source, district and crawl-kind isolation remain intact.
- No fallback to `Listing` maximum is used. The patch intentionally does not delete legacy future Listing rows; they cannot drive recovery coverage.

## Reproduction commands

All tests ran in `/tmp/review-b58` with `TEST_DB_NAME=bostadspriser_test_r_b58 E2E_PORT=3113`.

```sh
uv run --directory scraper pytest -q tests/test_future_sale_dates.py
git restore --source=95d51b1^ -- scraper/src/scraper/booli.py scraper/src/scraper/crawl_state.py scraper/src/scraper/hemnet.py scraper/src/scraper/run.py scraper/src/scraper/scrape_run.py scraper/src/scraper/source_base.py
uv run --directory scraper pytest -q tests/test_future_sale_dates.py
git restore --source=95d51b1 -- scraper/src/scraper/booli.py scraper/src/scraper/crawl_state.py scraper/src/scraper/hemnet.py scraper/src/scraper/run.py scraper/src/scraper/scrape_run.py scraper/src/scraper/source_base.py
uv run --directory scraper pytest -q
git restore --source=95d51b1^ -- scraper/src/scraper/source_base.py
uv run --directory scraper pytest -q tests/test_r_b58_probe.py -k future_only_pages
git restore --source=95d51b1 -- scraper/src/scraper/source_base.py
uv run --directory scraper pytest -q tests/test_r_b58_probe.py
```

The first independent probe run passed 22 cases and failed one fixture setup because it tried to create partial/backfill runs carrying a completeThrough, which the existing database constraint forbids. The corrected probe uses legal null-watermark partial/backfill states; the exploratory log is retained as `probe-fixture-correction.log`. This was not a production failure.

No source/main edits, commits, pushes, live provider calls, protected-file access, dev-DB access or unrelated process termination. No new backlog item proposed. Production files were verified identical to the reviewed commit before scratch cleanup. `/tmp/review-b58` was removed; evidence remains under `/tmp/r-b58`.

## Independent probe source

```python
"""Independent B58 review probes. All providers are fixture-backed; DB is test-only."""
import asyncio
import dataclasses
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from click.testing import CliRunner
from sqlalchemy import text

from scraper import booli, crawl_state, dates, hemnet, run, scrape_run, source_base
from scraper.errors import CrawlIncomplete
from tests.test_pagination import SOURCES, _PW
from tests.test_run_update import _row

TODAY = date(2026, 10, 25)
INITIAL = TODAY - timedelta(days=90)
PRIOR = TODAY - timedelta(days=30)
FUTURE = date(2099, 1, 1)
OVERLAP = timedelta(days=7)


@pytest.fixture
def frozen(monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 25, 12, tzinfo=ZoneInfo("Europe/Stockholm")).astimezone(tz)
    monkeypatch.setattr(dates, "datetime", Clock)


def finish(since, through=None, status="ok", source="hemnet", district="ostermalm", kind="update"):
    rid = scrape_run.start_run(source, district, kind=kind, since=since)
    scrape_run.finish_run(rid, status, pages=1, rows_upserted=1, rows_rejected=0,
                          oldest_sold_at=since, complete_through=through, required=True)
    return rid


@pytest.mark.parametrize("prior", [False, True])
@pytest.mark.parametrize("mode", ["empty", "future_only", "partial", "cancelled"])
def test_poison_recovery_survives_noncomplete_retries(db, monkeypatch, frozen, prior, mode):
    if prior:
        finish(INITIAL, PRIOR)
    finish(INITIAL, FUTURE)
    finish(FUTURE - OVERLAP, status="failed")
    expected = (PRIOR - OVERLAP, PRIOR) if prior else (INITIAL, None)
    assert crawl_state.update_window("hemnet", "ostermalm", OVERLAP, 1) == expected
    seen = []

    async def first(district, since, **kwargs):
        seen.append(since)
        if mode != "empty":
            yield _row("hemnet", "invalid", district, FUTURE)
        if mode in ("partial", "cancelled"):
            yield _row("hemnet", "current", district, TODAY)
            if mode == "partial":
                raise CrawlIncomplete("fixture page gap")
            raise asyncio.CancelledError("fixture interruption")

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", first)
    monkeypatch.setattr(run, "latest_sold_at", lambda *a: pytest.fail("legacy Listing maximum used"))
    if mode == "cancelled":
        with pytest.raises(asyncio.CancelledError):
            run._refresh("hemnet", "ostermalm", OVERLAP, 1)
    else:
        result = run._refresh("hemnet", "ostermalm", OVERLAP, 1)
        assert bool(result.error) == (mode == "partial")
    assert crawl_state.update_window("hemnet", "ostermalm", OVERLAP, 1) == expected

    async def retry(district, since, **kwargs):
        seen.append(since)
        yield _row("hemnet", "current", district, TODAY)

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", retry)
    assert run._refresh("hemnet", "ostermalm", OVERLAP, 1).error is None
    assert seen == [expected[0], expected[0]]
    assert crawl_state.update_window("hemnet", "ostermalm", OVERLAP, 1) == (TODAY - OVERLAP, TODAY)
    with db.connect() as conn:
        assert conn.execute(text('SELECT "sourceId" FROM "Listing"')).scalars().all() == ["current"]
        assert conn.execute(text('SELECT count(*) FROM "ScrapeRun" WHERE status = \'running\'')).scalar_one() == 0


def card(source, sid, day):
    _, factory, _ = SOURCES[source]
    sold = (datetime.combine(day, time(), ZoneInfo("Europe/Stockholm")).timestamp()
            if source == "hemnet" else day.isoformat())
    return factory(sid, sold=sold)


def pages_fixture(monkeypatch, source, pages, failures):
    module = hemnet if source == "hemnet" else booli
    fetched = []

    async def fetch(ctx, cfg, spec, url):
        page = int(url.rsplit("page=", 1)[1].split("&")[0])
        fetched.append(page)
        assert len(fetched) < 30, "unbounded fixture pagination"
        if page in failures:
            raise RuntimeError("fixture fetch failure")
        return str(page)

    async def noop(*a, **kw):
        pass

    monkeypatch.setattr(source_base, "async_playwright", lambda: _PW())
    monkeypatch.setattr(source_base, "fetch", fetch)
    monkeypatch.setattr(source_base, "warmup", noop)
    monkeypatch.setattr(module, "SOURCE", dataclasses.replace(module.SOURCE, extract_cards=lambda html: pages.get(int(html), [])))
    monkeypatch.setitem(run._SOURCE_ITER, source, module.iter_district)
    return fetched


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("kind", ["update", "backfill"])
def test_real_parser_pagination_partial_and_resume(db, monkeypatch, frozen, source, kind):
    pages = {1: [card(source, "bad1", FUTURE)], 2: [card(source, "bad2", FUTURE)],
             3: [card(source, "valid1", TODAY - timedelta(days=1))],
             4: [card(source, "valid2", TODAY)]}
    failures = {4}
    fetched = pages_fixture(monkeypatch, source, pages, failures)
    first = run._run_recorded(source, "ostermalm", INITIAL, kind=kind)
    assert first.error and first.partial and first.upserted == 1
    assert first.progress.rejected == 2 and first.committed_page == 3
    assert first.committed_oldest == TODAY - timedelta(days=1)
    assert crawl_state.complete_through(source, "ostermalm") is None
    failures.clear()
    fetched.clear()
    if kind == "update":
        assert run._refresh(source, "ostermalm", OVERLAP, 1).error is None
        assert fetched == [1, 2, 3, 4, 5]
        assert crawl_state.complete_through(source, "ostermalm") == TODAY
    else:
        result = CliRunner().invoke(run.cli, ["backfill", "--source", source, "--district", "ostermalm",
                                              "--since", INITIAL.isoformat(), "--resume"])
        assert result.exit_code == 0, result.output
        assert fetched == [3, 4, 5]
        assert crawl_state.backfill_progress(source, "ostermalm") is None
        assert crawl_state.complete_through(source, "ostermalm") is None
    with db.connect() as conn:
        assert conn.execute(text('SELECT "sourceId" FROM "Listing" ORDER BY "sourceId"')).scalars().all() == ["valid1", "valid2"]


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("ending", ["repeat", "cap", "empty"])
def test_future_only_pages_cannot_establish_coverage(db, monkeypatch, frozen, source, ending):
    pages = {1: [card(source, "bad1", FUTURE)]}
    if ending == "repeat":
        pages[2] = pages[1]
    if ending == "cap":
        pages[2] = [card(source, "bad2", FUTURE)]
    fetched = pages_fixture(monkeypatch, source, pages, set())
    report = run._run_recorded(source, "ostermalm", INITIAL, kind="update", max_pages=2)
    assert report.upserted == 0 and report.newest is None
    assert report.progress.oldest_sold_at is None
    assert bool(report.error) == (ending != "empty")
    assert fetched == [1, 2]
    assert crawl_state.update_window(source, "ostermalm", OVERLAP, 1) == (INITIAL, None)


@pytest.mark.parametrize("instant", ["2026-03-28T23:01:00+00:00", "2026-03-29T01:01:00+00:00",
                                      "2026-10-24T22:01:00+00:00", "2026-10-25T23:01:00+00:00"])
def test_stockholm_midnight_and_dst_epoch_fallbacks(monkeypatch, instant):
    now = datetime.fromisoformat(instant)
    local = now.astimezone(ZoneInfo("Europe/Stockholm")).date()

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz)
    monkeypatch.setattr(dates, "datetime", Clock)
    assert dates.stockholm_today() == local
    for source, module in (("hemnet", hemnet), ("booli", booli)):
        for offset in (-1, 0, 1):
            day = local + timedelta(days=offset)
            raw = card(source, "edge", day)
            if source == "booli":
                raw["soldDate"] = datetime.combine(day, time(), ZoneInfo("Europe/Stockholm")).timestamp()
            parsed = module._to_row(raw, "ostermalm")
            assert (parsed is None) == (offset == 1)
            if parsed:
                assert parsed["soldAt"] == day


def test_valid_watermark_survives_poison_and_older_success(db, monkeypatch, frozen):
    finish(INITIAL, PRIOR)
    finish(INITIAL, FUTURE)
    finish(FUTURE, TODAY)  # invalid since cannot make this claim trustworthy
    finish(INITIAL, status="partial")
    finish(INITIAL, TODAY, source="booli")
    finish(INITIAL, TODAY, district="vasastan")
    finish(INITIAL, kind="backfill")
    assert crawl_state.complete_through("hemnet", "ostermalm") == PRIOR

    async def older(district, since, **kwargs):
        yield _row("hemnet", "invalid", district, FUTURE)
        yield _row("hemnet", "older", district, PRIOR - timedelta(days=1))
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", older)
    assert run._refresh("hemnet", "ostermalm", OVERLAP, 1).error is None
    assert crawl_state.complete_through("hemnet", "ostermalm") == PRIOR

```
