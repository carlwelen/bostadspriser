"""B14: source parsers reject implausible known values, retaining missing ones."""
from copy import deepcopy

import pytest
from sqlalchemy import text

from scraper import booli, hemnet, source_base
from scraper.db import upsert_listing
from scraper.reparse import reparse
from tests.test_booli_parser import SAMPLE_CARD as BOOLI
from tests.test_hemnet_parser import SAMPLE_CARD as HEMNET
from tests.test_pagination import SOURCES, _run_crawl


def card_for(source, area="35", rooms="2", pps="140000"):
    card = deepcopy(HEMNET if source == "hemnet" else BOOLI)
    if source == "hemnet":
        card.update(livingArea=None if area is None else f"{area} m²",
                    rooms=None if rooms is None else f"{rooms} rum",
                    squareMeterPrice=None if pps is None else f"{pps} kr/m²")
    else:
        card["descriptiveAreaName"] = "Östermalm"
        card["displayAttributes"]["dataPoints"] = [
            {"value": {"plainText": f"{value} {unit}"}}
            for value, unit in [(area, "m²"), (rooms, "rum"), (pps, "kr/m²")]
            if value is not None
        ]
    return card


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("field,value", [
    ("area", "9.99"), ("area", "400.01"), ("area", "-35"),
    ("rooms", "0.99"), ("rooms", "15.01"), ("rooms", "-2"),
    ("pps", "19999"), ("pps", "400001"), ("pps", "-140000"),
    ("pps", "NaN"), ("pps", "Infinity"), ("pps", "0"),
    ("area", "NaN"), ("area", "Infinity"), ("rooms", "-Infinity"),
    ("area", "9" * 400),
])
def test_known_outliers_are_rejected_by_ingest_and_reparse(source, field, value):
    module = hemnet if source == "hemnet" else booli
    card = card_for(source, **{field: value})
    assert module._to_row(card, "ostermalm") is None
    assert module.card_fields(card, "ostermalm") is None


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("area,rooms,pps", [
    ("10", "1", "20000"), ("400", "15", "400000"),
    (None, None, "140000"), ("35", None, None),
])
def test_boundaries_and_missing_optional_values_remain_idempotent(source, area, rooms, pps, db):
    module = hemnet if source == "hemnet" else booli
    card = card_for(source, area, rooms, pps)
    row = module._to_row(card, "ostermalm")
    assert row is not None
    upsert_listing(row)
    upsert_listing(module._to_row(card, "ostermalm"))
    summary = reparse()
    assert (summary.scanned, summary.changed, summary.unparseable) == (1, 0, 0)
    with db.connect() as conn:
        assert conn.execute(text('SELECT count(*) FROM "Listing"')).scalar_one() == 1


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("area", ["9", "garbage", "35e3"])
def test_outlier_rejections_are_counted_without_stopping_pagination(source, area, monkeypatch):
    module, _, extract = SOURCES[source]
    progress = source_base.CrawlProgress()
    pages = {1: [card_for(source, area=area)], 2: [card_for(source)]}
    pages[2][0].update(id="valid", listingId="valid", soldDate="2026-05-02")
    pages[1][0]["soldDate"] = "2026-05-02"
    ids, incomplete = _run_crawl(module, monkeypatch, extract, pages, progress=progress)
    assert incomplete is None
    assert len(ids) == 1
    assert progress.rejected == 1


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("area", ["10", "400"])
def test_derived_per_sqm_is_also_bounded(source, area):
    module = hemnet if source == "hemnet" else booli
    assert module._to_row(card_for(source, area=area, pps=None), "ostermalm") is None


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("rooms", ["16", "garbage", "2oops"])
def test_reparse_counts_outliers_and_leaves_stored_rows_untouched(source, rooms, db):
    module = hemnet if source == "hemnet" else booli
    row = module._to_row(card_for(source), "ostermalm")
    row["raw"] = card_for(source, rooms=rooms)
    upsert_listing(row)
    summary = reparse()
    assert (summary.scanned, summary.changed, summary.unparseable) == (1, 0, 1)


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("price", [999_999, 20_000_001])
def test_derived_pps_checked_before_rounding(source, price):
    module = hemnet if source == "hemnet" else booli
    card = card_for(source, area="50", pps=None)
    if source == "hemnet":
        card["finalPrice"] = f"{price} kr"
    else:
        card["soldPrice"] = {"raw": price}
    assert module.card_fields(card, "ostermalm") is None
    assert module._to_row(card, "ostermalm") is None


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("field,value", [
    ("area", "garbage"), ("rooms", "garbage"), ("area", "35oops"),
    ("rooms", "2oops"), ("area", "35e3"), ("rooms", "2e0"),
    ("area", "prefix 35"), ("rooms", "prefix 2"),
    ("area", "35 m² extra"), ("rooms", "2 rum extra"),
])
def test_malformed_present_measurements_rejected(source, field, value):
    module = hemnet if source == "hemnet" else booli
    card = card_for(source, **{field: value})
    assert module.card_fields(card, "ostermalm") is None
    assert module._to_row(card, "ostermalm") is None


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("area,rooms", [("79,5", "2,5"), ("79.5", "2.5"), (" 79,5\u00a0", "\u00a02,5 ")])
def test_localized_measurement_tokens_remain_supported(source, area, rooms):
    module = hemnet if source == "hemnet" else booli
    fields = module.card_fields(card_for(source, area=area, rooms=rooms), "ostermalm")
    assert fields is not None
    assert (fields["areaSqm"], fields["rooms"]) == (79.5, 2.5)


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("price,expected", [
    (1_000_000, 20_000), (20_000_000, 400_000),
    (1_000_001, 20_000), (19_999_999, 400_000),
])
def test_valid_derived_pps_boundaries_and_rounding_are_preserved(source, price, expected):
    module = hemnet if source == "hemnet" else booli
    card = card_for(source, area="50", pps=None)
    if source == "hemnet":
        card["finalPrice"] = f"{price} kr"
    else:
        card["soldPrice"] = {"raw": price}
    fields = module.card_fields(card, "ostermalm")
    assert fields is not None
    assert fields["pricePerSqmSek"] == expected


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("pps", ["garbage", "19999,9", "400000,1", "140oops000", "1.4e5", "14 00 00", "19999,999999999999999999", "400000,000000000000000001"])
def test_present_invalid_pps_never_becomes_missing_or_concatenated(source, pps):
    module = hemnet if source == "hemnet" else booli
    assert module.card_fields(card_for(source, pps=pps), "ostermalm") is None


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("price", ["4oops900000 kr", "4.9e6 kr", "49 00 000 kr", "4900000,5 kr", "4900000 kr/m²", "4900000,000000000000000001 kr"])
def test_malformed_final_prices_are_rejected(source, price):
    module = hemnet if source == "hemnet" else booli
    card = card_for(source)
    if source == "hemnet":
        card["finalPrice"] = price
    else:
        card["soldPrice"] = {"formatted": price}
    assert module.card_fields(card, "ostermalm") is None


