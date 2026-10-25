"""Fuzzy cross-source matcher: assigns `Listing.clusterId` (B13).

`dedupKey` collapses the same sale seen by two sources only when street, house
number, sale date AND price agree exactly. Sources often disagree by a day on the
date or a few thousand kronor on the price, so such copies slip through and are
double-counted. This matcher links them:

    same normalized address (normalize.normalize_address), different sources,
    |soldAt difference| <= 3 days, prices within 0.5% of each other,
    areas within 1 sqm or 2%, rooms within 0.5 (when both are known).

Every copy of one real-world sale then shares a `clusterId`, which `DedupedListing`
groups on. Rules the view relies on:

* All rows sharing a `dedupKey` share one `clusterId` (they are the same sale by
  construction). The matcher works on dedupKey groups, not single rows, and also
  propagates a cluster to rows that arrived later with the same dedupKey.
* `clusterId` is the smallest `dedupKey` in the cluster: deterministic, so a re-run
  changes nothing.
* Rows without a dedupKey are left alone (`scraper backfill-dedup` fills those first).
* The address comparison is exactly normalize_address(): "S:t Eriksgatan" and
  "Sankt Eriksgatan" stay different until the slug/fold consolidation (B22/B23).

Pair candidates are found in SQL (a self-join on a coarse address key plus the date
and price windows) and verified in Python with the exact rule. Candidates are
processed closest-first (date, then relative price difference). Components never
contain distinct keys from one source. Every run rebuilds from current facts and
writes only changed rows, so corrections also undo obsolete clusters.
"""

from __future__ import annotations

import logging
from contextlib import nullcontext
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import session
from .normalize import normalize_address

log = logging.getLogger("scraper.cluster")

MAX_DAYS = 3
# |p1 - p2| <= 0.5% of the larger price, written as an integer comparison.
MAX_PRICE_DIFF_INVERSE = 200

# A coarse SQL version of normalize_address(): lowercase, fold å/ä/ö/é/è, keep [a-z0-9].
# Python additionally keeps other Unicode letters, so equal Python keys are always
# equal here: this only ever *over*-selects, and every pair is re-checked in Python.
_SQL_ADDRESS_KEY = (
    "regexp_replace(translate(lower(%(a)s.street || ' ' || coalesce(%(a)s.\"houseNumber\", '')), "
    "'åäöéèÅÄÖÉÈ', 'aaoeeaaoee'), '[^a-z0-9]', '', 'g')"
)

_PAIRS_SQL = text(
    f"""
    SELECT a."dedupKey" AS a_key, a."clusterId" AS a_cid, a.street AS a_street,
           a."houseNumber" AS a_house, a."soldAt" AS a_sold, a."priceSek" AS a_price,
           a.source AS a_source, a."areaSqm" AS a_area, a.rooms AS a_rooms,
           b."dedupKey" AS b_key, b."clusterId" AS b_cid, b.street AS b_street,
           b."houseNumber" AS b_house, b."soldAt" AS b_sold, b."priceSek" AS b_price,
           b.source AS b_source, b."areaSqm" AS b_area, b.rooms AS b_rooms
    FROM "Listing" a
    JOIN "Listing" b
      ON a.source < b.source
     AND {_SQL_ADDRESS_KEY % {"a": "a"}} = {_SQL_ADDRESS_KEY % {"a": "b"}}
     AND abs(a."soldAt" - b."soldAt") <= {MAX_DAYS}
     AND abs(a."priceSek" - b."priceSek") * {MAX_PRICE_DIFF_INVERSE} <= greatest(a."priceSek", b."priceSek")
    WHERE a."dedupKey" IS NOT NULL AND b."dedupKey" IS NOT NULL
      AND a."priceSek" > 0 AND b."priceSek" > 0

    """
)


@dataclass
class ClusterSummary:
    dry_run: bool = False
    pairs: int = 0  # verified cross-source pairs that are not yet in one cluster
    components: int = 0  # clusters that need (re)writing
    rows_updated: int = 0  # rows whose clusterId was (or, in a dry run, would be) set
    propagated: int = 0  # rows given their dedupKey group's cluster
    # (dedupKey, [clusterId, ...]) still spread over several clusters afterwards
    violations: list[tuple[str, list[str]]] = field(default_factory=list)
    examples: list[tuple[str, list[str]]] = field(default_factory=list)  # (clusterId, member keys)


