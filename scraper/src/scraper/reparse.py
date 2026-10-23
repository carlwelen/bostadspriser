"""Re-derive parsed Listing columns from the stored `raw` card.

When a parser improves (address splitting, price rules, ...) already-stored rows
keep their old values until re-scraped, and old sales are no longer reachable on
the live pages. `raw` holds the original card, so we can re-run each source's
own `card_fields` over it instead.

Idempotent: a row is only written when a derived value differs from what is
stored, so a second run changes nothing. Rows whose card no longer parses are
reported, never deleted or rewritten.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Callable

from sqlalchemy import bindparam, select, update

from . import booli, hemnet
from .db import listing_table, session

# Source slug -> card -> Listing columns. New sources register here.
_DERIVERS: dict[str, Callable[[dict, str], dict | None]] = {
    "hemnet": hemnet.card_fields,
    "booli": booli.card_fields,
}

# Columns reparse owns. Everything else (ids, coordinates, timestamps, raw) is
# left alone. soldAt is re-derived too: raw is authoritative (the Stockholm-zone
# fix landed after some rows were stored), and dedupKey is computed from the
# derived date, so leaving the stored date would make the two disagree.
FIELDS = (
    "street",
    "houseNumber",
    "rooms",
    "areaSqm",
    "priceSek",
    "pricePerSqmSek",
    "soldAt",
    "dedupKey",
)

_MAX_EXAMPLES = 5
_MAX_UNPARSEABLE_SAMPLES = 20


@dataclass
class ReparseSummary:
    scanned: int = 0
    changed: int = 0
    by_field: Counter = field(default_factory=Counter)
    # (id, field, old, new)
    examples: list[tuple[str, str, Any, Any]] = field(default_factory=list)
    # (id, source, reason) — capped sample; the full count is `unparseable`.
    unparseable_samples: list[tuple[str, str, str]] = field(default_factory=list)
    unparseable: int = 0
    # Rows whose stored soldAt differed from the one in `raw` (also counted in by_field).
    sold_at_mismatch: int = 0
    dry_run: bool = False


def _same(old: Any, new: Any) -> bool:
    """Compare a stored value with a derived one across Decimal/float/int."""
    if old is None or new is None:
        return old is None and new is None
    if isinstance(old, Decimal) or isinstance(new, Decimal):
        return Decimal(str(old)) == Decimal(str(new))
    return old == new


def reparse(*, dry_run: bool = False, batch_size: int = 1000) -> ReparseSummary:
    """Re-derive FIELDS for every row from its `raw` card, in id-keyset batches.

    Rows inserted mid-run with an id below the keyset cursor are not seen by this
    run; they are picked up by the next one (and a fresh insert is already
    derived by the current parsers anyway).
    """
    if batch_size < 1:
        raise ValueError("batch_size must be >= 1")
    table = listing_table()
    summary = ReparseSummary(dry_run=dry_run)
    cols = [table.c.id, table.c.source, table.c.district, table.c.raw]
    cols += [table.c[f] for f in FIELDS]
    write = update(table).where(table.c.id == bindparam("b_id")).values(
        {f: bindparam(f"n_{f}") for f in FIELDS}
    )

    last_id: str | None = None
    while True:
        query = select(*cols).order_by(table.c.id).limit(batch_size)
        if last_id is not None:
            query = query.where(table.c.id > last_id)
        if not dry_run:
            # Lock the batch so a concurrent `update` can't upsert a newer raw
            # between this SELECT and our UPDATE (we'd overwrite it with values
            # derived from the older card). The upsert waits, then wins.
            query = query.with_for_update()
        with session() as s:
            rows = s.execute(query).all()
            if not rows:
                break
            last_id = rows[-1].id

            updates: list[dict] = []
            for row in rows:
                summary.scanned += 1
                deriver = _DERIVERS.get(row.source)
                if deriver is None:
                    _note_unparseable(summary, row, f"unknown source {row.source!r}")
                    continue
                derived = deriver(row.raw, str(row.district)) if isinstance(row.raw, dict) else None
                if derived is None:
                    _note_unparseable(summary, row, "raw card no longer parses")
                    continue
                changed = [f for f in FIELDS if not _same(getattr(row, f), derived[f])]
                if "soldAt" in changed:
                    summary.sold_at_mismatch += 1
                if not changed:
                    continue
                summary.changed += 1
                for f in changed:
                    summary.by_field[f] += 1
                    if len(summary.examples) < _MAX_EXAMPLES:
                        summary.examples.append((row.id, f, getattr(row, f), derived[f]))
                updates.append({"b_id": row.id, **{f"n_{f}": derived[f] for f in FIELDS}})

            if updates and not dry_run:
                s.execute(write, updates)
                s.commit()
    return summary


def _note_unparseable(summary: ReparseSummary, row: Any, reason: str) -> None:
    summary.unparseable += 1
    if len(summary.unparseable_samples) < _MAX_UNPARSEABLE_SAMPLES:
        summary.unparseable_samples.append((row.id, row.source, reason))


def format_summary(summary: ReparseSummary) -> str:
    """Human-readable report for the CLI."""
    verb = "would change" if summary.dry_run else "changed"
    lines = [
        f"{'DRY RUN: nothing written. ' if summary.dry_run else ''}"
        f"scanned {summary.scanned} rows, {verb} {summary.changed}",
    ]
    for f in FIELDS:
        if summary.by_field[f]:
            lines.append(f"  {f:16} {summary.by_field[f]:>7}")
    if summary.examples:
        lines.append("examples (id, field: old -> new):")
        for row_id, f, old, new in summary.examples:
            lines.append(f"  {row_id} {f}: {old!r} -> {new!r}")
    if summary.sold_at_mismatch:
        lines.append(f"{summary.sold_at_mismatch} rows had a soldAt that differed from raw")
    if summary.unparseable:
        lines.append(f"{summary.unparseable} rows no longer parse (left untouched):")
        for row_id, source, reason in summary.unparseable_samples:
            lines.append(f"  {source} {row_id}: {reason}")
        if summary.unparseable > len(summary.unparseable_samples):
            lines.append(f"  ... and {summary.unparseable - len(summary.unparseable_samples)} more")
    return "\n".join(lines)
