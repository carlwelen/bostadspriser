"""Booli sold-listings scraper.

Mirrors `hemnet.py`: Booli renders sold-listing pages server-side and embeds the
data in `__NEXT_DATA__.props.pageProps.__APOLLO_STATE__`, keyed by Apollo cache id.
The relevant cards have `__typename == "SoldProperty"`. We walk the cache instead
of the DOM because Booli's CSS class names rotate frequently while the Apollo
schema is stable.

Like Hemnet, Booli sits behind Cloudflare — plain HTTP returns a 403 challenge,
so Playwright (real Chromium) is required. Bot-protection guarantees match
hemnet.py: single-worker, jittered 3–5 s pacing, persistent storageState, on-disk
HTML cache that skips CF challenge pages, partial-page failures break the loop
rather than raise (`scraper update` overlaps a week so misses heal next run).

URL pattern (verified 2026-05-03):
    https://www.booli.se/sok/slutpriser?areaIds=<id>&objectType=Lägenhet&page=<n>
~35 SoldProperty cards per page; the API leaks neighbouring areas occasionally,
so we filter on `descriptiveAreaName` to keep our district buckets clean.

Area IDs verified 2026-05-03 against Booli's areaSuggestionSearch GraphQL:
each is a `SubAdministrativeArea` (Stadsdel) under `Stockholms kommun`.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import random
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import AsyncIterator
from urllib.parse import quote

from playwright.async_api import Browser, BrowserContext, async_playwright
from tenacity import AsyncRetrying, stop_after_attempt, wait_exponential

from .config import Config, load_config
from .normalize import (
    dedup_key,
    parse_rooms,
    parse_sek,
    parse_sqm,
    parse_street_address,
    resolve_prices,
    round_1dp,
)

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


@dataclass
class FetchResult:
    html: str
    status: int


def _cache_path(cfg: Config, url: str) -> Path:
    h = hashlib.sha256(url.encode()).hexdigest()[:16]
    today = date.today().isoformat()
    return cfg.cache_dir / f"{today}_{h}.html"


async def _polite_sleep(cfg: Config) -> None:
    delay = random.uniform(cfg.min_delay_ms, cfg.max_delay_ms) / 1000
    await asyncio.sleep(delay)


def _looks_real(html: str) -> bool:
    """True if the page is a real Booli search page (not a Cloudflare challenge)."""
    if "__APOLLO_STATE__" not in html:
        return False
    if "Just a moment" in html or "<title>Vänta" in html:
        return False
    # Booli's slutpriser page always renders SoldProperty entries when there's
    # data; this guard rejects soft-404 templates that still embed an empty cache.
    return "SoldProperty" in html or "propertySearch" in html


async def _warmup(ctx: BrowserContext, cfg: Config) -> None:
    """Land on the Booli homepage first so Cloudflare can mint a passing token.

    Direct navigation to the listing URL gets a harder challenge; coming in via
    the homepage usually clears with a soft check. Same trick as hemnet.py.
    """
    page = await ctx.new_page()
    try:
        await page.goto("https://www.booli.se/", wait_until="domcontentloaded", timeout=60_000)
        for _ in range(20):
            html = await page.content()
            if "__APOLLO_STATE__" in html or "Slutpriser" in html or "Sök bostäder" in html:
                break
            await asyncio.sleep(1.0)
    finally:
        await page.close()


async def _fetch(ctx: BrowserContext, cfg: Config, url: str) -> str:
    cache = _cache_path(cfg, url)
    if cache.exists():
        cached = cache.read_text(encoding="utf-8")
        if _looks_real(cached):
            return cached
        # Stale challenge in cache — drop it and refetch.
        cache.unlink(missing_ok=True)

    last_html = ""
    async for attempt in AsyncRetrying(
        stop=stop_after_attempt(2),
        wait=wait_exponential(multiplier=2, min=10, max=60),
        reraise=True,
    ):
        with attempt:
            page = await ctx.new_page()
            try:
                resp = await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                status = resp.status if resp else 0
                if status in (429, 503):
                    raise RuntimeError(f"rate limited: {status}")

                # Wait for the embedded Apollo cache to include SoldProperty rows.
                # Cap aggressively — long hangs here mean CF won't clear and we'd
                # rather move on than block the whole run.
                try:
                    await page.wait_for_function(
                        """() => {
                            const t = document.querySelector('script#__NEXT_DATA__');
                            if (!t || !t.textContent) return false;
                            return t.textContent.includes('__APOLLO_STATE__')
                                && t.textContent.includes('SoldProperty');
                        }""",
                        timeout=25_000,
                    )
                except Exception:
                    pass  # fall through to the polling check below

                for _ in range(8):
                    last_html = await page.content()
                    if _looks_real(last_html):
                        break
                    await asyncio.sleep(1.5)
                else:
                    raise RuntimeError("Cloudflare challenge did not resolve")
            finally:
                await page.close()

    cache.write_text(last_html, encoding="utf-8")
    await _polite_sleep(cfg)
    return last_html


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


# Hard ceiling on pages per crawl, far above real depth (~50 cards/page, a few
# years of one district is well under 100 pages). A guard against a site that
# keeps serving pages forever; hitting it is logged.
MAX_PAGES = 500


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
        "geocodedAt": datetime.now(timezone.utc) if fields["lat"] is not None else None,
        "raw": card,
    }


async def iter_district(district: str, since: date) -> AsyncIterator[dict]:
    """Yield normalized listing dicts for a district, stopping when soldAt < `since`.

    Pagination ends on:
      - empty page (no SoldProperty cards),
      - first card with `soldAt < since` (Booli sorts by soldDate desc),
      - fetch failure (we break, not raise — the next `scraper update` overlap heals it).
    """
    if district not in DISTRICT_AREA_IDS:
        raise ValueError(f"unknown district: {district}")
    cfg = load_config()
    allowed_areas = _AREA_NAMES[district]

    async with async_playwright() as p:
        browser: Browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--no-sandbox",
            ],
        )
        ctx_kwargs: dict = {
            "user_agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "viewport": {"width": 1440, "height": 900},
            "locale": "sv-SE",
            "timezone_id": "Europe/Stockholm",
            "extra_http_headers": {
                "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
            },
        }
        # We share the storageState file with hemnet — both sit behind Cloudflare
        # and benefit from a returning-client cookie set, but the file is per-run
        # so cross-pollination is harmless.
        if cfg.storage_state_path.exists():
            ctx_kwargs["storage_state"] = str(cfg.storage_state_path)
        ctx = await browser.new_context(**ctx_kwargs)

        await ctx.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
            "Object.defineProperty(navigator, 'languages', { get: () => ['sv-SE','sv','en'] });"
            "Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });"
        )

        if not cfg.storage_state_path.exists():
            await _warmup(ctx, cfg)

        try:
            page_num = 1
            prev_ids: set[str] = set()
            while True:
                if page_num > MAX_PAGES:
                    print(
                        f"[booli] {district}: hit MAX_PAGES={MAX_PAGES}; stopping pagination here",
                        flush=True,
                    )
                    break
                url = _district_url(district, page_num)
                try:
                    html = await _fetch(ctx, cfg, url)
                except Exception as e:  # noqa: BLE001
                    print(
                        f"[booli] {district} page {page_num} failed: {type(e).__name__}: {e};"
                        f" stopping pagination here",
                        flush=True,
                    )
                    break

                cards = _extract_sold_properties(html)
                if not cards:
                    break

                # A site that serves its last page again for every page number
                # past the end would otherwise be crawled forever.
                ids = {i for i in map(_card_id, cards) if i}
                if ids and ids == prev_ids:
                    break
                prev_ids = ids

                # Cards we skip (other area, no price, blank address, ...) must not
                # end the crawl: only an explicit `soldAt < since`, or a page with
                # no card dated >= since, does. The date is parsed independently
                # of those rejections.
                stop = False
                in_range_on_page = 0
                for c in cards:
                    sold_at = _parse_sold_at(c)
                    if sold_at is None:
                        continue
                    # Drop cards that leaked across district boundaries — Booli's
                    # search radius occasionally pulls neighbours into the result set.
                    if c.get("descriptiveAreaName") not in allowed_areas:
                        if sold_at >= since:
                            in_range_on_page += 1
                        continue
                    if sold_at < since:
                        stop = True
                        break
                    in_range_on_page += 1
                    row = _to_row(c, district)
                    if row is None:
                        continue
                    yield row

                if stop or in_range_on_page == 0:
                    break
                page_num += 1

            try:
                await ctx.storage_state(path=str(cfg.storage_state_path))
            except Exception:
                pass
        finally:
            await ctx.close()
            await browser.close()
