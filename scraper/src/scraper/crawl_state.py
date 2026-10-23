"""Per source/district "complete through" dates for `scraper update` (B39).

`update` used to start from MAX(soldAt) - 7 days. Source pages are newest-first,
so a crawl that fails part-way still upserts the newest rows, pushes MAX(soldAt)
forward, and the failed tail is never refetched. Instead `update` records, after
each crawl that *finished*, the newest sale date that crawl itself yielded (never
the DB max, which a partial run may have pushed past a gap); the next cutoff is
derived from that date. Partial and failed crawls leave it untouched, so the next
run starts from the same cutoff and retries the gap.

The state is a small JSON file next to the Playwright storageState
(`scraper/.state/crawl_state.json`; it honours SCRAPER_STORAGE_STATE, so tests
use their temp dir). Only `update` writes it: a manual `scrape --since` can start
anywhere and must not claim contiguous coverage. Writes are atomic (a unique temp
file in the same directory, then os.replace). An unreadable file is never
overwritten: a warning names it and `update` falls back to MAX(soldAt) until a
human fixes or deletes it. A ScrapeRun table (B18/B19) is the proper long-term home.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import date
from pathlib import Path

from .config import load_config

log = logging.getLogger("scraper.crawl_state")


class CorruptCrawlState(Exception):
    """The state file exists but can't be parsed; it is left untouched."""


def state_path() -> Path:
    return load_config().storage_state_path.parent / "crawl_state.json"


def _key(source: str, district: str) -> str:
    return f"{source}/{district}"


def _read() -> dict:
    """The parsed state; {} when there is no file. Raises CorruptCrawlState."""
    path = state_path()
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    except OSError as e:
        raise CorruptCrawlState(f"{path} is unreadable: {e}") from e
    try:
        data = json.loads(raw)
    except ValueError as e:
        raise CorruptCrawlState(f"{path} is not valid JSON ({e})") from e
    if not isinstance(data, dict):
        raise CorruptCrawlState(f"{path} does not contain a JSON object")
    return data


def complete_through(source: str, district: str) -> date | None:
    """Newest sale date held after the last finished `update` crawl, if recorded.

    An unreadable file warns (naming it) and counts as "nothing recorded".
    """
    try:
        value = _read().get(_key(source, district))
    except CorruptCrawlState as e:
        log.warning("ignoring crawl state, %s; falling back to MAX(soldAt)", e)
        return None
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def _write(state: dict) -> None:
    """Atomically replace the state file (unique temp file in the same directory)."""
    path = state_path()
    fd, tmp = tempfile.mkstemp(prefix="crawl_state.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(state, indent=2, sort_keys=True) + "\n")
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def record_complete(source: str, district: str, through: date) -> None:
    """Persist `through` for a crawl that finished (atomic replace).

    Other keys are preserved as they are. Raises CorruptCrawlState (writing
    nothing) if the existing file can't be parsed.
    """
    state = _read()
    state[_key(source, district)] = through.isoformat()
    _write(state)


# --- backfill resume points (B19) -------------------------------------------
# A deep backfill can span hundreds of result pages; if it stops, the next
# `backfill --resume` continues at `next_page` instead of page 1. Stored under
# "backfill/<source>/<district>" in the same file, never touching the update
# cutoffs above (a backfill must not claim coverage for `update`).


def _backfill_key(source: str, district: str) -> str:
    return f"backfill/{source}/{district}"


def backfill_progress(source: str, district: str) -> dict | None:
    """{"since": date, "next_page": int, "oldest_sold_at": date | None}, or None.

    Raises CorruptCrawlState if the file can't be parsed.
    """
    raw = _read().get(_backfill_key(source, district))
    if not isinstance(raw, dict):
        return None
    try:
        oldest = raw.get("oldest_sold_at")
        return {
            "since": date.fromisoformat(raw["since"]),
            "next_page": int(raw["next_page"]),
            "oldest_sold_at": date.fromisoformat(oldest) if oldest else None,
        }
    except (KeyError, TypeError, ValueError):
        return None


def save_backfill_progress(
    source: str, district: str, *, since: date, next_page: int, oldest_sold_at: date | None
) -> None:
    state = _read()
    state[_backfill_key(source, district)] = {
        "since": since.isoformat(),
        "next_page": next_page,
        "oldest_sold_at": oldest_sold_at.isoformat() if oldest_sold_at else None,
    }
    _write(state)


def clear_backfill_progress(source: str, district: str) -> None:
    state = _read()
    if state.pop(_backfill_key(source, district), None) is not None:
        _write(state)
