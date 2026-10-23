"""Smoke test for the Booli SoldProperty → Listing-row mapping.

Uses a captured SoldProperty fixture so this test runs without network or browser.
The fixture was lifted from a real `__APOLLO_STATE__` payload on
`/sok/slutpriser?areaIds=115348&objectType=Lägenhet` (Östermalm, 2026-05-03).
"""

from __future__ import annotations

from scraper.booli import _to_row


# Real SoldProperty entry, edited only to redact nothing — Booli ships these
# verbatim. Note the localized strings: non-breaking spaces in prices, "m²"
# everywhere, comma decimals on rooms (we add a 2,5-rum variant in another test).
SAMPLE_CARD = {
    "__typename": "SoldProperty",
    "id": "6082820",
    "booliId": "6082820",
    "amenities": [{"__ref": "Amenity:{\"key\":\"elevator\"}"}],
    "displayAttributes": {
        "__typename": "DisplayAttributes",
        "screenReaderLabel": "2 rum lägenhet på Surbrunnsgatan 9 Vasastan, Stockholms kommun",
        "dataPoints": [
            {"__typename": "DataPoint", "value": {"__typename": "DisplayText", "plainText": "42 m²"}},
            {"__typename": "DataPoint", "value": {"__typename": "DisplayText", "plainText": "2 rum"}},
            {"__typename": "DataPoint", "value": {"__typename": "DisplayText", "plainText": "vån 3"}},
            {"__typename": "DataPoint", "value": {"__typename": "DisplayText", "plainText": "141 100 kr/m²"}},
        ],
    },
    "soldPrice": {
        "__typename": "FormattedValue",
        "formatted": "5 925 000 kr",
        "raw": 5925000,
        "value": "5 925 000",
        "unit": "kr",
    },
    "streetAddress": "Surbrunnsgatan 9",
    "objectType": "Lägenhet",
    "descriptiveAreaName": "Vasastan",
    "location": {
        "__typename": "Location",
        "region": {"__typename": "Region", "municipalityName": "Stockholm"},
    },
    "soldPriceType": "Slutpris",
    "soldDate": "2026-04-24",
    "latitude": 59.34693504,
    "longitude": 18.06376587,
    "url": "/bostad/801242",
}


def test_to_row_happy_path() -> None:
    row = _to_row(SAMPLE_CARD, "vasastan")
    assert row is not None
    assert row["source"] == "booli"
    assert row["sourceId"] == "6082820"
    assert row["street"] == "Surbrunnsgatan"
    assert row["houseNumber"] == "9"
    assert row["district"] == "vasastan"
    assert row["rooms"] == 2.0
    assert row["areaSqm"] == 42.0
    assert row["priceSek"] == 5_925_000
    assert row["pricePerSqmSek"] == 141_100
    assert row["lat"] == 59.34693504
    assert row["lng"] == 18.06376587
    assert row["geocodedAt"] is not None
    assert row["soldAt"].isoformat() == "2026-04-24"


def test_to_row_skips_when_required_missing() -> None:
    bad = {**SAMPLE_CARD, "streetAddress": ""}
    assert _to_row(bad, "vasastan") is None
    bad2 = {**SAMPLE_CARD, "soldDate": None}
    assert _to_row(bad2, "vasastan") is None
    bad3 = {**SAMPLE_CARD, "id": None, "booliId": None}
    assert _to_row(bad3, "vasastan") is None


def test_to_row_handles_missing_coords() -> None:
    no_coords = {**SAMPLE_CARD, "latitude": None, "longitude": None}
    row = _to_row(no_coords, "vasastan")
    assert row is not None
    assert row["lat"] is None
    assert row["lng"] is None
    assert row["geocodedAt"] is None


