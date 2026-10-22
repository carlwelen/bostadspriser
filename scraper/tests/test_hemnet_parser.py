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
