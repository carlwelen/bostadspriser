"""Tests for the dedup key. Stability and cross-source matching are critical:
if Hemnet and Booli both list the same physical sale and produce different
keys, every aggregation will double-count it.
"""

from __future__ import annotations

from datetime import date

from scraper.normalize import dedup_key, normalize_address


def test_normalize_address_collapses_spaces_and_case() -> None:
    assert normalize_address("Brahegatan", "3A") == normalize_address("brahegatan", "3 a")
    assert normalize_address("Brahegatan", "3A") == normalize_address("BRAHEGATAN", "3a")


def test_normalize_address_folds_swedish_diacritics() -> None:
    assert normalize_address("Östermalmsgatan", "1") == normalize_address("Ostermalmsgatan", "1")
    assert normalize_address("Sankt Eriksgatan", None) == normalize_address("sankt eriksgatan", "")


def test_dedup_key_is_deterministic() -> None:
    a = dedup_key("Brahegatan", "3A", date(2026, 5, 1), 4_900_000)
    b = dedup_key("Brahegatan", "3A", date(2026, 5, 1), 4_900_000)
    assert a == b
    assert len(a) == 16


def test_dedup_key_matches_across_address_variants() -> None:
    """Hemnet and Booli for the same sale must produce the same key."""
    hemnet_view = dedup_key("Brahegatan", "3A", date(2026, 5, 1), 4_900_000)
    booli_view = dedup_key("brahegatan", "3 a", date(2026, 5, 1), 4_900_000)
    assert hemnet_view == booli_view


def test_dedup_key_differs_on_different_sales() -> None:
    base = dedup_key("Brahegatan", "3A", date(2026, 5, 1), 4_900_000)
    diff_house = dedup_key("Brahegatan", "3B", date(2026, 5, 1), 4_900_000)
    diff_date = dedup_key("Brahegatan", "3A", date(2026, 5, 2), 4_900_000)
    diff_price = dedup_key("Brahegatan", "3A", date(2026, 5, 1), 5_000_000)
    diff_street = dedup_key("Riddargatan", "3A", date(2026, 5, 1), 4_900_000)
    assert {base, diff_house, diff_date, diff_price, diff_street} == {
        base,
        diff_house,
        diff_date,
        diff_price,
        diff_street,
    }
