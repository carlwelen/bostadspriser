"""Fetch Hemnet's Östermalm sold-listings page 1 and report what's parseable.

Run: uv run python scripts/probe_hemnet.py
"""

from __future__ import annotations

import asyncio
import json
import re

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

from scraper.config import load_config
from scraper.hemnet import DISTRICT_URLS


async def main() -> None:
    cfg = load_config()
    url = f"{DISTRICT_URLS['ostermalm']}&page=1"
    print(f"GET {url}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx_kwargs = dict(
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
            locale="sv-SE",
        )
        if cfg.storage_state_path.exists():
            ctx_kwargs["storage_state"] = str(cfg.storage_state_path)
        ctx = await browser.new_context(**ctx_kwargs)
        page = await ctx.new_page()
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        print(f"HTTP {resp.status if resp else 'NO RESPONSE'}")
        html = await page.content()
        await ctx.storage_state(path=str(cfg.storage_state_path))
        await browser.close()

    print(f"HTML size: {len(html):,} bytes")
    soup = BeautifulSoup(html, "html.parser")
    print(f"<title>: {soup.title.string if soup.title else '?'}")

    next_data = soup.find("script", id="__NEXT_DATA__")
    if next_data and next_data.string:
        print(f"__NEXT_DATA__ present: {len(next_data.string):,} bytes")
        try:
            data = json.loads(next_data.string)
            keys = list(data.get("props", {}).get("pageProps", {}).keys())
            print(f"  pageProps keys: {keys}")
            blob = json.dumps(data)
            print(f"  contains 'soldAt': {'soldAt' in blob}")
            print(f"  contains 'sellingPrice': {'sellingPrice' in blob}")
            print(f"  contains 'streetAddress': {'streetAddress' in blob}")
            for keyname in ["soldAt", "sellingPrice", "streetAddress", "squareMeterPrice"]:
                m = re.search(rf'"{keyname}":\s*("[^"]*"|\d+|null)', blob)
                if m:
                    print(f"  sample {keyname}: {m.group(0)[:80]}")
        except json.JSONDecodeError as e:
            print(f"  JSON parse error: {e}")
    else:
        print("__NEXT_DATA__ NOT present")

    cards = soup.select("[data-testid='result-card']")
    print(f"[data-testid='result-card']: {len(cards)} matches")
    if not cards:
        for sel in ['a[href*="/salda/"]', "article", "li.normal-results__hit", '[class*="result"]']:
            n = len(soup.select(sel))
            if n:
                print(f"  fallback selector {sel!r}: {n} matches")


if __name__ == "__main__":
    asyncio.run(main())
