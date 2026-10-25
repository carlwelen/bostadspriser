"""`scraper update` result tracking and exit code. No browser, network or DB:
the source iterators, the cutoff lookup and the upsert are all monkeypatched."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from click.testing import CliRunner

from scraper import crawl_state, run, scrape_run
from scraper.errors import CrawlIncomplete


@pytest.fixture()
def fake_world(monkeypatch):
    """Hemnet works (2 rows); Booli/vasastan blows up after 1 row; other Booli ok."""
    upserted: list[dict] = []
    since_seen: dict[tuple[str, str], date] = {}

    def make_iter(source: str):
        async def iter_district(district: str, since: date, **kw):
            since_seen[(source, district)] = since
            yield {"source": source, "district": district, "n": 1}
            if source == "booli" and district == "vasastan":
                raise RuntimeError("Cloudflare challenge did not resolve\nsecond line")
            yield {"source": source, "district": district, "n": 2}

        return iter_district

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", make_iter("hemnet"))
    monkeypatch.setitem(run._SOURCE_ITER, "booli", make_iter("booli"))
    monkeypatch.setattr(run, "upsert_listings", lambda rows, **kw: (upserted.extend(rows), len(rows))[1])
    monkeypatch.setattr(
        run, "latest_sold_at", lambda source, district: date(2026, 5, 10) if source == "hemnet" else None
    )
    latest = scrape_run.latest_run

    def seeded_watermark(source, district, *, kind, watermark=False, not_after=None):
        row = latest(source, district, kind=kind, watermark=watermark, not_after=not_after)
        if row is None and source == "hemnet" and kind == "update" and watermark:
            return {"completeThrough": date(2026, 5, 10)}
        return row

    monkeypatch.setattr(scrape_run, "latest_run", seeded_watermark)
    yield upserted, since_seen


def test_update_exits_nonzero_and_prints_summary_when_any_combination_fails(fake_world) -> None:
    upserted, since_seen = fake_world
    result = CliRunner().invoke(
        run.cli,
        ["update", "--source", "hemnet", "--source", "booli",
         "--district", "ostermalm", "--district", "vasastan", "--lookback-days", "14"],
    )
    assert result.exit_code == 1, result.output

    # Every combination ran: the failure did not stop the others.
    assert set(since_seen) == {
        ("hemnet", "ostermalm"), ("hemnet", "vasastan"),
        ("booli", "ostermalm"), ("booli", "vasastan"),
    }
    # Partial progress of the failing combination is still stored (1 row + 2 + 2 + 2).
    assert len(upserted) == 7
    # since = MAX(soldAt) - 7 d for hemnet; lookback floor for booli (nothing stored).
    assert since_seen[("hemnet", "ostermalm")] == date(2026, 5, 3)
    assert since_seen[("booli", "ostermalm")] == date.today() - timedelta(days=14)

    out = result.output
    header = next(line for line in out.splitlines() if line.startswith("source"))
    assert header.split() == ["source", "district", "since", "upserted", "status", "error"]
    rows = {tuple(line.split()[:2]): line for line in out.splitlines() if line.startswith(("hemnet ", "booli "))}
    assert "2026-05-03" in rows[("hemnet", "ostermalm")]
    assert " ok" in rows[("hemnet", "ostermalm")]
    failed = rows[("booli", "vasastan")]
    assert "FAILED" in failed
    assert "Cloudflare challenge did not resolve" in failed
    assert "resolve second line" in failed  # multi-line errors are flattened onto one row
    assert " 1 " in failed  # rows upserted before the failure
    assert "1 of 4 failed" in out


def test_update_exits_zero_when_everything_succeeds(fake_world) -> None:
    result = CliRunner().invoke(
        run.cli, ["update", "--source", "hemnet", "--district", "ostermalm", "--district", "vasastan"]
    )
    assert result.exit_code == 0, result.output
    assert "FAILED" not in result.output
    assert "2 of 2 ok" in result.output


def test_update_counts_a_failing_cutoff_lookup_as_a_failure(fake_world, monkeypatch) -> None:
    def boom(*args, **kwargs):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(crawl_state, "update_window", boom)
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    assert result.exit_code == 1
    assert "connection refused" in result.output
    assert "FAILED" in result.output


def test_update_marks_an_incomplete_crawl_partial_keeps_rows_and_exits_nonzero(
    fake_world, monkeypatch
) -> None:
    upserted, _ = fake_world

    async def truncated(district: str, since: date, **kw):
        yield {"source": "booli", "district": district, "n": 1}
        yield {"source": "booli", "district": district, "n": 2}
        raise CrawlIncomplete(f"booli {district} page 3 failed: RuntimeError: challenge")

    monkeypatch.setitem(run._SOURCE_ITER, "booli", truncated)
    result = CliRunner().invoke(
        run.cli,
        ["update", "--source", "hemnet", "--source", "booli", "--district", "ostermalm"],
    )
    assert result.exit_code == 1, result.output
    assert len(upserted) == 2 + 2  # hemnet's rows, plus the partial booli rows are kept
    booli_line = next(ln for ln in result.output.splitlines() if ln.startswith("booli "))
    assert "partial" in booli_line and "FAILED" not in booli_line
    assert " 2 " in booli_line and "page 3 failed" in booli_line
    hemnet_line = next(ln for ln in result.output.splitlines() if ln.startswith("hemnet "))
    assert " ok" in hemnet_line
    assert "1 of 2 partial" in result.output
    assert "failed" not in result.output.lower().replace("page 3 failed", "")


def test_update_reports_failed_not_partial_when_an_incomplete_crawl_yielded_nothing(
    fake_world, monkeypatch
) -> None:
    """A page-1 block is a failure, not 'partial': nothing was fetched."""
    upserted, _ = fake_world

    async def blocked(district: str, since: date, **kw):
        raise CrawlIncomplete(f"booli {district} page 1 failed: RuntimeError: challenge")
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setitem(run._SOURCE_ITER, "booli", blocked)
    result = CliRunner().invoke(run.cli, ["update", "--source", "booli", "--district", "ostermalm"])
    assert result.exit_code == 1, result.output
    assert upserted == []
    line = next(ln for ln in result.output.splitlines() if ln.startswith("booli "))
    assert "FAILED" in line and "partial" not in line
    assert "1 of 1 failed" in result.output
    assert "partial" not in result.output


def test_scrape_command_exits_nonzero_on_an_incomplete_crawl(fake_world, monkeypatch) -> None:
    upserted, _ = fake_world

    async def truncated(district: str, since: date, **kw):
        yield {"source": "hemnet", "district": district, "n": 1}
        raise CrawlIncomplete("hemnet ostermalm page 2 failed")

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", truncated)
    result = CliRunner().invoke(
        run.cli, ["scrape", "--district", "ostermalm", "--since", "2026-05-01", "--source", "hemnet"]
    )
    assert result.exit_code == 1, result.output
    assert len(upserted) == 1
    assert "upserted 1" in result.output and "incomplete" in result.output


# ---------------------------------------------------------------------------
# ScrapeRun recording (B18) and --max-pages / --log-level
# ---------------------------------------------------------------------------


def _progress_iter(*, rows: int, pages: int, rejected: int, oldest: date, error: Exception | None = None):
    """An iterator that fills in the CrawlProgress it is handed, like source_base.crawl."""

    async def it(district: str, since: date, *, progress=None, max_pages=None, start_page=1, **kw):
        it.calls.append({"district": district, "since": since, "max_pages": max_pages, "start_page": start_page})
        for i in range(rows):
            yield {"source": "x", "district": district, "n": i}
        progress.pages, progress.rejected, progress.oldest_sold_at = pages, rejected, oldest
        progress.last_completed_page = pages
        if error:
            raise error

    it.calls = []
    return it


def test_update_records_one_scrape_run_per_combination(fake_world, scrape_runs, monkeypatch) -> None:
    it = _progress_iter(rows=3, pages=2, rejected=1, oldest=date(2026, 5, 2))
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", it)
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm", "--district", "vasastan"])
    assert result.exit_code == 0, result.output
    assert [(r["source"], r["district"], r["status"]) for r in scrape_runs.runs] == [
        ("hemnet", "ostermalm", "ok"), ("hemnet", "vasastan", "ok"),
    ]
    first = scrape_runs.runs[0]
    assert (first["pages"], first["rows_upserted"], first["rows_rejected"]) == (2, 3, 1)
    assert first["oldest_sold_at"] == date(2026, 5, 2) and first["error"] is None


def test_update_records_partial_and_failed_runs_with_the_error(fake_world, scrape_runs, monkeypatch) -> None:
    partial = _progress_iter(rows=2, pages=3, rejected=0, oldest=date(2026, 5, 4), error=CrawlIncomplete("page 4 failed"))
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", partial)
    boom = _progress_iter(rows=0, pages=0, rejected=0, oldest=date(2026, 5, 4), error=RuntimeError("boom"))
    monkeypatch.setitem(run._SOURCE_ITER, "booli", boom)
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--source", "booli", "--district", "ostermalm"])
    assert result.exit_code == 1
    by_source = {r["source"]: r for r in scrape_runs.runs}
    assert by_source["hemnet"]["status"] == "partial" and "page 4 failed" in by_source["hemnet"]["error"]
    assert by_source["hemnet"]["rows_upserted"] == 2 and by_source["hemnet"]["pages"] == 3
    assert by_source["booli"]["status"] == "failed" and "boom" in by_source["booli"]["error"]


def test_update_records_a_failed_run_when_the_cutoff_lookup_fails(fake_world, scrape_runs, monkeypatch) -> None:
    def boom(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(crawl_state, "update_window", boom)
    CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    assert scrape_runs.runs == []  # no run starts before its durable cutoff is known


def test_update_passes_max_pages_to_the_crawl(fake_world, monkeypatch) -> None:
    from scraper import source_base

    it = _progress_iter(rows=0, pages=0, rejected=0, oldest=date(2026, 5, 2))
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", it)
    CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm", "--max-pages", "7"])
    assert [c["max_pages"] for c in it.calls] == [source_base.MAX_PAGES, 7]
    assert all(c["start_page"] == 1 for c in it.calls)


def test_log_level_option_configures_the_scraper_logger(fake_world) -> None:
    import logging

    logger = logging.getLogger("scraper")
    before = logger.level
    try:
        assert CliRunner().invoke(run.cli, ["--log-level", "debug", "stats"]).exit_code in (0, 1)
        assert logger.level == logging.DEBUG
        assert CliRunner().invoke(run.cli, ["--log-level", "warning", "stats"]).exit_code in (0, 1)
        assert logger.level == logging.WARNING
        bad = CliRunner().invoke(run.cli, ["--log-level", "loud", "stats"])
        assert bad.exit_code == 2 and "loud" in bad.output
    finally:
        logger.setLevel(before)


def test_update_relabels_pending_rows_with_coordinates_at_the_end(fake_world, monkeypatch) -> None:
    """Rows must not stay `pending` while carrying coordinates just because cron never runs geocode."""
    calls: list[str] = []
    monkeypatch.setattr(run, "mark_inline_pending", lambda: calls.append("relabel") or 3)
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    assert result.exit_code == 0, result.output
    assert calls == ["relabel"]


def test_a_failing_relabel_does_not_change_the_update_exit_code(fake_world, monkeypatch) -> None:
    def boom():
        raise RuntimeError("db hiccup")

    monkeypatch.setattr(run, "mark_inline_pending", boom)
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    assert result.exit_code == 0, result.output
    assert "db hiccup" in result.output


def test_update_oldest_sold_at_follows_committed_rows_not_yielded_ones(fake_world, scrape_runs, monkeypatch) -> None:
    """Update-command twin of the backfill probe: one row per page, the second batch fails
    to commit; the ScrapeRun row must only claim what the committed batch reached."""
    from datetime import timedelta

    async def it(district, since, *, progress=None, max_pages=None, start_page=1, **kw):
        for page in range(start_page, 251):
            yield {"source": "hemnet", "district": district, "soldAt": date(2026, 6, 1), "page": page}
            progress.pages += 1
            progress.last_completed_page = page
            progress.oldest_sold_at = date(2026, 6, 1) - timedelta(days=page)

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", it)
    calls = {"n": 0}

    def flaky(rows, **kw):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("db down")
        return len(rows)

    monkeypatch.setattr(run, "upsert_listings", flaky)
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    assert result.exit_code == 1, result.output
    (r,) = scrape_runs.runs
    assert r["status"] == "failed" and r["rows_upserted"] == 100  # a database error is a hard failure
    # At the first (committed) flush the crawl had reached page 99's date, not page 200's.
    assert r["oldest_sold_at"] == date(2026, 6, 1) - timedelta(days=99)
