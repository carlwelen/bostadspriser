"""Booli sold-listings scraper.

Mirrors `hemnet.py`: Booli renders sold-listing pages server-side and embeds the
data in `__NEXT_DATA__.props.pageProps.__APOLLO_STATE__`, keyed by Apollo cache id.
The relevant cards have `__typename == "SoldProperty"`. We walk the cache instead
of the DOM because Booli's CSS class names rotate frequently while the Apollo
schema is stable.

Like Hemnet, Booli sits behind Cloudflare — plain HTTP returns a 403 challenge,
so Playwright (real Chromium) is required. The browser, cache, pacing and
pagination handling is shared with Hemnet in `source_base.py`; this module only
defines Booli's URLs, page check, card extraction, district filter and parsing.

URL pattern (verified 2026-05-03):
    https://www.booli.se/sok/slutpriser?areaIds=<id>&objectType=Lägenhet&page=<n>
~35 SoldProperty cards per page; the API leaks neighbouring areas occasionally,
so we filter on `descriptiveAreaName` to keep our district buckets clean.

Area IDs verified 2026-05-03 against Booli's areaSuggestionSearch GraphQL:
each is a `SubAdministrativeArea` (Stadsdel) under `Stockholms kommun`.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from typing import AsyncIterator
from urllib.parse import quote

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

# Booli encodes `soldDate` as a plain ISO date string ("2026-05-02") so no
# timezone math is needed here — but we keep ZoneInfo around in case Booli
# changes the field shape (sister sources sometimes ship epoch seconds).
# Importing it costs nothing and signals intent.
# (No _STOCKHOLM constant needed; soldDate is already date-only.)


# Verified 2026-05-03 via Booli's areaSuggestionSearch GraphQL endpoint.
# Each id is a `SubAdministrativeArea` (Stadsdel) within `Stockholms kommun`.
DISTRICT_AREA_IDS = {
    "ostermalm": 115348,
    "vasastan": 115349,
    "norrmalm": 115350,
    "sodermalm": 115341,
}

# Booli's `descriptiveAreaName` values per district. We filter on these because
# pagination occasionally leaks adjacent districts into a result page.
_AREA_NAMES = {
    "ostermalm": {"Östermalm"},
    "vasastan": {"Vasastan"},
    "norrmalm": {"Norrmalm"},
    "sodermalm": {"Södermalm"},
}

# Backwards-compatible alias to mirror the brief's wording. Maps our district
# slugs to whatever appears in Booli URLs/payloads — for now that's the area id.
DISTRICT_SLUGS = {k: str(v) for k, v in DISTRICT_AREA_IDS.items()}


def _district_url(district: str, page: int) -> str:
    area_id = DISTRICT_AREA_IDS[district]
    # objectType is sent URL-encoded as Booli's UI does; matches the canonical share URL.
    return (
        f"https://www.booli.se/sok/slutpriser"
        f"?areaIds={area_id}&objectType={quote('Lägenhet')}&page={page}"
    )


def _looks_real(html: str) -> bool:
    """True if the page is a real Booli search page (not a Cloudflare challenge)."""
    if "__APOLLO_STATE__" not in html:
        return False
    if "Just a moment" in html or "<title>Vänta" in html:
        return False
    # Booli's slutpriser page always renders SoldProperty entries when there's
    # data; this guard rejects soft-404 templates that still embed an empty cache.
    return "SoldProperty" in html or "propertySearch" in html


def _extract_sold_properties(html: str) -> list[dict]:
    """Pull `SoldProperty` entries out of the embedded Apollo cache."""
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
    return [
        v for v in apollo.values()
        if isinstance(v, dict) and v.get("__typename") == "SoldProperty"
    ]


def _data_point_text(card: dict, predicate) -> str | None:
    """Find the first dataPoint whose plainText matches `predicate(text)`."""
    dp_list = (card.get("displayAttributes") or {}).get("dataPoints") or []
    for dp in dp_list:
        text = ((dp.get("value") or {}).get("plainText")) or ""
        if predicate(text):
            return text
    return None


def _card_id(card: dict) -> str | None:
    value = card.get("id") or card.get("booliId")
    return str(value) if value else None


def _parse_sold_at(card: dict) -> date | None:
    """The sale date of a SoldProperty, independent of any price/address rejection.

    Booli ships ISO dates ("2026-05-02"). Tolerate epoch seconds in case the
    field shape changes: same Stockholm-zone behaviour as hemnet.py.
    """
    raw = card.get("soldDate")
    if not raw:
        return None
    try:
        if isinstance(raw, (int, float)) or (
            isinstance(raw, str) and raw.replace(".", "", 1).isdigit()
        ):
            from zoneinfo import ZoneInfo

            return datetime.fromtimestamp(float(raw), tz=ZoneInfo("Europe/Stockholm")).date()
        return date.fromisoformat(str(raw)[:10])
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def card_fields(card: dict, district: str) -> dict | None:
    """Derive the Listing columns that come from a SoldProperty. None if unparseable.

    Pure function of the card: no id, no timestamps. `_to_row` adds those for
    inserts; `reparse` calls this directly to re-derive stored rows from `raw`.
    """
    booli_id = card.get("id") or card.get("booliId")
    addr = card.get("streetAddress") or ""
    sold_at = _parse_sold_at(card)
    if not (booli_id and sold_at and addr):
        return None

    # "Sankt Eriksgatan 10 B" → ("Sankt Eriksgatan", "10B")
    street, house = parse_street_address(addr)
    if not street:
        return None

    # Booli puts living area, rooms, and kr/m² in `displayAttributes.dataPoints`
    # as positional, label-less entries. Pick by content shape — the sample
    # always contains "<n> m²", "<n> rum", optional "vån <n>", and "<n> kr/m²".
    area_text = _data_point_text(card, lambda s: "m²" in s and "kr" not in s)
    rooms_text = _data_point_text(card, lambda s: "rum" in s)
    sqm_price_text = _data_point_text(card, lambda s: "kr/m²" in s)

    sold_price = card.get("soldPrice") or {}
    # `soldPrice.raw` is the cleanest source; fall back to parsing `formatted`
    # so we stay tolerant if Booli ever drops the raw field.
    price_sek = sold_price.get("raw")
    if not isinstance(price_sek, int):
        price_sek = parse_sek(sold_price.get("formatted") or sold_price.get("value"))

    # Booli does not always expose a per-sqm value; derive it from price/area
    # when missing. Rows with no final price (or neither kr/m² nor area) are
    # skipped, not stored with 0.
    area_sqm = parse_sqm(area_text)
    prices = resolve_prices(price_sek, parse_sek(sqm_price_text), area_sqm)
    if prices is None:
        return None
    final_price, price_per_sqm = prices

    lat = card.get("latitude")
    lng = card.get("longitude")

    return {
        "sourceId": str(booli_id),
        "dedupKey": dedup_key(street, house, sold_at, final_price),
        "street": street,
        "houseNumber": house,
        "district": district,
        "rooms": round_1dp(parse_rooms(rooms_text)),
        "areaSqm": round_1dp(area_sqm),
        "priceSek": final_price,
        "pricePerSqmSek": price_per_sqm,
        "soldAt": sold_at,
        "lat": lat,
        "lng": lng,
    }


def _to_row(card: dict, district: str) -> dict | None:
    """Map a Booli SoldProperty into the Listing column shape. Returns None if unparseable."""
    fields = card_fields(card, district)
    if fields is None:
        return None
    return {
        "id": str(uuid.uuid4()),
        "source": "booli",
        **fields,
        "geocodedAt": datetime.now(timezone.utc) if fields["lat"] is not None and fields["lng"] is not None else None,
        "raw": card,
    }


def _accept_card(card: dict, district: str) -> bool:
    """Booli's search radius occasionally pulls neighbouring areas into a page."""
    return card.get("descriptiveAreaName") in _AREA_NAMES[district]


SOURCE = Source(
    name="booli",
    districts=DISTRICT_AREA_IDS,
    district_url=_district_url,
    home_url="https://www.booli.se/",
    warmup_markers=("Slutpriser", "Sök bostäder"),
    ready_marker="SoldProperty",
    looks_real=_looks_real,
    extract_cards=_extract_sold_properties,
    card_id=_card_id,
    parse_sold_at=_parse_sold_at,
    to_row=_to_row,
    accept_card=_accept_card,
)


def iter_district(district: str, since: date, **kwargs) -> AsyncIterator[dict]:
    """Yield normalized listing dicts for a district, stopping when soldAt < `since`.

    The crawl itself (browser, cache, pagination, CrawlIncomplete) is shared: see
    `source_base.crawl`. Cards from other areas are filtered via `_accept_card`.
    """
    return crawl(SOURCE, district, since, **kwargs)
