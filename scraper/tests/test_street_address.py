"""Table tests for `parse_street_address` — real Stockholm address patterns.

Canonical house number: digits + optional uppercase letter with no space
("10 B" -> "10B"), ranges keep the hyphen ("12-14"), floor/apartment noise is
dropped. The street name is left exactly as the source spelled it.
"""

from __future__ import annotations

import pytest

from scraper import booli, hemnet
from scraper.normalize import parse_street_address

NBSP = " "


@pytest.mark.parametrize(
    "addr,expected",
    [
        # Plain
        ("Brahegatan 3", ("Brahegatan", "3")),
        ("Brahegatan 3A", ("Brahegatan", "3A")),
        ("Brahegatan 3a", ("Brahegatan", "3A")),
        ("Brahegatan 3 A", ("Brahegatan", "3A")),
        ("Surbrunnsgatan 9", ("Surbrunnsgatan", "9")),
        # Letter after a space used to leak into the street
        ("Sankt Eriksgatan 10 B", ("Sankt Eriksgatan", "10B")),
        ("S:t Eriksgatan 10 B", ("S:t Eriksgatan", "10B")),
        ("Sankt Eriksgatan 10B", ("Sankt Eriksgatan", "10B")),
        ("Karlavägen 1 A", ("Karlavägen", "1A")),
        ("Götgatan 22 A", ("Götgatan", "22A")),
        # Ranges
        ("Ringvägen 12-14", ("Ringvägen", "12-14")),
        ("Ringvägen 12 - 14", ("Ringvägen", "12-14")),
        ("Ringvägen 12–14", ("Ringvägen", "12-14")),
        ("Ringvägen 12A-14B", ("Ringvägen", "12A-14B")),
        ("Ringvägen 12 A-14 B", ("Ringvägen", "12A-14B")),
        # Floor / apartment noise
        ("Hornsgatan 64 1tr", ("Hornsgatan", "64")),
        ("Hornsgatan 64 1 tr", ("Hornsgatan", "64")),
        ("Hornsgatan 64, 2 tr", ("Hornsgatan", "64")),
        ("Hornsgatan 64 B 1tr", ("Hornsgatan", "64B")),
        ("Odengatan 5, lgh 1101", ("Odengatan", "5")),
        ("Odengatan 5 lgh 1101", ("Odengatan", "5")),
        ("Odengatan 5 LGH 1101", ("Odengatan", "5")),
        ("Odengatan 5 1101", ("Odengatan", "5")),
        ("Odengatan 5 (lgh 1101)", ("Odengatan", "5")),
        ("Odengatan 5C, lgh 1101", ("Odengatan", "5C")),
        ("Vasagatan 7 vån 3", ("Vasagatan", "7")),
        ("Vasagatan 7 nb", ("Vasagatan", "7")),
        ("Vasagatan 7 bv", ("Vasagatan", "7")),
        ("Vasagatan 7 B nb", ("Vasagatan", "7B")),
        ("Vasagatan 7, bv", ("Vasagatan", "7")),
        # No house number
        ("Mariatorget", ("Mariatorget", None)),
        ("Mariatorget, lgh 1101", ("Mariatorget", None)),
        ("Norr Mälarstrand", ("Norr Mälarstrand", None)),
        # Multiword names without digits
        ("Norr Mälarstrand 12", ("Norr Mälarstrand", "12")),
        ("Östra Järnvägsgatan 5 A", ("Östra Järnvägsgatan", "5A")),
        ("Sankt Göransgatan 100", ("Sankt Göransgatan", "100")),
        # Whitespace
        (f"Brahegatan{NBSP}3A", ("Brahegatan", "3A")),
        (f"Sankt{NBSP}Eriksgatan{NBSP}10{NBSP}B", ("Sankt Eriksgatan", "10B")),
        (f"  Hornsgatan  64{NBSP}1tr ", ("Hornsgatan", "64")),
        # Degenerate input stays a street, never crashes
        ("", ("", None)),
        ("   ", ("", None)),
    ],
)
def test_parse_street_address(addr: str, expected: tuple[str, str | None]) -> None:
    assert parse_street_address(addr) == expected


def test_parse_street_address_is_idempotent_on_its_output() -> None:
    street, house = parse_street_address("Sankt Eriksgatan 10 B")
    assert parse_street_address(f"{street} {house}") == (street, house)


HEMNET_CARD = {
    "__typename": "SaleCard",
    "listingId": "1",
    "soldAt": "1777672800.0",
    "finalPrice": "4 900 000 kr",
    "livingArea": "35 m²",
    "squareMeterPrice": "140 000 kr/m²",
    "rooms": "1 rum",
}
BOOLI_CARD = {
    "__typename": "SoldProperty",
    "id": "1",
    "soldDate": "2026-05-02",
    "soldPrice": {"raw": 4_900_000},
    "displayAttributes": {
        "dataPoints": [
            {"value": {"plainText": "35 m²"}},
            {"value": {"plainText": "1 rum"}},
            {"value": {"plainText": "140 000 kr/m²"}},
        ]
    },
}


def test_blank_address_rows_are_skipped() -> None:
    assert hemnet._to_row({**HEMNET_CARD, "streetAddress": f" {NBSP} "}, "sodermalm") is None
    assert booli._to_row({**BOOLI_CARD, "streetAddress": f" {NBSP} "}, "sodermalm") is None


@pytest.mark.parametrize(
    "addr,street,house",
    [
        ("Sankt Eriksgatan 10 B", "Sankt Eriksgatan", "10B"),
        ("Götgatan 22 A", "Götgatan", "22A"),
        ("Odengatan 5, lgh 1101", "Odengatan", "5"),
        ("Ringvägen 12-14", "Ringvägen", "12-14"),
    ],
)
def test_both_sources_use_the_shared_parser(addr: str, street: str, house: str) -> None:
    h = hemnet._to_row({**HEMNET_CARD, "streetAddress": addr}, "sodermalm")
    b = booli._to_row({**BOOLI_CARD, "streetAddress": addr}, "sodermalm")
    assert h is not None and b is not None
    assert (h["street"], h["houseNumber"]) == (street, house)
    assert (b["street"], b["houseNumber"]) == (street, house)
    assert h["dedupKey"] == b["dedupKey"]
