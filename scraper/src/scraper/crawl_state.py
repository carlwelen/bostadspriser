"""Per source/district "complete through" dates for `scraper update` (B39).

`update` used to start from MAX(soldAt) - 7 days. Source pages are newest-first,
so a crawl that fails part-way still upserts the newest rows, pushes MAX(soldAt)
forward, and the failed tail is never refetched. Instead `update` records, after
each crawl that *finished*, the newest sale date it holds for that source and
district; the next cutoff is derived from that date. Partial and failed crawls
leave it untouched, so the next run starts from the same cutoff and retries the gap.

The state is a small JSON file next to the Playwright storageState
(`scraper/.state/crawl_state.json`; it honours SCRAPER_STORAGE_STATE, so tests
use their temp dir). Only `update` writes it: a manual `scrape --since` can start
anywhere and must not claim contiguous coverage. A ScrapeRun table (B18/B19) is
the proper long-term home; this file bridges until then and is safe to delete
(`update` then falls back to the DB's MAX(soldAt) once).
"""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

from .config import load_config


def state_path() -> Path:
    return load_config().storage_state_path.parent / "crawl_state.json"


def _key(source: str, district: str) -> str:
    return f"{source}/{district}"


def _load() -> dict[str, str]:
    try:
        data = json.loads(state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def complete_through(source: str, district: str) -> date | None:
    """Newest sale date held after the last finished `update` crawl, if recorded."""
    value = _load().get(_key(source, district))
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def record_complete(source: str, district: str, through: date) -> None:
    """Persist `through` for a crawl that finished (atomic replace)."""
    state = {k: v for k, v in _load().items() if isinstance(v, str)}
    state[_key(source, district)] = through.isoformat()
    path = state_path()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)
