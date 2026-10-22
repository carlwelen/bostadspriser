"""Pure-function tests for the Hemnet field parsers.

These are the parsers the live scraper depends on. Hemnet ships values like
"4 900 000 kr" or "2,5 rum" — comma decimals, non-breaking spaces, the works.
"""

from __future__ import annotations

import pytest

from scraper.normalize import (
    normalize_district,
    parse_rooms,
    parse_sek,
    parse_sqm,
)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("4 900 000 kr", 4_900_000),
        ("4 900 000 kr", 4_900_000),  # non-breaking spaces
        ("140 000 kr/m²", 140_000),
        ("0 kr", 0),
        ("Pris på förfrågan", None),
        (None, None),
        ("", None),
    ],
)
def test_parse_sek(raw: str | None, expected: int | None) -> None:
    assert parse_sek(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("35 m²", 35.0),
        ("79,5 m²", 79.5),
        ("79.5 m²", 79.5),
        ("12 m²", 12.0),
        (None, None),
        ("", None),
    ],
)
def test_parse_sqm(raw: str | None, expected: float | None) -> None:
    assert parse_sqm(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1 rum", 1.0),
        ("2,5 rum", 2.5),
        ("4 rum", 4.0),
        (None, None),
    ],
)
def test_parse_rooms(raw: str | None, expected: float | None) -> None:
    assert parse_rooms(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Östermalm", "ostermalm"),
        ("östermalm", "ostermalm"),
        ("ostermalm", "ostermalm"),
        ("VASASTAN", "vasastan"),
        ("Södermalm", "sodermalm"),
        ("Solna", None),
    ],
)
def test_normalize_district(raw: str, expected: str | None) -> None:
    assert normalize_district(raw) == expected
