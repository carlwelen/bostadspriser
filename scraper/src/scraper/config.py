from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
load_dotenv(Path(__file__).resolve().parents[3] / ".env")


@dataclass(frozen=True)
class Config:
    database_url: str
    mapbox_token: str
    cache_dir: Path
    storage_state_path: Path
    min_delay_ms: int
    max_delay_ms: int


def load_config() -> Config:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set")
    mapbox_token = os.environ.get("MAPBOX_TOKEN", "")

    # Resolve relative paths against the scraper package root so the same .env
    # works whether you invoke from the project root or from scraper/.
    scraper_root = Path(__file__).resolve().parents[2]

    def _resolve(env_value: str | None, default: str) -> Path:
        raw = env_value or default
        p = Path(raw)
        if not p.is_absolute():
            # Strip a leading "./scraper/" since that's redundant when we
            # already anchor to the scraper directory.
            stripped = raw.removeprefix("./scraper/").removeprefix("scraper/")
            p = scraper_root / stripped
        return p

    cache_dir = _resolve(os.environ.get("SCRAPER_CACHE_DIR"), ".cache")
    storage_state = _resolve(
        os.environ.get("SCRAPER_STORAGE_STATE"), ".state/storageState.json"
    )
    cache_dir.mkdir(parents=True, exist_ok=True)
    storage_state.parent.mkdir(parents=True, exist_ok=True)

    return Config(
        database_url=database_url,
        mapbox_token=mapbox_token,
        cache_dir=cache_dir,
        storage_state_path=storage_state,
        min_delay_ms=int(os.environ.get("SCRAPER_MIN_DELAY_MS", "3000")),
        max_delay_ms=int(os.environ.get("SCRAPER_MAX_DELAY_MS", "5000")),
    )
