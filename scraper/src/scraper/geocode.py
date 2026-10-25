"""Idempotent geocoding pass for rows that shipped without coordinates.

Rows carry a `geocodeStatus` (pending | ok | not_found | failed | inline) and a
`geocodeAttempts` counter. A pass selects rows that are `pending` or `failed`,
have an incomplete coordinate pair and are under the attempt cap, asks Mapbox for each (query
built from the street, house number and the district's *display name*, biased to
inner Stockholm), rejects answers outside that area, and writes the outcomes in
batches. One rate-limited or failing lookup never aborts the pass.

Mapbox's terms of service on storing geocoding results are an open owner
decision (see backlog B16 d); the endpoint is unchanged here.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote

import httpx
from sqlalchemy import bindparam, func, or_, select, text, update
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

# httpx logs every request URL (with our access_token in the query string) at INFO
# on its own loggers. Pin them above INFO so no root-level logging config can leak it.
for _noisy in ("httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

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
# This many rows in a row ending in an exhausted retry (5xx / network, any kind) means
# the service or our connection is down, not that these rows are bad: stop the pass.
OUTAGE_ROW_LIMIT = 3
_POLITE_PAUSE = 0.05

_sleep = time.sleep  # tests replace it so nothing really sleeps


@dataclass
class GeocodeSummary:
    ok: int = 0
    not_found: int = 0
    failed: int = 0
    # The pass stopped early because Mapbox kept answering 429. The rows not yet
    # tried (and the one that tripped it) keep their attempt budget.
    rate_limited: bool = False
    # The pass stopped early because OUTAGE_ROW_LIMIT consecutive rows got no answer
    # (5xx/network errors), or because nothing in the whole pass was answered: Mapbox is
    # down or we are offline. Those rows keep their budget. (A streak mixing 5xx with
    # unexpected errors also reports this, i.e. exit 75: "try again later" is the safe
    # reading when we can't tell which side is at fault.)
    unavailable: bool = False
    # OUTAGE_ROW_LIMIT rows in a row hit an unexpected error of our own (a bug, not a
    # service problem): the pass stopped, nothing was charged.
    internal_error: bool = False


class _Retryable(Exception):
    """429 / 5xx / transport error: worth another try. Messages never carry the URL."""

    def __init__(self, reason: str, retry_after: float | None = None, rate_limited: bool = False) -> None:
        super().__init__(reason)
        self.retry_after = retry_after
        self.rate_limited = rate_limited


class GeocodeConfigError(RuntimeError):
    """Missing or rejected Mapbox token: nothing will work, abort (CLI exit 78).
    The message never contains the URL or the token. When raised mid-pass, `summary`
    holds what the pass had stored by then."""

    summary: "GeocodeSummary | None" = None


class _RowFailed(Exception):
    """A definitive per-row failure (non-retryable 4xx, unusable payload): the row
    is marked `failed` and the pass carries on. The message is already redacted."""


def _redact(text_: str, token: str) -> str:
    return text_.replace(token, "***") if token else text_


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


def _new_salt() -> str:
    return uuid.uuid4().hex


def _order_by(table, salt: str):
    """Row order for a pass: fewest attempts first, then a per-pass pseudo-random order.

    A fixed order (attempts, id) made the same rows sort first on every pass, so a few
    persistently failing rows tripped the outage breaker each time and the good rows
    behind them were never requested. Salting the order with a fresh value per pass
    spreads the failing rows through the backlog; any answered row between them then
    charges them normally. (An empty salt means plain id order: for deterministic tests.)"""
    if salt == "":
        return [table.c.geocodeAttempts, table.c.id]
    return [table.c.geocodeAttempts, func.md5(table.c.id + salt)]


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


_RETRY_AFTER = re.compile(r"[0-9]+(?:\.[0-9]+)?")


def _parse_retry_after(hint: str) -> float | None:
    """Seconds from a Retry-After header, or None. ASCII digits only: str.isdigit()
    accepts "²" and "٣", float() then raises."""
    hint = hint.strip()
    return float(hint) if _RETRY_AFTER.fullmatch(hint) else None


def _lookup(
    http: httpx.Client, token: str, q: str, attempts: int = REQUEST_ATTEMPTS
) -> tuple[float, float] | None:
    """(lng, lat) of the best match, None if there is none.

    Retries 429/5xx/network errors; raises _Retryable when they persist, _RowFailed
    for a non-retryable 4xx, an undecodable body or an unusable payload,
    GeocodeConfigError for a rejected token. No exception raised here carries the
    request URL (and so the token).
    """

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
            raise _Retryable(_redact(f"{type(e).__name__}: {e}", token)) from None
        except httpx.HTTPError as e:  # e.g. DecodingError (a gzip header on a plain body)
            raise _RowFailed(f"request error ({type(e).__name__})") from None
        code = r.status_code
        if code == 429 or code >= 500:
            raise _Retryable(
                f"HTTP {code}",
                _parse_retry_after(r.headers.get("Retry-After", "")),
                rate_limited=code == 429,
            )
        if code in (401, 403):
            raise GeocodeConfigError(f"Mapbox rejected the token (HTTP {code}); check MAPBOX_TOKEN") from None
        if code >= 400:
            raise _RowFailed(f"HTTP {code}")
        try:
            features = r.json().get("features") or []
            if not features:
                return None
            lng, lat = features[0]["center"]
            return (float(lng), float(lat))
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as e:
            raise _RowFailed(f"unusable response ({type(e).__name__})") from None

    for attempt in Retrying(
        retry=retry_if_exception(lambda e: isinstance(e, _Retryable)),
        stop=stop_after_attempt(attempts),
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
    order_salt: str | None = None,
) -> GeocodeSummary:
    """Geocode up to `limit` rows. Returns the outcome counts.

    Bound for a row Mapbox only ever answers with 5xx/network errors: it is never
    charged, so it stays selectable and costs about REQUEST_ATTEMPTS requests (with
    backoff) each time it is reached first, and the pass reports "unavailable" (exit
    75) when nothing else was answered. That is deliberate: a dead service must not
    use up the attempt budget of rows that were never at fault.
    """
    cfg = load_config()
    if not cfg.mapbox_token:
        raise GeocodeConfigError("MAPBOX_TOKEN is not set")

    relabelled = mark_inline_pending()
    if relabelled:
        log.info("relabelled pending rows that already had coordinates as inline count=%d", relabelled)

    table = listing_table()
    with session() as s:
        rows = s.execute(
            select(table.c.id, table.c.street, table.c.houseNumber, table.c.district)
            .where(
                table.c.geocodeStatus.in_(["pending", "failed"]),
                or_(table.c.lat.is_(None), table.c.lng.is_(None)),
                table.c.geocodeAttempts < max_attempts,
            )
            .order_by(*_order_by(table, _new_salt() if order_salt is None else order_salt))
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
            # Guarded: an `update` may have upserted inline coordinates while we waited
            # on Mapbox; never overwrite those (or a row someone already resolved).
            .where(
                or_(table.c.lat.is_(None), table.c.lng.is_(None)),
                # (not IN: expanding parameters can't be used with executemany)
                or_(table.c.geocodeStatus == "pending", table.c.geocodeStatus == "failed"),
            )
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

    # Rows that got no answer: an exhausted 5xx/network retry ("retry") or an unexpected
    # error of ours ("error"). They are not charged yet. A *later answered row* proves
    # they were at fault (charge them); a streak of OUTAGE_ROW_LIMIT proves the service
    # or our connection is down (charge nobody, stop); a streak that simply runs to the
    # end of the pass proves nothing (charge nobody). So a handful of pending rows and
    # an offline machine can never exhaust their attempts.
    held: list[tuple[str, str, bool]] = []  # (row id, kind, got the full retry budget)
    answered = 0

    def charge_held() -> None:
        # Only rows that got the full retry budget: a row tried once (after a streak had
        # started) may just have hit the same blip, so it is left for the next pass.
        for held_id, _kind, full in held:
            if full:
                summary.failed += 1
                pending.append(_outcome(held_id, None, None, None, "failed"))
        held.clear()

    def streak_verdict() -> None:
        if any(kind == "retry" for _, kind, _ in held):
            summary.unavailable = True
        else:
            summary.internal_error = True

    http = client or httpx.Client(timeout=15)
    try:
        for row_id, street, house, district in rows:
            q = _query(street, house, str(district))
            # Once a streak has started, don't spend the full retry/backoff budget on
            # every further row: one try each is enough to tell whether it is over.
            attempts = 1 if held else REQUEST_ATTEMPTS
            full_budget = attempts == REQUEST_ATTEMPTS
            try:
                hit = _lookup(http, cfg.mapbox_token, q, attempts)
            except GeocodeConfigError as e:
                e.summary = summary  # what was stored before the token was rejected
                raise
            except _Retryable as e:
                if e.rate_limited:
                    # Sustained 429: stop, keep this row's attempts (rate limiting says
                    # nothing about the row) and let a later pass pick up from here.
                    summary.rate_limited = True
                    log.warning("geocode rate limited, stopping pass id=%s error=%s", row_id, e)
                    break
                log.warning("geocode retries exhausted id=%s query=%r error=%s", row_id, q, e)
                held.append((row_id, "retry", full_budget))
            except _RowFailed as e:
                answered += 1
                log.warning("geocode failed id=%s query=%r error=%s", row_id, q, e)
                summary.failed += 1
                pending.append(_outcome(row_id, None, None, None, "failed"))
                charge_held()
            except Exception as e:  # noqa: BLE001
                # Whatever else goes wrong with one row must not abort the pass. Log only
                # the type: the message could carry the URL. Held, not charged: if every
                # row blows up it is our bug, not the rows' fault.
                log.warning("geocode unexpected error id=%s error=%s", row_id, type(e).__name__)
                held.append((row_id, "error", full_budget))
            else:
                answered += 1
                now = datetime.now(timezone.utc)
                if hit is not None and _inside(*hit):
                    summary.ok += 1
                    pending.append(_outcome(row_id, hit[1], hit[0], now, "ok"))
                else:
                    if hit is not None:
                        log.info("geocode result outside inner Stockholm id=%s query=%r", row_id, q)
                    summary.not_found += 1
                    pending.append(_outcome(row_id, None, None, now, "not_found"))
                charge_held()
            if len(held) >= OUTAGE_ROW_LIMIT:
                streak_verdict()
                log.warning(
                    "geocode pass stopped after %d consecutive rows without an answer "
                    "unavailable=%s internal_error=%s",
                    len(held), summary.unavailable, summary.internal_error,
                )
                held.clear()  # not charged
                break
            if len(pending) >= write_batch_size:
                flush()
            _sleep(_POLITE_PAUSE)
        else:
            if held and answered == 0:
                streak_verdict()  # nothing in the whole pass got an answer
    finally:
        flush()  # keep what was geocoded even if a fatal error (bad token) aborts the pass
        if client is None:
            http.close()
    log.info(
        "geocode pass done ok=%d not_found=%d failed=%d rate_limited=%s unavailable=%s internal_error=%s",
        summary.ok, summary.not_found, summary.failed, summary.rate_limited,
        summary.unavailable, summary.internal_error,
    )
    return summary


def _outcome(row_id: str, lat: float | None, lng: float | None, at, status: str) -> dict:
    return {"b_id": row_id, "b_lat": lat, "b_lng": lng, "b_at": at, "b_status": status}