@pytest.mark.parametrize("raw", [True, "4oops900000", float("nan"), float("inf"), 4900000.5])
def test_booli_present_invalid_raw_price_does_not_fall_back_to_formatted(raw):
    card = card_for("booli")
    card["soldPrice"] = {"raw": raw, "formatted": "4 900 000 kr"}
    assert booli.card_fields(card, "ostermalm") is None


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("pps,expected", [("20 000,0", 20000), ("400\u00a0000,0", 400000), ("140\u202f000,6", 140001)])
def test_localized_explicit_pps_preserves_valid_decimals_and_rounds_after_bounds(source, pps, expected):
    module = hemnet if source == "hemnet" else booli
    row = module.card_fields(card_for(source, pps=pps), "ostermalm")
    assert row is not None
    assert row["pricePerSqmSek"] == expected


@pytest.mark.parametrize("source", ["hemnet", "booli"])
def test_malformed_money_rejections_use_existing_crawl_counter(source, monkeypatch):
    module, _, extract = SOURCES[source]
    progress = source_base.CrawlProgress()
    bad = card_for(source, pps="garbage")
    good = card_for(source)
    bad["soldDate"] = "2026-05-02"
    good.update(id="valid", listingId="valid", soldDate="2026-05-02")
    ids, incomplete = _run_crawl(module, monkeypatch, extract, {1: [bad], 2: [good]}, progress=progress)
    assert incomplete is None
    assert len(ids) == 1
    assert progress.rejected == 1
