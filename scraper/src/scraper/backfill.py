"""One-shot: populate `dedupKey` on existing rows (run it as `scraper backfill-dedup`).

Idempotent — only touches rows where dedupKey IS NULL. Safe to re-run after
adding new sources or fixing a normalization bug.
"""

from __future__ import annotations

from sqlalchemy import bindparam, select, update

from .db import listing_table, session
from .normalize import dedup_key


def backfill_dedup_keys(batch_size: int = 1000) -> int:
    """Fill dedupKey where NULL, one transaction (and one executemany) per batch."""
    if batch_size < 1:
        raise ValueError("batch_size must be >= 1")
    table = listing_table()
    write = update(table).where(table.c.id == bindparam("b_id")).values(dedupKey=bindparam("b_key"))
    updated = 0

    while True:
        with session() as s:
            rows = s.execute(
                select(
                    table.c.id,
                    table.c.street,
                    table.c.houseNumber,
                    table.c.soldAt,
                    table.c.priceSek,
                )
                .where(table.c.dedupKey.is_(None))
                .order_by(table.c.id)
                .limit(batch_size)
            ).all()
            if not rows:
                break
            s.execute(
                write,
                [
                    {
                        "b_id": r.id,
                        "b_key": dedup_key(r.street, r.houseNumber, r.soldAt, int(r.priceSek)),
                    }
                    for r in rows
                ],
            )
            s.commit()
        updated += len(rows)

    return updated
