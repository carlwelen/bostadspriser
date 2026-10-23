"""`scraper backfill --source --district --since [--resume] [--max-pages]` (B19/B44).

A deep backfill (Södermalm ~1.5 years is ~170 pages) can't fit the default page cap
and used to restart at page 1 on every re-run. The command raises the cap (an explicit
BACKFILL_MAX_PAGES), records how far it got, and `--resume` continues from there.
No network, browser or DB: the iterators and the upsert are fakes; run bookkeeping
goes to conftest's in-memory ScrapeRun recorder; the progress file is in the temp dir.
"""

from __future__ import annotations

import json
from datetime import date

import pytest
from click.testing import CliRunner

from scraper import crawl_state, run
from scraper.errors import CrawlIncomplete

SINCE = "2026-01-01"
BASE = ["backfill", "--source", "hemnet", "--district", "ostermalm", "--since", SINCE]


class Crawler:
    """A fake source: `fail_at` is the page that fails (None: the crawl completes)."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.fail_at: int | None = None
        self.exc_type = CrawlIncomplete
        self.pages_total = 6
        self.upserted: list[dict] = []

    def iterator(self):
        async def it(district, since, *, progress=None, max_pages=None, start_page=1, **kw):
            self.calls.append({"since": since, "start_page": start_page, "max_pages": max_pages})
            for page in range(start_page, self.pages_total + 1):
                if page == self.fail_at:
                    raise self.exc_type(f"hemnet {district} page {page} failed")
                yield {"source": "hemnet", "district": district, "soldAt": date(2026, 6, 1), "page": page}
                progress.pages += 1
                progress.last_completed_page = page
                progress.oldest_sold_at = date(2026, 6, 10 - page)

        return it


@pytest.fixture()
def crawler(monkeypatch):
    c = Crawler()
    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", c.iterator())
    monkeypatch.setattr(run, "upsert_listings", lambda rows, **kw: (c.upserted.extend(rows), len(rows))[1])
    crawl_state.state_path().unlink(missing_ok=True)
    yield c
    crawl_state.state_path().unlink(missing_ok=True)


def _state() -> dict:
    return json.loads(crawl_state.state_path().read_text())


def test_fresh_backfill_uses_the_explicit_high_page_cap(crawler, scrape_runs) -> None:
    result = CliRunner().invoke(run.cli, BASE)
    assert result.exit_code == 0, result.output
    assert crawler.calls == [{"since": date(2026, 1, 1), "start_page": 1, "max_pages": run.BACKFILL_MAX_PAGES}]
    assert run.BACKFILL_MAX_PAGES > 150 * 3  # far beyond the update cap (a 1.5-year Södermalm is ~170 pages)
    assert len(crawler.upserted) == 6
    (r,) = scrape_runs.runs
    assert (r["source"], r["district"], r["status"], r["rows_upserted"], r["pages"]) == ("hemnet", "ostermalm", "ok", 6, 6)
    assert not crawl_state.state_path().exists()  # nothing to resume


def test_max_pages_option_overrides_the_backfill_cap(crawler) -> None:
    CliRunner().invoke(run.cli, [*BASE, "--max-pages", "40"])
    assert crawler.calls[0]["max_pages"] == 40


def test_a_failed_backfill_records_where_to_resume(crawler, scrape_runs) -> None:
    crawler.fail_at = 4
    result = CliRunner().invoke(run.cli, BASE)
    assert result.exit_code == 1, result.output
    assert _state()["backfill/hemnet/ostermalm"] == {
        "since": SINCE, "next_page": 4, "oldest_sold_at": "2026-06-07",
    }
    (r,) = scrape_runs.runs
    assert r["status"] == "partial" and r["rows_upserted"] == 3 and "page 4 failed" in r["error"]
    assert "--resume" in result.output  # tells the operator how to continue


def test_hard_errors_are_resumable_too(crawler, scrape_runs) -> None:
    crawler.fail_at, crawler.exc_type = 3, RuntimeError
    result = CliRunner().invoke(run.cli, BASE)
    assert result.exit_code == 1
    assert _state()["backfill/hemnet/ostermalm"]["next_page"] == 3
    assert scrape_runs.runs[0]["status"] == "partial"


def test_resume_continues_from_the_recorded_page_and_clears_it_on_success(crawler, scrape_runs) -> None:
    crawler.fail_at = 4
    CliRunner().invoke(run.cli, BASE)
    crawler.fail_at = None
    result = CliRunner().invoke(run.cli, [*BASE, "--resume"])
    assert result.exit_code == 0, result.output
    assert [c["start_page"] for c in crawler.calls] == [1, 4]
    assert [r["page"] for r in crawler.upserted] == [1, 2, 3, 4, 5, 6]  # pages 1-3 once, then 4-6
    assert "backfill/hemnet/ostermalm" not in (_state() if crawl_state.state_path().exists() else {})
    assert [r["status"] for r in scrape_runs.runs] == ["partial", "ok"]


def test_resume_can_fail_again_further_on(crawler) -> None:
    crawler.fail_at = 3
    CliRunner().invoke(run.cli, BASE)
    crawler.fail_at = 5
    CliRunner().invoke(run.cli, [*BASE, "--resume"])
    assert _state()["backfill/hemnet/ostermalm"]["next_page"] == 5
    crawler.fail_at = 5  # fails immediately on the first page of the resumed run
    CliRunner().invoke(run.cli, [*BASE, "--resume"])
    assert _state()["backfill/hemnet/ostermalm"]["next_page"] == 5  # no progress made, same resume point


def test_resume_without_progress_or_with_another_since_starts_at_page_one(crawler) -> None:
    out = CliRunner().invoke(run.cli, [*BASE, "--resume"]).output
    assert crawler.calls[-1]["start_page"] == 1 and "no recorded progress" in out
    crawler.fail_at = 4
    CliRunner().invoke(run.cli, BASE)
    crawler.fail_at = None
    other = ["backfill", "--source", "hemnet", "--district", "ostermalm", "--since", "2025-06-01", "--resume"]
    out = CliRunner().invoke(run.cli, other).output
    assert crawler.calls[-1]["start_page"] == 1 and "different --since" in out


def test_without_resume_a_saved_position_is_ignored(crawler) -> None:
    crawler.fail_at = 4
    CliRunner().invoke(run.cli, BASE)
    crawler.fail_at = None
    CliRunner().invoke(run.cli, BASE)
    assert crawler.calls[-1]["start_page"] == 1


def test_progress_is_per_source_and_district(crawler, monkeypatch) -> None:
    crawler.fail_at = 4
    CliRunner().invoke(run.cli, BASE)
    CliRunner().invoke(run.cli, ["backfill", "--source", "hemnet", "--district", "vasastan", "--since", SINCE, "--resume"])
    assert crawler.calls[-1]["start_page"] == 1  # vasastan has no progress of its own


def test_backfill_does_not_touch_the_update_cutoff(crawler) -> None:
    crawl_state.record_complete("hemnet", "ostermalm", date(2026, 5, 10))
    CliRunner().invoke(run.cli, BASE)
    assert crawl_state.complete_through("hemnet", "ostermalm") == date(2026, 5, 10)
    crawler.fail_at = 4
    CliRunner().invoke(run.cli, BASE)
    assert crawl_state.complete_through("hemnet", "ostermalm") == date(2026, 5, 10)


def test_corrupt_progress_file_warns_starts_over_and_is_not_overwritten(crawler) -> None:
    crawl_state.state_path().write_text("not json")
    result = CliRunner().invoke(run.cli, [*BASE, "--resume"])
    assert result.exit_code == 0
    assert crawler.calls[-1]["start_page"] == 1
    assert str(crawl_state.state_path()) in result.output
    assert crawl_state.state_path().read_text() == "not json"
    crawler.fail_at = 4
    result = CliRunner().invoke(run.cli, BASE)
    assert result.exit_code == 1 and str(crawl_state.state_path()) in result.output  # progress not saved
    assert crawl_state.state_path().read_text() == "not json"


def test_a_backfill_that_made_no_progress_is_a_plain_failure(crawler, scrape_runs) -> None:
    crawler.fail_at = 1
    result = CliRunner().invoke(run.cli, BASE)
    assert result.exit_code == 1
    assert scrape_runs.runs[0]["status"] == "failed" and scrape_runs.runs[0]["rows_upserted"] == 0
    assert _state()["backfill/hemnet/ostermalm"]["next_page"] == 1


def test_scrape_command_records_a_run_too(crawler, scrape_runs) -> None:
    result = CliRunner().invoke(run.cli, ["scrape", "--district", "ostermalm", "--since", SINCE])
    assert result.exit_code == 0, result.output
    assert crawler.calls[0]["max_pages"] == run.MAX_PAGES
    assert [(r["status"], r["rows_upserted"]) for r in scrape_runs.runs] == [("ok", 6)]
    crawler.fail_at = 3
    CliRunner().invoke(run.cli, ["scrape", "--district", "ostermalm", "--since", SINCE])
    assert scrape_runs.runs[1]["status"] == "partial"
