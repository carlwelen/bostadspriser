"""Hemnet sold-listings scraper.

Hemnet renders sold-listing pages server-side and embeds the data in
`__NEXT_DATA__.props.pageProps.__APOLLO_STATE__`, keyed by Apollo cache id with
`__typename == "SaleCard"`. We walk that cache instead of scraping the visible DOM
because Hemnet's CSS classes change frequently while the Apollo schema is stable.

The site sits behind Cloudflare, so plain HTTP returns a 403 challenge — Playwright
(real Chromium) is required. The browser, cache, pacing and pagination handling
(bot protection is a first-class concern) is shared with Booli in `source_base.py`;
this module only defines Hemnet's URLs, page check, card extraction and parsing.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from typing import AsyncIterator
from zoneinfo import ZoneInfo

from .normalize import (
    dedup_key,
    parse_rooms,
    parse_sek,
    parse_sqm,
    parse_street_address,
    resolve_prices,
    round_1dp,
)
from .source_base import Source, crawl

# Hemnet encodes `soldAt` as a Unix timestamp at Stockholm-local midnight.
# Converting in UTC drops the day by one in summer (UTC+2). Use the Swedish
# zone so the date in our DB matches the "Såld <day>" label users see.
_STOCKHOLM = ZoneInfo("Europe/Stockholm")

# Verified 2026-05-02 against https://www.hemnet.se/locations/show?q=...
# Each ID is a `district` in `Stockholms kommun`.
DISTRICT_LOCATION_IDS = {
    "ostermalm": 473448,
    "vasastan": 925970,
    "norrmalm": 925969,
    "sodermalm": 898472,
}


def _district_url(district: str, page: int) -> str:
    loc = DISTRICT_LOCATION_IDS[district]
    return f"https://www.hemnet.se/salda/bostader?location_ids%5B%5D={loc}&page={page}"


def _looks_real(html: str) -> bool:
    """True if the page is a real Hemnet listing page (not a Cloudflare challenge)."""
    if "__APOLLO_STATE__" not in html:
        return False
    if "Just a moment" in html or "<title>Vänta" in html:
        return False
    return True


def _extract_sale_cards(html: str) -> list[dict]:
    """Pull `SaleCard` entries out of the embedded Apollo cache.

    Returns the raw SaleCard dicts; normalization happens in `_to_row`.
    """
    marker = '<script id="__NEXT_DATA__" type="application/json">'
    i = html.find(marker)
    if i < 0:
        return []
    j = html.find("</script>", i + len(marker))
    if j < 0:
        return []
    blob = html[i + len(marker) : j]
    try:
        data = json.loads(blob)
    except json.JSONDecodeError:
        return []
    apollo = data.get("props", {}).get("pageProps", {}).get("__APOLLO_STATE__", {})
    return [v for v in apollo.values() if isinstance(v, dict) and v.get("__typename") == "SaleCard"]


def _card_id(card: dict) -> str | None:
    value = card.get("listingId") or card.get("id")
    return str(value) if value else None


def _parse_sold_at(card: dict) -> date | None:
    """The sale date of a SaleCard, independent of any price/address rejection."""
    sold_at_raw = card.get("soldAt")
    if not sold_at_raw:
        return None
    try:
        return datetime.fromtimestamp(float(sold_at_raw), tz=_STOCKHOLM).date()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def card_fields(card: dict, district: str) -> dict | None:
    """Derive the Listing columns that come from a SaleCard. None if unparseable.

    Pure function of the card: no id, no timestamps. `_to_row` adds those for
    inserts; `reparse` calls this directly to re-derive stored rows from `raw`.
    """
    listing_id = card.get("listingId") or card.get("id")
    addr = card.get("streetAddress") or ""
    sold_at = _parse_sold_at(card)
    if not (listing_id and sold_at and addr):
        return None

    # "Sankt Eriksgatan 10 B" → ("Sankt Eriksgatan", "10B")
    street, house = parse_street_address(addr)
    if not street:
        return None

    coords = card.get("coordinates") or {}
    area_sqm = parse_sqm(card.get("livingArea"))
    prices = resolve_prices(
        parse_sek(card.get("finalPrice")), parse_sek(card.get("squareMeterPrice")), area_sqm
    )
    if prices is None:
        return None
    price_sek, price_per_sqm = prices
    return {
        "sourceId": str(listing_id),
        "dedupKey": dedup_key(street, house, sold_at, price_sek),
        "street": street,
        "houseNumber": house,
        "district": district,
        "rooms": round_1dp(parse_rooms(card.get("rooms"))),
        "areaSqm": round_1dp(area_sqm),
        "priceSek": price_sek,
        "pricePerSqmSek": price_per_sqm,
        "soldAt": sold_at,
        "lat": coords.get("lat"),
        "lng": coords.get("long"),
    }


def _to_row(card: dict, district: str) -> dict | None:
    """Map a Hemnet SaleCard into the Listing column shape. Returns None if unparseable."""
    fields = card_fields(card, district)
    if fields is None:
        return None
    return {
        "id": str(uuid.uuid4()),
        "source": "hemnet",
        **fields,
        "geocodedAt": datetime.now(timezone.utc) if fields["lat"] is not None and fields["lng"] is not None else None,
        "raw": card,
    }


SOURCE = Source(
    name="hemnet",
    districts=DISTRICT_LOCATION_IDS,
    district_url=_district_url,
    home_url="https://www.hemnet.se/",
    warmup_markers=("Slutpriser", "Söker du"),
    ready_marker="SaleCard",
    looks_real=_looks_real,
    extract_cards=_extract_sale_cards,
    card_id=_card_id,
    parse_sold_at=_parse_sold_at,
    to_row=_to_row,
)


def iter_district(district: str, since: date) -> AsyncIterator[dict]:
    """Yield normalized listing dicts for a district, stopping when soldAt < `since`.

    The crawl itself (browser, cache, pagination, CrawlIncomplete) is shared: see
    `source_base.crawl`.
    """
    return crawl(SOURCE, district, since)
