from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import MetaData, Table, and_, case, create_engine, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker

from .config import load_config

_engine: Engine | None = None
_metadata: MetaData | None = None
_SessionLocal: sessionmaker[Session] | None = None


def pg_options(url: str) -> str:
    """libpq `options` for every connection: the URL's own `options` (if any),
    then `-c timezone=UTC`. connect_args would otherwise replace the URL's value;
    ours comes last so it wins over any timezone set there."""
    existing = make_url(url).query.get("options")
    if isinstance(existing, tuple):
        existing = " ".join(existing)
    return f"{existing} -c timezone=UTC" if existing else "-c timezone=UTC"


def engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        cfg = load_config()
        # Prisma writes plain `postgresql://`; SQLAlchemy defaults that to psycopg2.
        # We installed psycopg (3), so steer SQLAlchemy to its psycopg3 dialect.
        url = cfg.database_url
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]
        # Prisma's timestamp(3) columns have no zone, so what an aware datetime
        # becomes depends on the session TimeZone. Pin it to UTC (Prisma's
        # convention) instead of trusting the server default.
        _engine = create_engine(
            url,
            future=True,
            pool_pre_ping=True,
            connect_args={"options": pg_options(url)},
        )
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def listing_table() -> Table:
    """Reflect the Listing table managed by Prisma migrations."""
    global _metadata
    if _metadata is None:
        _metadata = MetaData()
        _metadata.reflect(bind=engine(), only=["Listing"])
    return _metadata.tables["Listing"]


@contextmanager
def session() -> Iterator[Session]:
    if _SessionLocal is None:
        engine()
    assert _SessionLocal is not None
    with _SessionLocal() as s:
        yield s


# Never overwritten on conflict: the natural key and the primary key.
_CONFLICT_KEPT = frozenset({"source", "sourceId", "id"})
_COORDINATE_COLS = frozenset({"lat", "lng", "geocodedAt"})
# Stamped by the database, never taken from the caller: scrapedAt/lastSeenAt.
_SERVER_STAMPED = frozenset({"scrapedAt", "lastSeenAt"})


def upsert_listing(row: dict) -> None:
    """Insert or update by (source, sourceId) — idempotent re-scrapes."""
    upsert_listings([row])


DEFAULT_BATCH_SIZE = 100


def upsert_listings(rows: list[dict], batch_size: int = DEFAULT_BATCH_SIZE) -> int:
    """Insert or update many rows by (source, sourceId), one transaction per batch.

    Each batch is a single multi-row INSERT ... ON CONFLICT DO UPDATE, so a failure
    rolls back that batch only; batches already committed stay. Postgres refuses
    to affect the same row twice in one statement, so duplicate natural keys
    inside a batch are collapsed first (the last row wins, keeping the first
    row's id). Returns the number of distinct rows written.
    """
    if batch_size < 1:
        raise ValueError("batch_size must be >= 1")
    written = 0
    for start in range(0, len(rows), batch_size):
        batch = _collapse_duplicates(rows[start : start + batch_size])
        # One statement needs one column set; rows from the parsers always share
        # it, but group defensively so a row missing e.g. lat/lng still works.
        groups: dict[frozenset[str], list[dict]] = {}
        for r in batch:
            groups.setdefault(frozenset(r), []).append(r)
        with session() as s:
            for group in groups.values():
                s.execute(_upsert_stmt(group))
            s.commit()
        written += len(batch)
    return written


def _has_coords(row: dict) -> bool:
    return row.get("lat") is not None and row.get("lng") is not None


def _collapse_duplicates(batch: list[dict]) -> list[dict]:
    """Last row wins per (source, sourceId), as if the rows were upserted one by one.

    So the first occurrence's id is kept, and an earlier row's coordinates survive
    a later row that has none (the same rule the ON CONFLICT clause applies)."""
    merged: dict[tuple, dict] = {}
    for r in batch:
        key = (r["source"], r["sourceId"])
        prev = merged.get(key)
        if prev is not None:
            if "id" in prev:
                r = {**r, "id": prev["id"]}
            if _has_coords(prev) and not _has_coords(r):
                r = {**r, **{c: prev[c] for c in _COORDINATE_COLS if c in prev and c in r}}
        merged[key] = r
    return list(merged.values())


def _upsert_stmt(rows: list[dict]):
    table = listing_table()
    stmt = pg_insert(table).values(rows)
    cols = rows[0].keys()
    update_cols = {
        c: stmt.excluded[c]
        for c in cols
        if c not in _CONFLICT_KEPT | _COORDINATE_COLS | _SERVER_STAMPED
    }
    # Every sighting bumps lastSeenAt (the view's tie-breaker); scrapedAt keeps
    # the first insert. The session is pinned to UTC, so now() lands as UTC.
    update_cols["lastSeenAt"] = func.now()
    # A re-scrape without coordinates must not wipe good (or geocoded) ones:
    # the lat/lng/geocodedAt trio is replaced together, and only when the
    # incoming row carries a complete lat+lng pair. Evaluated per row.
    if "lat" in cols and "lng" in cols:
        has_coords = and_(stmt.excluded["lat"].is_not(None), stmt.excluded["lng"].is_not(None))
        for c in _COORDINATE_COLS & cols:
            update_cols[c] = case((has_coords, stmt.excluded[c]), else_=table.c[c])
    return stmt.on_conflict_do_update(index_elements=["source", "sourceId"], set_=update_cols)
