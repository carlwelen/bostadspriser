"""Durable crawl state in ScrapeRun (B45), never imported from protected JSON.

Legacy Listing maxima cannot prove contiguous coverage. A cold update bootstraps
only --lookback-days, persisting that initial window before fetching, and retries
it until a successful nonempty update establishes a watermark. Older history
requires an explicit backfill. Read/write failures propagate to the command.
"""
from __future__ import annotations

from datetime import date, timedelta

from . import scrape_run
from .dates import stockholm_today


def complete_through(source: str, district: str) -> date | None:
    row = scrape_run.latest_run(source, district, kind="update", watermark=True, not_after=stockholm_today())
    return row["completeThrough"] if row else None


def update_window(source: str, district: str, overlap: timedelta, lookback_days: int) -> tuple[date, date | None]:
    through = complete_through(source, district)
    if through is not None:
        return through - overlap, through
    latest = scrape_run.latest_run(source, district, kind="update", not_after=stockholm_today())
    since = latest["since"] if latest else None
    return since or stockholm_today() - timedelta(days=lookback_days), None


def backfill_progress(source: str, district: str) -> dict | None:
    row = scrape_run.latest_run(source, district, kind="backfill")
    if not row or row["status"] == "ok" or row["since"] is None:
        return None
    return {"since": row["since"], "next_page": row["lastPage"] + 1,
            "oldest_sold_at": row["oldestSoldAt"]}