def _is_match(p: dict) -> bool:
    """The exact rule, on one candidate pair (the SQL only pre-selects)."""
    if p["a_source"] == p["b_source"]:
        return False
    if normalize_address(p["a_street"], p["a_house"]) != normalize_address(p["b_street"], p["b_house"]):
        return False
    if abs((p["a_sold"] - p["b_sold"]).days) > MAX_DAYS:
        return False
    if p["a_area"] is not None and p["b_area"] is not None:
        difference = abs(p["a_area"] - p["b_area"])
        if difference > 1 and difference * 50 > max(p["a_area"], p["b_area"]):
            return False
    if p["a_rooms"] is not None and p["b_rooms"] is not None:
        if abs(p["a_rooms"] - p["b_rooms"]) > 0.5:
            return False
    hi, lo = max(p["a_price"], p["b_price"]), min(p["a_price"], p["b_price"])
    return lo > 0 and (hi - lo) * MAX_PRICE_DIFF_INVERSE <= hi


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def dedup_keys_in_multiple_clusters(*, transaction: Session | None = None) -> list[tuple[str, list[str]]]:
    """dedupKeys whose rows carry more than one clusterId: an invariant violation
    (the same sale split over clusters). The Python twin of the web check."""
    with nullcontext(transaction) if transaction is not None else session() as s:
        rows = s.execute(
            text(
                'SELECT "dedupKey", array_agg(DISTINCT "clusterId" ORDER BY "clusterId") '
                'FROM "Listing" WHERE "dedupKey" IS NOT NULL AND "clusterId" IS NOT NULL '
                'GROUP BY "dedupKey" HAVING COUNT(DISTINCT "clusterId") > 1 ORDER BY "dedupKey"'
            )
        ).all()
    return [(key, list(cids)) for key, cids in rows]


def match_clusters(
    *, dry_run: bool = False, batch_size: int = 500, transaction: Session | None = None,
) -> ClusterSummary:
    """Link cross-source copies; optionally join the caller's correction transaction.

    With a transaction, the caller owns commit/rollback so listing corrections
    and their rebuilt groups become visible together, including partial runs.
    """
    if batch_size < 1:
        raise ValueError("batch_size must be >= 1")
    summary = ClusterSummary(dry_run=dry_run)

    # Rebuild from current facts, never from old clusterIds: corrected records
    # must be able to leave a previously valid cluster.
    uf = _UnionFind()
    with nullcontext(transaction) if transaction is not None else session() as s:
        rows = list(s.execute(text(
            'SELECT id, source, "dedupKey", "clusterId" FROM "Listing" '
            'WHERE "dedupKey" IS NOT NULL'
        )).mappings())
        sources: dict[str, dict[str, str]] = {}
        by_key: dict[str, list] = {}
        for row in rows:
            key = row["dedupKey"]
            uf.find(key)
            sources.setdefault(key, {})[row["source"]] = key
            by_key.setdefault(key, []).append(row)
        candidates = [p for p in s.execute(_PAIRS_SQL).mappings() if _is_match(p)]
        candidates.sort(key=lambda p: (
            abs((p["a_sold"] - p["b_sold"]).days),
            abs(p["a_price"] - p["b_price"]) / max(p["a_price"], p["b_price"]),
            min(p["a_key"], p["b_key"]), max(p["a_key"], p["b_key"]),
        ))
        for pair in candidates:
            a, b = uf.find(pair["a_key"]), uf.find(pair["b_key"])
            if a != b:
                if any(source in sources[b] and sources[b][source] != key
                       for source, key in sources[a].items()):
                    continue
                combined = sources[a] | sources[b]
                uf.union(a, b)
                sources[uf.find(a)] = combined
            if pair["a_cid"] != pair["b_cid"] or pair["a_cid"] is None:
                summary.pairs += 1

        components: dict[str, list[str]] = {}
        for key in by_key:
            components.setdefault(uf.find(key), []).append(key)
        changes = []
        for root, keys in sorted(components.items()):
            members = [row for key in keys for row in by_key[key]]
            target = root if len(members) > 1 else None
            changed = [row for row in members if row["clusterId"] != target]
            if changed:
                summary.components += 1
                summary.rows_updated += len(changed)
                inherited_keys = {row["dedupKey"] for row in members
                                  if target is not None and row["clusterId"] == target}
                summary.propagated += sum(row["clusterId"] is None and row["dedupKey"] in inherited_keys
                                          for row in changed)
                if len(summary.examples) < 5:
                    summary.examples.append((target or root, sorted(keys)))
                changes.extend({"id": row["id"], "target": target} for row in changed)
        if not dry_run:
            for start in range(0, len(changes), batch_size):
                s.execute(text('UPDATE "Listing" SET "clusterId" = :target WHERE id = :id'),
                          changes[start:start + batch_size])
            if transaction is None:
                s.commit()

        summary.violations = dedup_keys_in_multiple_clusters(transaction=s)
    log.info(
        "cluster pass done pairs=%d clusters=%d rows_updated=%d violations=%d dry_run=%s",
        summary.pairs, summary.components, summary.rows_updated, len(summary.violations), dry_run,
    )
    return summary
