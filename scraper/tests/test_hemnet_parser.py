"""Smoke test for the SaleCard → Listing-row mapping.

Uses a captured SaleCard fixture so this test runs without network or browser.
"""

from __future__ import annotations

from scraper.hemnet import _to_row


SAMPLE_CARD = {
    "__typename": "SaleCard",
    "id": "9126385077079702135",
    "listingId": "21713762",
    "streetAddress": "Brahegatan 3A",
    "soldAt": "1777672800.0",
    "soldAtLabel": "Såld 2 maj. 2026",
    "askingPrice": "Pris på förfrågan",
    "finalPrice": "4 900 000 kr",
    "livingArea": "35 m²",
    "fee": "1 931 kr/mån",
    "squareMeterPrice": "140 000 kr/m²",
    "rooms": "1 rum",
    "coordinates": {
        "__typename": "GeometryPoint",
        "lat": 59.3371735,
        "long": 18.0753784,
    },
}


def test_to_row_happy_path() -> None:
    row = _to_row(SAMPLE_CARD, "ostermalm")
    assert row is not None
    assert row["source"] == "hemnet"
    assert row["sourceId"] == "21713762"
    assert row["street"] == "Brahegatan"
    assert row["houseNumber"] == "3A"
    assert row["district"] == "ostermalm"
    assert row["rooms"] == 1.0
    assert row["areaSqm"] == 35.0
    assert row["priceSek"] == 4_900_000
    assert row["pricePerSqmSek"] == 140_000
    assert row["lat"] == 59.3371735
    assert row["lng"] == 18.0753784
    assert row["geocodedAt"] is not None
    assert row["soldAt"].isoformat() == "2026-05-02"


def test_to_row_skips_when_required_missing() -> None:
    bad = {**SAMPLE_CARD, "streetAddress": ""}
    assert _to_row(bad, "ostermalm") is None
    bad2 = {**SAMPLE_CARD, "soldAt": None}
    assert _to_row(bad2, "ostermalm") is None
    bad3 = {**SAMPLE_CARD, "listingId": None, "id": None}
    assert _to_row(bad3, "ostermalm") is None


def test_to_row_handles_missing_coords() -> None:
    no_coords = {**SAMPLE_CARD, "coordinates": None}
    row = _to_row(no_coords, "ostermalm")
    assert row is not None
    assert row["lat"] is None
    assert row["lng"] is None
    assert row["geocodedAt"] is None


def test_to_row_skips_rows_without_a_final_price() -> None:
    """No price means no row: columns are NOT NULL and 0 would poison averages/dedup keys."""
    assert _to_row({**SAMPLE_CARD, "finalPrice": None}, "ostermalm") is None
    assert _to_row({**SAMPLE_CARD, "finalPrice": ""}, "ostermalm") is None
    assert _to_row({**SAMPLE_CARD, "finalPrice": "Pris på förfrågan"}, "ostermalm") is None
    assert _to_row({**SAMPLE_CARD, "finalPrice": "0 kr"}, "ostermalm") is None
    no_key = {k: v for k, v in SAMPLE_CARD.items() if k != "finalPrice"}
    assert _to_row(no_key, "ostermalm") is None


def test_to_row_derives_per_sqm_from_price_and_area() -> None:
    card = {**SAMPLE_CARD, "squareMeterPrice": None, "finalPrice": "5 000 000 kr", "livingArea": "50 m²"}
    row = _to_row(card, "ostermalm")
    assert row is not None
    assert row["pricePerSqmSek"] == 100_000
    # Rounds like Booli does; non-breaking spaces and comma decimals are fine.
    card = {**SAMPLE_CARD, "squareMeterPrice": "", "finalPrice": "4 900 000 kr", "livingArea": "79,5 m²"}
    row = _to_row(card, "ostermalm")
    assert row is not None
    assert row["pricePerSqmSek"] == round(4_900_000 / 79.5)


def test_to_row_skips_when_neither_per_sqm_nor_area_is_available() -> None:
    card = {**SAMPLE_CARD, "squareMeterPrice": None, "livingArea": None}
    assert _to_row(card, "ostermalm") is None
    # A zero area cannot be divided by either.
    card = {**SAMPLE_CARD, "squareMeterPrice": None, "livingArea": "0 m²"}
    assert _to_row(card, "ostermalm") is None


def test_to_row_keeps_row_with_per_sqm_but_no_area() -> None:
    row = _to_row({**SAMPLE_CARD, "livingArea": None}, "ostermalm")
    assert row is not None
    assert row["areaSqm"] is None
    assert row["pricePerSqmSek"] == 140_000
