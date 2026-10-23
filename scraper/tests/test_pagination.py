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
from scraper.errors import CrawlIncomplete

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


class _Runaway(BaseException):
    """Raised by the fake fetch when a crawl overruns. A BaseException so the
    `except Exception` around `_fetch` in iter_district cannot swallow it."""


class _Clamp(dict):
    """A site that serves its last page again for every page number past the end."""

    def get(self, k, default=None):
        return super().get(min(k, max(self)), default)


def _crawl(module, monkeypatch, extract_name: str, pages: dict[int, list[dict]]) -> list[str]:
    """Like _run_crawl, but the crawl must complete."""
    ids, incomplete = _run_crawl(module, monkeypatch, extract_name, pages)
    assert incomplete is None, incomplete
    return ids


def _run_crawl(
    module, monkeypatch, extract_name: str, pages: dict[int, list[dict]], fail_pages: tuple[int, ...] = ()
) -> tuple[list[str], CrawlIncomplete | None]:
    """Drive iter_district over `pages`. Returns (sourceIds yielded, CrawlIncomplete or None)."""
    fetched: list[int] = []

    async def fake_fetch(_ctx, _cfg, url: str) -> str:
        n = int(url.rsplit("page=", 1)[1].split("&")[0])
        fetched.append(n)
        if len(fetched) >= 20:
            raise _Runaway(f"pagination did not stop; fetched pages {fetched}")
        if n in fail_pages:
            raise RuntimeError("Cloudflare challenge did not resolve")
        return str(n)

    async def noop(*_a, **_k) -> None: ...

    monkeypatch.setattr(module, "async_playwright", lambda: _PW())
    monkeypatch.setattr(module, "_fetch", fake_fetch)
    monkeypatch.setattr(module, extract_name, lambda html: pages.get(int(html), []))
    monkeypatch.setattr(module, "_warmup", noop)

    ids: list[str] = []
    incomplete: list[CrawlIncomplete] = []

    async def collect() -> None:
        try:
            async for r in module.iter_district("ostermalm", SINCE):
                ids.append(r["sourceId"])
        except CrawlIncomplete as e:
            incomplete.append(e)

    asyncio.run(collect())
    return ids, (incomplete[0] if incomplete else None)


@pytest.mark.parametrize("source", ["hemnet", "booli"])
def test_page_fetch_failure_yields_what_it_got_then_raises_crawl_incomplete(source, monkeypatch) -> None:
    module, card, extract = SOURCES[source]
    pages = {1: [card("p1")], 2: [card("p2")], 3: [card("p3")]}
    ids, incomplete = _run_crawl(module, monkeypatch, extract, pages, fail_pages=(2,))
    assert ids == ["p1"]
    assert incomplete is not None
    assert "page 2" in str(incomplete) and "Cloudflare challenge" in str(incomplete)


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


class _Wrap(dict):
    """A site that wraps around: pages 1, 2, 3, 1, 2, 3, ..."""

    def get(self, k, default=None):
        return super().get((k - 1) % len(self) + 1, default)


def _idless(card: dict, label: str) -> dict:
    """The card without any id (Hemnet: listingId/id, Booli: id/booliId), made unique by address."""
    return {**card, "listingId": None, "id": None, "booliId": None, "streetAddress": f"Gata{label} 1"}


@pytest.mark.parametrize("source", SOURCES)
def test_repeated_last_page_of_rejected_cards_stops_and_is_incomplete(source, monkeypatch, capsys) -> None:
    """Reviewer probe: p1 / all-unpriced / (same page forever). Terminates with ['p1'];
    the repeated page still had in-range cards, so the crawl is flagged incomplete."""
    module, card, extract = SOURCES[source]
    pages = _Clamp({1: [card("p1")], 2: [card("u1", priced=False)]})
    ids, incomplete = _run_crawl(module, monkeypatch, extract, pages)
    assert ids == ["p1"]
    assert incomplete is not None and "repeated" in str(incomplete)
    assert "repeated" in capsys.readouterr().out  # the stop is logged


@pytest.mark.parametrize("source", SOURCES)
def test_repeated_last_page_of_valid_cards_stops_and_is_incomplete(source, monkeypatch) -> None:
    module, card, extract = SOURCES[source]
    pages = _Clamp({1: [card("p1")], 2: [card("p2a"), card("p2b")]})
    ids, incomplete = _run_crawl(module, monkeypatch, extract, pages)
    assert ids == ["p1", "p2a", "p2b"]
    assert incomplete is not None and "page 3" in str(incomplete)


@pytest.mark.parametrize("source", SOURCES)
def test_wrap_around_pagination_stops_at_the_first_page_with_nothing_new(source, monkeypatch) -> None:
    """1, 2, 3, 1, 2, 3, ...: stop on page 4, don't re-fetch until MAX_PAGES."""
    module, card, extract = SOURCES[source]
    pages = _Wrap({1: [card("p1")], 2: [card("p2")], 3: [card("p3")]})
    ids, incomplete = _run_crawl(module, monkeypatch, extract, pages)
    assert ids == ["p1", "p2", "p3"]
    assert incomplete is not None and "page 4" in str(incomplete)


@pytest.mark.parametrize("source", SOURCES)
def test_idless_repeated_page_is_caught_by_fingerprint(source, monkeypatch) -> None:
    module, card, extract = SOURCES[source]
    pages = _Clamp({1: [_idless(card("a"), "A")], 2: [_idless(card("b"), "B"), _idless(card("c"), "C")]})
    ids, incomplete = _run_crawl(module, monkeypatch, extract, pages)
    assert ids == []  # id-less cards are rejected by _to_row
    assert incomplete is not None and "page 3" in str(incomplete)


@pytest.mark.parametrize("source", SOURCES)
def test_page_with_some_new_cards_is_not_a_duplicate_page(source, monkeypatch) -> None:
    module, card, extract = SOURCES[source]
    pages = {1: [card("a"), card("b")], 2: [card("b"), card("c")], 3: []}
    ids, incomplete = _run_crawl(module, monkeypatch, extract, pages)
    assert ids == ["a", "b", "b", "c"]  # overlap re-yields (upsert is idempotent) but continues
    assert incomplete is None


@pytest.mark.parametrize("source", SOURCES)
def test_max_pages_caps_the_crawl_and_logs(source, monkeypatch, capsys) -> None:
    module, card, extract = SOURCES[source]
    monkeypatch.setattr(module, "MAX_PAGES", 4)

    class Endless(dict):
        def get(self, k, default=None):
            return [card(f"p{k}")]  # every page new and valid: only the cap can stop it

    ids, incomplete = _run_crawl(module, monkeypatch, extract, Endless())
    assert ids == ["p1", "p2", "p3", "p4"]
    assert "MAX_PAGES" in capsys.readouterr().out
    assert incomplete is not None and "MAX_PAGES" in str(incomplete)
