"""One-shot: populate `dedupKey` on existing rows.

Idempotent — only touches rows where dedupKey IS NULL. Safe to re-run after
adding new sources or fixing a normalization bug.
"""

from __future__ import annotations

from sqlalchemy import select, update

from .db import listing_table, session
from .normalize import dedup_key


def backfill_dedup_keys(batch_size: int = 1000) -> int:
    table = listing_table()
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
                .limit(batch_size)
            ).all()

        if not rows:
            break

        for row in rows:
            key = dedup_key(row.street, row.houseNumber, row.soldAt, int(row.priceSek))
            with session() as s:
                s.execute(
                    update(table).where(table.c.id == row.id).values(dedupKey=key)
                )
                s.commit()
            updated += 1

    return updated


if __name__ == "__main__":
    n = backfill_dedup_keys()
    print(f"backfilled {n} rows")
