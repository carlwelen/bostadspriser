"""Hemnet sold-listings scraper.

Hemnet renders sold-listing pages server-side and embeds the data in
`__NEXT_DATA__.props.pageProps.__APOLLO_STATE__`, keyed by Apollo cache id with
`__typename == "SaleCard"`. We walk that cache instead of scraping the visible DOM
because Hemnet's CSS classes change frequently while the Apollo schema is stable.

The site sits behind Cloudflare, so plain HTTP returns a 403 challenge — Playwright
(real Chromium) is required.

Bot-protection handling (per the brief, first-class concern):
  - Single-worker, jittered 3–5 s delay between page fetches.
  - Persistent storageState.json so we look like a returning client.
  - On-disk HTML cache keyed by URL+date so re-runs in dev don't re-fetch.
  - 429/503 → exponential backoff up to 10 minutes, then exit cleanly.
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
from zoneinfo import ZoneInfo

from playwright.async_api import Browser, BrowserContext, async_playwright
from tenacity import AsyncRetrying, stop_after_attempt, wait_exponential

from .config import Config, load_config
from .errors import CrawlIncomplete
from .normalize import (
    dedup_key,
    parse_rooms,
    parse_sek,
    parse_sqm,
    parse_street_address,
    resolve_prices,
    round_1dp,
)

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
    """True if the page is a real Hemnet listing page (not a Cloudflare challenge)."""
    if "__APOLLO_STATE__" not in html:
        return False
    if "Just a moment" in html or "<title>Vänta" in html:
        return False
    return True


async def _warmup(ctx: BrowserContext, cfg: Config) -> None:
    """Land on the Hemnet homepage first so Cloudflare can mint a passing token.

    Pages opened directly to the listing URL get a harder challenge; coming in
    via the homepage usually clears with a soft check.
    """
    page = await ctx.new_page()
    try:
        await page.goto("https://www.hemnet.se/", wait_until="domcontentloaded", timeout=60_000)
        # Give Cloudflare's managed challenge time to settle.
        for _ in range(20):
            html = await page.content()
            if "__APOLLO_STATE__" in html or "Slutpriser" in html or "Söker du" in html:
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
    # Two attempts per page; if both fail we move on. Repeated runs of the
    # whole script will retry the misses.
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

                # Cloudflare's managed challenge runs ~3–10 s of JS before
                # swapping in the real document. Wait, but cap aggressively so
                # we don't hang here forever.
                try:
                    await page.wait_for_function(
                        """() => {
                            const t = document.querySelector('script#__NEXT_DATA__');
                            if (!t || !t.textContent) return false;
                            return t.textContent.includes('__APOLLO_STATE__')
                                && t.textContent.includes('SaleCard');
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


# Hard ceiling on pages per crawl, far above real depth (~50 cards/page, a few
# years of one district is well under 100 pages). A guard against a site that
# keeps serving pages forever; hitting it is logged.
MAX_PAGES = 500


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
        "geocodedAt": datetime.now(timezone.utc) if fields["lat"] else None,
        "raw": card,
    }


async def iter_district(district: str, since: date) -> AsyncIterator[dict]:
    """Yield normalized listing dicts for a district, stopping when soldAt < `since`."""
    if district not in DISTRICT_LOCATION_IDS:
        raise ValueError(f"unknown district: {district}")
    cfg = load_config()

    incomplete: str | None = None
    async with async_playwright() as p:
        browser: Browser = await p.chromium.launch(
            headless=True,
            # Mask the headless `navigator.webdriver` flag and a few other tells
            # Cloudflare's bot fingerprinting checks. Without these, CF is more
            # likely to issue an interactive challenge that won't auto-resolve.
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
        if cfg.storage_state_path.exists():
            ctx_kwargs["storage_state"] = str(cfg.storage_state_path)
        ctx = await browser.new_context(**ctx_kwargs)

        # Hide the most obvious automation tells before any page navigates.
        await ctx.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
            "Object.defineProperty(navigator, 'languages', { get: () => ['sv-SE','sv','en'] });"
            "Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });"
        )

        # Warmup once per browser session so subsequent listing fetches inherit
        # the Cloudflare cookie set on the homepage visit.
        if not cfg.storage_state_path.exists():
            await _warmup(ctx, cfg)

        try:
            page_num = 1
            prev_ids: set[str] = set()
            while True:
                if page_num > MAX_PAGES:
                    incomplete = f"hemnet {district}: hit MAX_PAGES={MAX_PAGES}"
                    print(f"[hemnet] {incomplete}; stopping pagination here", flush=True)
                    break
                url = _district_url(district, page_num)
                try:
                    html = await _fetch(ctx, cfg, url)
                except Exception as e:  # noqa: BLE001
                    # Stuck on a CF challenge or transient error — keep what we
                    # already yielded; subsequent runs will fill the gap because
                    # we re-scrape the last 7 days each time (`scraper update`).
                    incomplete = (
                        f"hemnet {district} page {page_num} failed: {type(e).__name__}: {e}"
                    )
                    print(f"[hemnet] {incomplete}; stopping pagination here", flush=True)
                    break

                cards = _extract_sale_cards(html)
                if not cards:
                    break

                # A site that serves its last page again for every page number
                # past the end would otherwise be crawled forever.
                ids = {i for i in map(_card_id, cards) if i}
                if ids and ids == prev_ids:
                    break
                prev_ids = ids

                # Cards `_to_row` rejects (no price, blank address, ...) are
                # skipped but must not end the crawl: only an explicit
                # `soldAt < since`, or a page with no card dated >= since, does.
                stop = False
                in_range_on_page = 0
                for c in cards:
                    sold_at = _parse_sold_at(c)
                    if sold_at is None:
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

    if incomplete is not None:
        # Everything fetched before the failure has been yielded; callers keep
        # those rows and mark this source/district as partial.
        raise CrawlIncomplete(incomplete)
