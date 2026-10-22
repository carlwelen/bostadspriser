"""HTTP-only probe: skip Playwright, fetch Hemnet via httpx.

Run: uv run python scripts/probe_httpx.py
"""

from __future__ import annotations

import json
import re

import httpx
from bs4 import BeautifulSoup

from scraper.hemnet import DISTRICT_URLS

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

def main() -> None:
    url = f"{DISTRICT_URLS['ostermalm']}&page=1"
    print(f"GET {url}")
    with httpx.Client(http2=False, follow_redirects=True, timeout=30) as c:
        r = c.get(url, headers={"User-Agent": UA, "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8"})
    print(f"HTTP {r.status_code}, {len(r.content):,} bytes")
    if r.status_code != 200:
        print(r.text[:500])
        return

    soup = BeautifulSoup(r.text, "html.parser")
    print(f"<title>: {soup.title.string if soup.title else '?'}")
    next_data = soup.find("script", id="__NEXT_DATA__")
    if next_data and next_data.string:
        print(f"__NEXT_DATA__ present: {len(next_data.string):,} bytes")
        data = json.loads(next_data.string)
        blob = json.dumps(data)
        for keyname in ["soldAt", "sellingPrice", "streetAddress", "squareMeterPrice", "askingPrice", "livingArea", "rooms"]:
            count = blob.count(f'"{keyname}"')
            sample = re.search(rf'"{keyname}":\s*("[^"]{{0,60}}"|-?\d+(?:\.\d+)?|null)', blob)
            print(f"  {keyname}: {count} occurrences, sample={sample.group(0) if sample else 'none'}")
        page_props = data.get("props", {}).get("pageProps", {})
        print(f"  pageProps top keys: {list(page_props.keys())[:20]}")
    else:
        print("no __NEXT_DATA__")

    cards = soup.select("[data-testid='result-card']")
    print(f"[data-testid='result-card']: {len(cards)} matches")


if __name__ == "__main__":
    main()