def test_to_row_handles_swedish_locale_strings() -> None:
    """Non-breaking spaces in prices, comma-decimal rooms — both must round-trip."""
    nbsp = " "
    card = {
        **SAMPLE_CARD,
        "displayAttributes": {
            "dataPoints": [
                # "79,5 m²" with Unicode comma decimal.
                {"value": {"plainText": "79,5 m²"}},
                # "2,5 rum" — ditto.
                {"value": {"plainText": "2,5 rum"}},
                # Per-sqm with non-breaking space thousands separator.
                {"value": {"plainText": f"140{nbsp}000 kr/m²"}},
            ],
        },
        # Price `formatted` with non-breaking spaces; `raw` still authoritative.
        "soldPrice": {
            "formatted": f"4{nbsp}900{nbsp}000 kr",
            "raw": 4_900_000,
        },
    }
    row = _to_row(card, "vasastan")
    assert row is not None
    assert row["areaSqm"] == 79.5
    assert row["rooms"] == 2.5
    assert row["priceSek"] == 4_900_000
    assert row["pricePerSqmSek"] == 140_000


def test_to_row_computes_per_sqm_when_missing() -> None:
    """Booli sometimes omits the kr/m² datapoint — we should derive it from price/area."""
    card = {
        **SAMPLE_CARD,
        "displayAttributes": {
            "dataPoints": [
                {"value": {"plainText": "50 m²"}},
                {"value": {"plainText": "2 rum"}},
            ],
        },
        "soldPrice": {"raw": 5_000_000, "formatted": "5 000 000 kr"},
    }
    row = _to_row(card, "vasastan")
    assert row is not None
    assert row["pricePerSqmSek"] == 100_000


def test_to_row_falls_back_to_formatted_when_raw_missing() -> None:
    """If Booli ever drops `raw`, parse_sek on `formatted` keeps us going."""
    card = {
        **SAMPLE_CARD,
        "soldPrice": {"formatted": "5 925 000 kr"},
    }
    row = _to_row(card, "vasastan")
    assert row is not None
    assert row["priceSek"] == 5_925_000


def test_to_row_address_without_house_number() -> None:
    card = {**SAMPLE_CARD, "streetAddress": "Stortorget"}
    row = _to_row(card, "vasastan")
    assert row is not None
    assert row["street"] == "Stortorget"
    assert row["houseNumber"] is None


def test_to_row_accepts_epoch_sold_date() -> None:
    """Defensive: if Booli ever swaps soldDate to a Unix epoch, we still land on
    the correct Stockholm-local day (matching hemnet.py's behaviour)."""
    # 2026-04-24 00:00 Europe/Stockholm = 1776981600 (CEST, UTC+2 in late April).
    card = {**SAMPLE_CARD, "soldDate": 1776981600}
    row = _to_row(card, "vasastan")
    assert row is not None
    assert row["soldAt"].isoformat() == "2026-04-24"


def test_geocoded_at_requires_both_lat_and_lng() -> None:
    for lat, lng in ((59.3, None), (None, 18.0)):
        row = _to_row({**SAMPLE_CARD, "latitude": lat, "longitude": lng}, "vasastan")
        assert row is not None and row["geocodedAt"] is None, (lat, lng)


def test_to_row_skips_rows_without_a_final_price() -> None:
    """No price means no row: columns are NOT NULL and 0 would poison averages/dedup keys."""
    assert _to_row({**SAMPLE_CARD, "soldPrice": None}, "vasastan") is None
    assert _to_row({**SAMPLE_CARD, "soldPrice": {}}, "vasastan") is None
    assert _to_row({**SAMPLE_CARD, "soldPrice": {"raw": 0, "formatted": "0 kr"}}, "vasastan") is None
    assert _to_row({**SAMPLE_CARD, "soldPrice": {"formatted": "Slutpris saknas"}}, "vasastan") is None


def test_to_row_skips_when_neither_per_sqm_nor_area_is_available() -> None:
    card = {
        **SAMPLE_CARD,
        "displayAttributes": {"dataPoints": [{"value": {"plainText": "2 rum"}}]},
    }
    assert _to_row(card, "vasastan") is None


def test_to_row_keeps_row_with_per_sqm_but_no_area() -> None:
    card = {
        **SAMPLE_CARD,
        "displayAttributes": {
            "dataPoints": [
                {"value": {"plainText": "2 rum"}},
                {"value": {"plainText": "141 100 kr/m²"}},
            ]
        },
    }
    row = _to_row(card, "vasastan")
    assert row is not None
    assert row["areaSqm"] is None
    assert row["pricePerSqmSek"] == 141_100
