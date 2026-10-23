"""Idempotent geocoding pass: fills lat/lng on rows where geocodedAt IS NULL."""

from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx
from sqlalchemy import select, update

from .config import load_config
from .db import listing_table, session

MAPBOX_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places/{q}.json"


def geocode_pending(limit: int = 200) -> int:
    """Geocode up to `limit` rows. Returns number of rows updated."""
    cfg = load_config()
    if not cfg.mapbox_token:
        raise RuntimeError("MAPBOX_TOKEN is not set")

    table = listing_table()
    with session() as s:
        rows = s.execute(
            select(table.c.id, table.c.street, table.c.houseNumber, table.c.district)
            .where(table.c.geocodedAt.is_(None))
            .limit(limit)
        ).all()

    updated = 0
    with httpx.Client(timeout=15) as http:
        for row_id, street, house, district in rows:
            q = ", ".join(p for p in [f"{street} {house or ''}".strip(), str(district), "Stockholm"] if p)
            r = http.get(
                MAPBOX_URL.format(q=httpx.QueryParams({"q": q})["q"]),
                params={"access_token": cfg.mapbox_token, "limit": 1, "country": "se"},
            )
            r.raise_for_status()
            features = r.json().get("features") or []
            lng, lat = (features[0]["center"] if features else (None, None))

            with session() as s:
                s.execute(
                    update(table)
                    .where(table.c.id == row_id)
                    .values(lat=lat, lng=lng, geocodedAt=datetime.now(timezone.utc))
                )
                s.commit()
            updated += 1
            time.sleep(0.05)
    return updated
