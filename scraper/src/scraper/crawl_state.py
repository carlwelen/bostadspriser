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
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

from .config import load_config


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
        print(f"warning: ignoring crawl state, {e}; falling back to MAX(soldAt)", file=sys.stderr)
        return None
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def record_complete(source: str, district: str, through: date) -> None:
    """Persist `through` for a crawl that finished (atomic replace).

    Other keys are preserved as they are. Raises CorruptCrawlState (writing
    nothing) if the existing file can't be parsed.
    """
    state = _read()
    state[_key(source, district)] = through.isoformat()
    path = state_path()
    fd, tmp = tempfile.mkstemp(prefix="crawl_state.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(state, indent=2, sort_keys=True) + "\n")
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
