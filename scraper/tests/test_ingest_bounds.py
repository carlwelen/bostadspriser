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
def test_outlier_rejections_are_counted_without_stopping_pagination(source, monkeypatch):
    module, _, extract = SOURCES[source]
    progress = source_base.CrawlProgress()
    pages = {1: [card_for(source, area="9")], 2: [card_for(source)]}
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
def test_reparse_counts_outliers_and_leaves_stored_rows_untouched(source, db):
    module = hemnet if source == "hemnet" else booli
    row = module._to_row(card_for(source), "ostermalm")
    row["raw"] = card_for(source, rooms="16")
    upsert_listing(row)
    summary = reparse()
    assert (summary.scanned, summary.changed, summary.unparseable) == (1, 0, 1)
