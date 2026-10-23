"""Pagination stop rule for both sources, with no browser and no network.

`async_playwright`, `_fetch`, `_extract_*` and `_warmup` are monkeypatched, so the
loop in `iter_district` is exercised against hand-built pages. A page whose cards
are all rejected by `_to_row` (no price, blank address, wrong Booli area) must not
end the crawl: only an empty page, an explicit `soldAt < since`, or a page with
no card dated >= since does.
"""

from __future__ import annotations

import asyncio
from datetime import date

import pytest

from scraper import booli, hemnet

SINCE = date(2026, 5, 1)
# Hemnet encodes soldAt as epoch seconds at Stockholm-local midnight.
EPOCH_IN_RANGE = "1777672800.0"  # 2026-05-02
EPOCH_TOO_OLD = "1776981600.0"  # 2026-04-24


class _Ctx:
    async def add_init_script(self, *_a, **_k) -> None: ...
    async def storage_state(self, *_a, **_k) -> None: ...
    async def close(self) -> None: ...


class _Browser:
    async def new_context(self, **_k) -> _Ctx:
        return _Ctx()

    async def close(self) -> None: ...


class _Chromium:
    async def launch(self, **_k) -> _Browser:
        return _Browser()


class _PW:
    chromium = _Chromium()

    async def __aenter__(self) -> _PW:
        return self

    async def __aexit__(self, *_a) -> None: ...


def _hemnet_card(sid: str, *, priced: bool = True, sold: str = EPOCH_IN_RANGE, addr: str = "Brahegatan 3A") -> dict:
    return {
        "listingId": sid,
        "soldAt": sold,
        "streetAddress": addr,
        "finalPrice": "4 900 000 kr" if priced else None,
        "livingArea": "35 m²",
        "squareMeterPrice": "140 000 kr/m²",
        "rooms": "1 rum",
    }


def _booli_card(
    sid: str, *, priced: bool = True, sold: str = "2026-05-02", area: str = "Östermalm", addr: str = "Brahegatan 3A"
) -> dict:
    return {
        "id": sid,
        "soldDate": sold,
        "streetAddress": addr,
        "descriptiveAreaName": area,
        "soldPrice": {"raw": 4_900_000} if priced else {},
        "displayAttributes": {
            "dataPoints": [
                {"value": {"plainText": "35 m²"}},
                {"value": {"plainText": "1 rum"}},
                {"value": {"plainText": "140 000 kr/m²"}},
            ]
        },
    }


SOURCES = {
    "hemnet": (hemnet, _hemnet_card, "_extract_sale_cards"),
    "booli": (booli, _booli_card, "_extract_sold_properties"),
}


def _crawl(module, monkeypatch, extract_name: str, pages: dict[int, list[dict]]) -> list[str]:
    fetched: list[int] = []

    async def fake_fetch(_ctx, _cfg, url: str) -> str:
        n = int(url.rsplit("page=", 1)[1].split("&")[0])
        fetched.append(n)
        assert len(fetched) < 20, "pagination did not stop"
        return str(n)

    async def noop(*_a, **_k) -> None: ...

    monkeypatch.setattr(module, "async_playwright", lambda: _PW())
    monkeypatch.setattr(module, "_fetch", fake_fetch)
    monkeypatch.setattr(module, extract_name, lambda html: pages.get(int(html), []))
    monkeypatch.setattr(module, "_warmup", noop)

    async def collect() -> list[str]:
        return [r["sourceId"] async for r in module.iter_district("ostermalm", SINCE)]

    return asyncio.run(collect())


@pytest.mark.parametrize("source", SOURCES)
def test_a_page_of_rejected_cards_does_not_end_the_crawl(source, monkeypatch) -> None:
    module, card, extract = SOURCES[source]
    pages = {
        1: [card("p1")],
        2: [card("u1", priced=False), card("u2", priced=False), card("u3", addr="12")],
        3: [card("p3")],
    }
    assert _crawl(module, monkeypatch, extract, pages) == ["p1", "p3"]


def test_booli_page_of_other_area_cards_does_not_end_the_crawl(monkeypatch) -> None:
    pages = {
        1: [_booli_card("p1")],
        2: [_booli_card("n1", area="Kungsholmen"), _booli_card("n2", area="Kungsholmen")],
        3: [_booli_card("p3")],
    }
    assert _crawl(booli, monkeypatch, "_extract_sold_properties", pages) == ["p1", "p3"]


@pytest.mark.parametrize("source", SOURCES)
def test_crawl_stops_on_empty_page(source, monkeypatch) -> None:
    module, card, extract = SOURCES[source]
    pages = {1: [card("p1")], 2: [], 3: [card("p3")]}
    assert _crawl(module, monkeypatch, extract, pages) == ["p1"]


@pytest.mark.parametrize("source", SOURCES)
def test_crawl_stops_at_first_card_older_than_since(source, monkeypatch) -> None:
    module, card, extract = SOURCES[source]
    old = {"hemnet": {"sold": EPOCH_TOO_OLD}, "booli": {"sold": "2026-04-24"}}[source]
    pages = {1: [card("p1"), card("old", **old), card("after")], 2: [card("p2")]}
    assert _crawl(module, monkeypatch, extract, pages) == ["p1"]


@pytest.mark.parametrize("source", SOURCES)
def test_crawl_stops_on_a_page_without_any_dated_in_range_card(source, monkeypatch) -> None:
    """Undated junk can't keep the crawl alive forever (guard against repeated last pages)."""
    module, card, extract = SOURCES[source]
    undated = {**card("x"), "soldAt": None, "soldDate": None}
    pages = {1: [card("p1")], 2: [undated, undated], 3: [card("p3")]}
    assert _crawl(module, monkeypatch, extract, pages) == ["p1"]
