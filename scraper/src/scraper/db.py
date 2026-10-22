from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import MetaData, Table, create_engine
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import load_config

_engine: Engine | None = None
_metadata: MetaData | None = None
_SessionLocal: sessionmaker[Session] | None = None


def engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        cfg = load_config()
        # Prisma writes plain `postgresql://`; SQLAlchemy defaults that to psycopg2.
        # We installed psycopg (3), so steer SQLAlchemy to its psycopg3 dialect.
        url = cfg.database_url
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]
        _engine = create_engine(url, future=True, pool_pre_ping=True)
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


def upsert_listing(row: dict) -> None:
    """Insert or update by (source, sourceId) — idempotent re-scrapes."""
    table = listing_table()
    stmt = pg_insert(table).values(**row)
    update_cols = {c: stmt.excluded[c] for c in row.keys() if c not in {"source", "sourceId", "id"}}
    stmt = stmt.on_conflict_do_update(
        index_elements=["source", "sourceId"], set_=update_cols
    )
    with session() as s:
        s.execute(stmt)
        s.commit()
