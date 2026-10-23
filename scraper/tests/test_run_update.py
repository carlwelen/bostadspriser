"""DB tests for the `update` since-cutoff lookup (uses the `db` fixture)."""

from __future__ import annotations

import uuid
from datetime import date

from click.testing import CliRunner

from scraper.db import upsert_listing
from scraper.normalize import dedup_key
from scraper.run import cli, latest_sold_at


def _row(source: str, source_id: str, district: str, sold_at: date) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "source": source,
        "sourceId": source_id,
        "street": "Brahegatan",
        "houseNumber": "3A",
        "district": district,
        "rooms": 1.0,
        "areaSqm": 35.0,
        "priceSek": 4_900_000,
        "pricePerSqmSek": 140_000,
        "soldAt": sold_at,
        "lat": None,
        "lng": None,
        "geocodedAt": None,
        "raw": {"fixture": True},
        "dedupKey": dedup_key("Brahegatan", "3A", sold_at, 4_900_000),
    }


def test_latest_sold_at_is_none_when_empty(db) -> None:
    assert latest_sold_at("hemnet", "ostermalm") is None


def test_latest_sold_at_is_scoped_to_source_and_district(db) -> None:
    upsert_listing(_row("hemnet", "1", "ostermalm", date(2026, 5, 2)))
    upsert_listing(_row("hemnet", "2", "ostermalm", date(2026, 4, 1)))
    upsert_listing(_row("hemnet", "3", "vasastan", date(2026, 6, 1)))
    upsert_listing(_row("booli", "4", "ostermalm", date(2026, 7, 1)))
    assert latest_sold_at("hemnet", "ostermalm") == date(2026, 5, 2)
    assert latest_sold_at("hemnet", "vasastan") == date(2026, 6, 1)
    assert latest_sold_at("booli", "ostermalm") == date(2026, 7, 1)
    assert latest_sold_at("booli", "sodermalm") is None


def test_stats_command_runs_against_real_postgres(db) -> None:
    """`stats` also uses text() SQL with `::` casts; guard it against bind-parsing surprises."""
    upsert_listing(_row("hemnet", "1", "ostermalm", date(2026, 5, 2)))
    result = CliRunner().invoke(cli, ["stats"])
    assert result.exit_code == 0, result.output
    assert "ostermalm" in result.output
    assert "140,000" in result.output
