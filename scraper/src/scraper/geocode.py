"""Idempotent geocoding pass for rows that shipped without coordinates.

Rows carry a `geocodeStatus` (pending | ok | not_found | failed | inline) and a
`geocodeAttempts` counter. A pass selects rows that are `pending` or `failed`,
have no coordinates and are under the attempt cap, asks Mapbox for each (query
built from the street, house number and the district's *display name*, biased to
inner Stockholm), rejects answers outside that area, and writes the outcomes in
batches. One rate-limited or failing lookup never aborts the pass.

Mapbox's terms of service on storing geocoding results are an open owner
decision (see backlog B16 d); the endpoint is unchanged here.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote

import httpx
from sqlalchemy import bindparam, select, text, update
from tenacity import (
    RetryCallState,
    Retrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from .config import load_config
from .db import listing_table, session

log = logging.getLogger("scraper.geocode")

MAPBOX_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places/{q}.json"

# Slugs are for URLs and the database; geocoders want the name people use.
DISTRICT_NAMES = {
    "ostermalm": "Östermalm",
    "vasastan": "Vasastan",
    "norrmalm": "Norrmalm",
    "sodermalm": "Södermalm",
}

# Inner Stockholm (the four districts we cover, with a margin): min lng, min lat,
# max lng, max lat. Sent as Mapbox's `bbox` and enforced on the answer, because a
# provider can still return a same-named street elsewhere.
BBOX = (17.97, 59.29, 18.17, 59.38)
PROXIMITY = (18.07, 59.33)  # lng, lat: Mapbox's `proximity` bias

MAX_ATTEMPTS = 3  # a row is tried at most this many times in total
REQUEST_ATTEMPTS = 4  # HTTP tries per lookup (429/5xx/transport errors)
WRITE_BATCH_SIZE = 100
_POLITE_PAUSE = 0.05

_sleep = time.sleep  # tests replace it so nothing really sleeps


@dataclass
class GeocodeSummary:
    ok: int = 0
    not_found: int = 0
    failed: int = 0


class _Retryable(Exception):
    def __init__(self, reason: str, retry_after: float | None = None) -> None:
        super().__init__(reason)
        self.retry_after = retry_after


def mark_inline_pending() -> int:
    """Relabel `pending` rows that already have coordinates as `inline`.

    Rows written between the geocodeStatus migration and the scraper learning to
    set it would otherwise stay mislabelled. Idempotent; returns rows changed.
    """
    with session() as s:
        n = s.execute(
            text(
                'UPDATE "Listing" SET "geocodeStatus" = \'inline\' '
                'WHERE "geocodeStatus" = \'pending\' AND lat IS NOT NULL AND lng IS NOT NULL'
            )
        ).rowcount
        s.commit()
    return n


def _query(street: str, house: str | None, district: str) -> str:
    number = house.split("-")[0] if house else ""  # "12-14" -> "12"
    place = DISTRICT_NAMES.get(district, district)
    return ", ".join(p for p in [f"{street} {number}".strip(), place, "Stockholm"] if p)


def _inside(lng: float, lat: float) -> bool:
    return BBOX[0] <= lng <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def _wait(state: RetryCallState) -> float:
    backoff = wait_exponential(multiplier=1, min=1, max=30)(state)
    exc = state.outcome.exception() if state.outcome else None
    hinted = getattr(exc, "retry_after", None)
    return max(backoff, min(hinted, 120.0)) if hinted else backoff


def _lookup(http: httpx.Client, token: str, q: str) -> tuple[float, float] | None:
    """(lng, lat) of the best match, None if there is none; retries 429/5xx/network."""

    def once() -> tuple[float, float] | None:
        try:
            r = http.get(
                MAPBOX_URL.format(q=quote(q, safe="")),
                params={
                    "access_token": token,
                    "limit": 1,
                    "country": "se",
                    "bbox": ",".join(str(x) for x in BBOX),
                    "proximity": f"{PROXIMITY[0]},{PROXIMITY[1]}",
                },
            )
        except httpx.TransportError as e:
            raise _Retryable(f"{type(e).__name__}: {e}") from e
        if r.status_code == 429 or r.status_code >= 500:
            hint = r.headers.get("Retry-After", "")
            raise _Retryable(f"HTTP {r.status_code}", float(hint) if hint.replace(".", "", 1).isdigit() else None)
        if r.status_code in (401, 403):
            raise RuntimeError(f"Mapbox rejected the token (HTTP {r.status_code}); check MAPBOX_TOKEN")
        r.raise_for_status()
        features = r.json().get("features") or []
        if not features:
            return None
        lng, lat = features[0]["center"]
        return (float(lng), float(lat))

    for attempt in Retrying(
        retry=retry_if_exception(lambda e: isinstance(e, _Retryable)),
        stop=stop_after_attempt(REQUEST_ATTEMPTS),
        wait=_wait,
        sleep=lambda s: _sleep(s),
        reraise=True,
    ):
        with attempt:
            return once()
    raise AssertionError("unreachable")  # pragma: no cover


def geocode_pending(
    limit: int = 200,
    *,
    max_attempts: int = MAX_ATTEMPTS,
    write_batch_size: int = WRITE_BATCH_SIZE,
    client: httpx.Client | None = None,
) -> GeocodeSummary:
    """Geocode up to `limit` rows. Returns the outcome counts."""
    cfg = load_config()
    if not cfg.mapbox_token:
        raise RuntimeError("MAPBOX_TOKEN is not set")

    relabelled = mark_inline_pending()
    if relabelled:
        log.info("relabelled pending rows that already had coordinates as inline count=%d", relabelled)

    table = listing_table()
    with session() as s:
        rows = s.execute(
            select(table.c.id, table.c.street, table.c.houseNumber, table.c.district)
            .where(
                table.c.geocodeStatus.in_(["pending", "failed"]),
                table.c.lat.is_(None),
                table.c.geocodeAttempts < max_attempts,
            )
            .order_by(table.c.geocodeAttempts, table.c.id)
            .limit(limit)
        ).all()

    summary = GeocodeSummary()
    pending: list[dict] = []  # outcomes waiting to be written

    def flush() -> None:
        if not pending:
            return
        write = (
            update(table)
            .where(table.c.id == bindparam("b_id"))
            .values(
                lat=bindparam("b_lat"),
                lng=bindparam("b_lng"),
                geocodedAt=bindparam("b_at"),
                geocodeStatus=bindparam("b_status"),
                geocodeAttempts=table.c.geocodeAttempts + 1,
            )
        )
        with session() as s:
            s.execute(write, list(pending))
            s.commit()
        pending.clear()

    http = client or httpx.Client(timeout=15)
    try:
        for row_id, street, house, district in rows:
            q = _query(street, house, str(district))
            try:
                hit = _lookup(http, cfg.mapbox_token, q)
            except _Retryable as e:
                log.warning("geocode failed id=%s query=%r error=%s", row_id, q, e)
                summary.failed += 1
                pending.append(_outcome(row_id, None, None, None, "failed"))
            else:
                now = datetime.now(timezone.utc)
                if hit is not None and _inside(*hit):
                    summary.ok += 1
                    pending.append(_outcome(row_id, hit[1], hit[0], now, "ok"))
                else:
                    if hit is not None:
                        log.info("geocode result outside inner Stockholm id=%s query=%r", row_id, q)
                    summary.not_found += 1
                    pending.append(_outcome(row_id, None, None, now, "not_found"))
            if len(pending) >= write_batch_size:
                flush()
            _sleep(_POLITE_PAUSE)
    finally:
        flush()  # keep what was geocoded even if a fatal error (bad token) aborts the pass
        if client is None:
            http.close()
    log.info(
        "geocode pass done ok=%d not_found=%d failed=%d", summary.ok, summary.not_found, summary.failed
    )
    return summary


def _outcome(row_id: str, lat: float | None, lng: float | None, at, status: str) -> dict:
    return {"b_id": row_id, "b_lat": lat, "b_lng": lng, "b_at": at, "b_status": status}
