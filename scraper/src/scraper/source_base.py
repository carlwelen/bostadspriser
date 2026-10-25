"""Shared crawl core for the sold-listings sources (Hemnet, Booli).

Both sites sit behind Cloudflare and embed their data in
`__NEXT_DATA__.props.pageProps.__APOLLO_STATE__`, so everything except URL building,
`_looks_real`, card extraction and `card_fields` is common and lives here: HTML
cache, polite pacing, warmup, the retrying page fetch, browser/context setup and the
pagination loop with its stop rules and `CrawlIncomplete` handling. A source module
only builds a `Source` describing its pieces and exposes
`iter_district = partial(crawl, SOURCE)`.

Bot-protection handling (first-class concern; unchanged by the extraction):
  - Single-worker, jittered delay (config: default 3-5 s) between live page fetches.
  - Persistent storageState.json so we look like a returning client.
  - On-disk HTML cache keyed by URL+date; challenge pages are never cached.
  - 429/503 and unresolved challenges: two attempts with exponential backoff, then
    the page counts as failed and the crawl ends as CrawlIncomplete.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import random
from collections.abc import AsyncIterator, Callable, Collection
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from playwright.async_api import Browser, BrowserContext, async_playwright
from tenacity import AsyncRetrying, stop_after_attempt, wait_exponential

from .config import Config, load_config
from .dates import stockholm_today
from .errors import CrawlIncomplete
from .pagination import card_key

# Hard ceiling on pages per crawl: well above real depth (a few years of one
# district is a few dozen pages at ~35-50 cards/page) but low enough that a site
# serving pages forever costs minutes, not hours. Hitting it is logged and the
# crawl is reported as incomplete.
MAX_PAGES = 150

log = logging.getLogger("scraper.crawl")


@dataclass
class CrawlProgress:
    """What a crawl did, filled in as it runs (also when it ends in CrawlIncomplete)."""

    pages: int = 0  # pages fetched this run
    last_completed_page: int = 0  # highest page whose cards were all processed (resume point - 1)
    rejected: int = 0  # in-range cards the source refused (no price, other area, ...)
    oldest_sold_at: date | None = None  # oldest sale date of an accepted, in-range card


@dataclass(frozen=True)
class Source:
    """What differs between sources; everything else is shared."""

    name: str
    districts: Collection[str]
    district_url: Callable[[str, int], str]
    home_url: str
    # Warmup is "settled" once the homepage contains any of these.
    warmup_markers: tuple[str, ...]
    # Apollo `__typename` the listing page must embed before we read it.
    ready_marker: str
    looks_real: Callable[[str], bool]
    extract_cards: Callable[[str], list[dict]]
    card_id: Callable[[dict], str | None]
    parse_sold_at: Callable[[dict], date | None]
    to_row: Callable[[dict, str], dict | None]
    # Optional filter for cards that leak across district boundaries (Booli).
    accept_card: Callable[[dict, str], bool] | None = None


def cache_path(cfg: Config, url: str) -> Path:
    h = hashlib.sha256(url.encode()).hexdigest()[:16]
    today = date.today().isoformat()
    return cfg.cache_dir / f"{today}_{h}.html"


async def polite_sleep(cfg: Config) -> None:
    delay = random.uniform(cfg.min_delay_ms, cfg.max_delay_ms) / 1000
    await asyncio.sleep(delay)


async def warmup(ctx: BrowserContext, cfg: Config, source: Source) -> None:
    """Land on the site's homepage first so Cloudflare can mint a passing token.

    Pages opened directly to the listing URL get a harder challenge; coming in
    via the homepage usually clears with a soft check.
    """
    page = await ctx.new_page()
    try:
        await page.goto(source.home_url, wait_until="domcontentloaded", timeout=60_000)
        # Give Cloudflare's managed challenge time to settle.
        for _ in range(20):
            html = await page.content()
            if "__APOLLO_STATE__" in html or any(m in html for m in source.warmup_markers):
                break
            await asyncio.sleep(1.0)
    finally:
        await page.close()


async def fetch(ctx: BrowserContext, cfg: Config, source: Source, url: str) -> str:
    cache = cache_path(cfg, url)
    if cache.exists():
        cached = cache.read_text(encoding="utf-8")
        if source.looks_real(cached):
            return cached
        # Stale challenge in cache — drop it and refetch.
        cache.unlink(missing_ok=True)

    last_html = ""
    # Two attempts per page; if both fail the crawl ends (CrawlIncomplete) and
    # the next run retries.
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
                # swapping in the real document. Wait for the embedded Apollo
                # cache to include the listing rows, but cap aggressively so we
                # don't hang here forever.
                try:
                    await page.wait_for_function(
                        """() => {
                            const t = document.querySelector('script#__NEXT_DATA__');
                            if (!t || !t.textContent) return false;
                            return t.textContent.includes('__APOLLO_STATE__')
                                && t.textContent.includes('%s');
                        }"""
                        % source.ready_marker,
                        timeout=25_000,
                    )
                except Exception:
                    pass  # fall through to the polling check below

                for _ in range(8):
                    last_html = await page.content()
                    if source.looks_real(last_html):
                        break
                    await asyncio.sleep(1.5)
                else:
                    raise RuntimeError("Cloudflare challenge did not resolve")
            finally:
                await page.close()

    cache.write_text(last_html, encoding="utf-8")
    await polite_sleep(cfg)
    return last_html


async def crawl(
    source: Source,
    district: str,
    since: date,
    *,
    start_page: int = 1,
    max_pages: int | None = None,
    progress: CrawlProgress | None = None,
) -> AsyncIterator[dict]:
    """Yield normalized listing dicts for a district, newest first.

    Pagination ends on:
      - an empty page (no cards),
      - the first card with `soldAt < since` (pages are sorted by sale date, desc),
      - a page that adds no unseen card to this crawl (repeated or wrapped-around
        pages; flagged incomplete if its cards were still newer than `since`),
      - a page with no card dated >= since,
      - a page fetch failure or MAX_PAGES (both flagged incomplete).

    Cards the source rejects (no price, blank address, other district, ...) are
    skipped but never end the crawl. When the crawl ends early, every row fetched
    so far has been yielded and CrawlIncomplete is raised afterwards, once the
    browser is closed.

    `start_page` resumes a long crawl; `max_pages` is the highest page number
    allowed (default MAX_PAGES); `progress`, if given, is filled in as pages are
    processed so callers can record coverage and where to resume.
    """
    if district not in source.districts:
        raise ValueError(f"unknown district: {district}")
    cfg = load_config()
    name = source.name
    limit = MAX_PAGES if max_pages is None else max_pages
    progress = progress if progress is not None else CrawlProgress()

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
        # Both sources share the storageState file — both sit behind Cloudflare
        # and benefit from a returning-client cookie set.
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
            await warmup(ctx, cfg, source)

        try:
            page_num = start_page
            seen: set[str] = set()
            while True:
                if page_num > limit:
                    incomplete = f"{name} {district}: hit MAX_PAGES={limit}"
                    log.warning("crawl stopped source=%s district=%s reason=%r", name, district, incomplete)
                    break
                url = source.district_url(district, page_num)
                try:
                    html = await fetch(ctx, cfg, source, url)
                except Exception as e:  # noqa: BLE001
                    # Stuck on a CF challenge or transient error. Rows already
                    # yielded stay upserted and the crawl ends in CrawlIncomplete
                    # below; `update` keeps its cutoff behind the gap (B39).
                    incomplete = f"{name} {district} page {page_num} failed: {type(e).__name__}: {e}"
                    log.warning(
                        "page failed source=%s district=%s page=%d error=%r",
                        name, district, page_num, f"{type(e).__name__}: {e}",
                    )
                    break
                progress.pages += 1

                cards = source.extract_cards(html)
                if not cards:
                    log.info("empty page, crawl complete source=%s district=%s page=%d", name, district, page_num)
                    break

                # Stop when a page adds nothing unseen to this crawl: a site that
                # serves its last page for every page number past the end, or
                # wraps around (1, 2, 3, 1, 2, 3, ...), would otherwise be
                # crawled until MAX_PAGES. Cards without an id are fingerprinted.
                keys = [card_key(c, source.card_id(c)) for c in cards]
                if all(k in seen for k in keys):
                    msg = f"{name} {district} page {page_num} repeated pages already seen"
                    log.warning(
                        "repeated page, stopping source=%s district=%s page=%d", name, district, page_num
                    )
                    in_range = any(
                        (d := source.parse_sold_at(c)) is not None and d >= since for c in cards
                    )
                    if in_range:
                        # Still-current cards but nothing new: the site may be
                        # clamping pagination before we reached `since`.
                        incomplete = f"{msg} (cards still newer than {since.isoformat()})"
                    break
                seen.update(keys)

                # Cards the source rejects are skipped but must not end the
                # crawl: only an explicit `soldAt < since`, or a page with no
                # card dated >= since, does. The date is parsed independently of
                # those rejections.
                stop = False
                in_range_on_page = 0
                for c in cards:
                    sold_at = source.parse_sold_at(c)
                    if sold_at is None:
                        continue
                    if sold_at > stockholm_today():
                        # Bad dates cannot enter coverage, but a future-only page
                        # must not hide valid cards on the following page.
                        in_range_on_page += 1
                        progress.rejected += 1
                        continue
                    # Drop cards that leaked across district boundaries.
                    if source.accept_card is not None and not source.accept_card(c, district):
                        if sold_at >= since:
                            in_range_on_page += 1
                            progress.rejected += 1
                        continue
                    if sold_at < since:
                        stop = True
                        break
                    in_range_on_page += 1
                    # Coverage claim: only cards of this district inside the window.
                    # The stop card (older than `since`) and rejected neighbour-district
                    # cards must not drag the "oldest sale reached" back.
                    if progress.oldest_sold_at is None or sold_at < progress.oldest_sold_at:
                        progress.oldest_sold_at = sold_at
                    row = source.to_row(c, district)
                    if row is None:
                        progress.rejected += 1
                        continue
                    yield row

                progress.last_completed_page = page_num
                log.info(
                    "page done source=%s district=%s page=%d cards=%d in_range=%d",
                    name, district, page_num, len(cards), in_range_on_page,
                )
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
