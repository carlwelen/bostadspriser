"""`scraper update` result tracking and exit code. No browser, network or DB:
the source iterators, the cutoff lookup and the upsert are all monkeypatched."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from click.testing import CliRunner

from scraper import run


@pytest.fixture()
def fake_world(monkeypatch):
    """Hemnet works (2 rows); Booli/vasastan blows up after 1 row; other Booli ok."""
    upserted: list[dict] = []
    since_seen: dict[tuple[str, str], date] = {}

    def make_iter(source: str):
        async def iter_district(district: str, since: date):
            since_seen[(source, district)] = since
            yield {"source": source, "district": district, "n": 1}
            if source == "booli" and district == "vasastan":
                raise RuntimeError("Cloudflare challenge did not resolve\nsecond line")
            yield {"source": source, "district": district, "n": 2}

        return iter_district

    monkeypatch.setitem(run._SOURCE_ITER, "hemnet", make_iter("hemnet"))
    monkeypatch.setitem(run._SOURCE_ITER, "booli", make_iter("booli"))
    monkeypatch.setattr(run, "upsert_listing", upserted.append)
    monkeypatch.setattr(
        run, "latest_sold_at", lambda source, district: date(2026, 5, 10) if source == "hemnet" else None
    )
    return upserted, since_seen


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
    def boom(source: str, district: str):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(run, "latest_sold_at", boom)
    result = CliRunner().invoke(run.cli, ["update", "--source", "hemnet", "--district", "ostermalm"])
    assert result.exit_code == 1
    assert "connection refused" in result.output
    assert "FAILED" in result.output
