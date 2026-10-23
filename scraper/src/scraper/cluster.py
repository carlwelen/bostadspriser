"""Fuzzy cross-source matcher: assigns `Listing.clusterId` (B13).

`dedupKey` collapses the same sale seen by two sources only when street, house
number, sale date AND price agree exactly. Sources often disagree by a day on the
date or a few thousand kronor on the price, so such copies slip through and are
double-counted. This matcher links them:

    same normalized address (normalize.normalize_address), different sources,
    |soldAt difference| <= 3 days, prices within 0.5% of each other.

Every copy of one real-world sale then shares a `clusterId`, which `DedupedListing`
groups on. Rules the view relies on:

* All rows sharing a `dedupKey` share one `clusterId` (they are the same sale by
  construction). The matcher works on dedupKey groups, not single rows, and also
  propagates a cluster to rows that arrived later with the same dedupKey.
* `clusterId` is the smallest `dedupKey` in the cluster: deterministic, so a re-run
  changes nothing and merging two clusters always lands on the same id (rows of the
  cluster that doesn't hold the smallest key are the ones rewritten).
* Rows without a dedupKey are left alone (`scraper backfill-dedup` fills those first).
* The address comparison is exactly normalize_address(): "S:t Eriksgatan" and
  "Sankt Eriksgatan" stay different until the slug/fold consolidation (B22/B23).

Pair candidates are found in SQL (a self-join on a coarse address key plus the date
and price windows) and verified in Python with the exact rule; the connected
components are then written back in batches. Idempotent.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy import text

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
    "'åäöéè', 'aaoee'), '[^a-z0-9]', '', 'g')"
)

_PAIRS_SQL = text(
    f"""
    SELECT a."dedupKey" AS a_key, a."clusterId" AS a_cid, a.street AS a_street,
           a."houseNumber" AS a_house, a."soldAt" AS a_sold, a."priceSek" AS a_price,
           a.source AS a_source,
           b."dedupKey" AS b_key, b."clusterId" AS b_cid, b.street AS b_street,
           b."houseNumber" AS b_house, b."soldAt" AS b_sold, b."priceSek" AS b_price,
           b.source AS b_source
    FROM "Listing" a
    JOIN "Listing" b
      ON a.source < b.source
     AND {_SQL_ADDRESS_KEY % {"a": "a"}} = {_SQL_ADDRESS_KEY % {"a": "b"}}
     AND abs(a."soldAt" - b."soldAt") <= {MAX_DAYS}
     AND abs(a."priceSek" - b."priceSek") * {MAX_PRICE_DIFF_INVERSE} <= greatest(a."priceSek", b."priceSek")
    WHERE a."dedupKey" IS NOT NULL AND b."dedupKey" IS NOT NULL
      AND a."priceSek" > 0 AND b."priceSek" > 0
      AND (a."clusterId" IS DISTINCT FROM b."clusterId"
           OR (a."clusterId" IS NULL AND a."dedupKey" <> b."dedupKey"))
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


def dedup_keys_in_multiple_clusters() -> list[tuple[str, list[str]]]:
    """dedupKeys whose rows carry more than one clusterId: an invariant violation
    (the same sale split over clusters). The Python twin of the web check."""
    with session() as s:
        rows = s.execute(
            text(
                'SELECT "dedupKey", array_agg(DISTINCT "clusterId" ORDER BY "clusterId") '
                'FROM "Listing" WHERE "dedupKey" IS NOT NULL AND "clusterId" IS NOT NULL '
                'GROUP BY "dedupKey" HAVING COUNT(DISTINCT "clusterId") > 1 ORDER BY "dedupKey"'
            )
        ).all()
    return [(key, list(cids)) for key, cids in rows]


def match_clusters(*, dry_run: bool = False, batch_size: int = 500) -> ClusterSummary:
    """Link cross-source copies of the same sale; see the module docstring."""
    if batch_size < 1:
        raise ValueError("batch_size must be >= 1")
    summary = ClusterSummary(dry_run=dry_run)

    uf = _UnionFind()
    with session() as s:
        for row in s.execute(_PAIRS_SQL).mappings():
            if not _is_match(row):
                continue
            summary.pairs += 1
            ka, kb = f"k:{row['a_key']}", f"k:{row['b_key']}"
            uf.union(ka, kb)
            for key, cid in ((ka, row["a_cid"]), (kb, row["b_cid"])):
                if cid is not None:
                    uf.union(key, f"c:{cid}")

        if summary.pairs:
            _close_over_existing_clusters(s, uf)

    components: dict[str, list[str]] = {}
    for node in list(uf.parent):
        components.setdefault(uf.find(node), []).append(node)

    work: list[tuple[str, list[str], list[str]]] = []  # (target, keys, old clusterIds)
    for nodes in components.values():
        keys = sorted(n[2:] for n in nodes if n.startswith("k:"))
        cids = sorted(n[2:] for n in nodes if n.startswith("c:"))
        if keys:
            work.append((keys[0], keys, cids))
    work.sort()

    for start in range(0, len(work), batch_size):
        with session() as s:
            for target, keys, cids in work[start : start + batch_size]:
                changed = _assign(s, target, keys, cids, dry_run)
                if changed:
                    summary.components += 1
                    summary.rows_updated += changed
                    if len(summary.examples) < 5:
                        summary.examples.append((target, keys))
            if not dry_run:
                s.commit()

    # Late exact copies: a row that arrived with the dedupKey of a clustered row but
    # no clusterId of its own (the view already treats it as clustered).
    with session() as s:
        propagate_sql = (
            'FROM "Listing" l JOIN (SELECT "dedupKey", MIN("clusterId") AS cid FROM "Listing" '
            'WHERE "clusterId" IS NOT NULL AND "dedupKey" IS NOT NULL GROUP BY "dedupKey") k '
            'ON k."dedupKey" = l."dedupKey" WHERE l."clusterId" IS NULL'
        )
        if dry_run:
            summary.propagated = s.execute(text(f"SELECT COUNT(*) {propagate_sql}")).scalar_one()
        else:
            summary.propagated = s.execute(
                text(
                    'UPDATE "Listing" SET "clusterId" = k.cid FROM (SELECT "dedupKey", MIN("clusterId") AS cid '
                    'FROM "Listing" WHERE "clusterId" IS NOT NULL AND "dedupKey" IS NOT NULL GROUP BY "dedupKey") k '
                    'WHERE k."dedupKey" = "Listing"."dedupKey" AND "Listing"."clusterId" IS NULL'
                )
            ).rowcount
            s.commit()
    summary.rows_updated += summary.propagated

    summary.violations = dedup_keys_in_multiple_clusters()
    log.info(
        "cluster pass done pairs=%d clusters=%d rows_updated=%d violations=%d dry_run=%s",
        summary.pairs, summary.components, summary.rows_updated, len(summary.violations), dry_run,
    )
    return summary


def _close_over_existing_clusters(s, uf: _UnionFind) -> None:
    """Pull every row of each touched cluster / dedupKey into the graph, until it stops
    growing: merging must see the clusters' whole membership, not just the matched rows."""
    known_keys: set[str] = set()
    known_cids: set[str] = set()
    while True:
        keys = {n[2:] for n in uf.parent if n.startswith("k:")}
        cids = {n[2:] for n in uf.parent if n.startswith("c:")}
        if keys == known_keys and cids == known_cids:
            return
        known_keys, known_cids = keys, cids
        rows = s.execute(
            text(
                'SELECT DISTINCT "dedupKey", "clusterId" FROM "Listing" '
                'WHERE "dedupKey" = ANY(:keys) OR "clusterId" = ANY(:cids)'
            ),
            {"keys": sorted(keys), "cids": sorted(cids)},
        ).all()
        for key, cid in rows:
            if key is not None:
                uf.find(f"k:{key}")
            if cid is not None:
                uf.find(f"c:{cid}")
            if key is not None and cid is not None:
                uf.union(f"k:{key}", f"c:{cid}")


def _assign(s, target: str, keys: list[str], cids: list[str], dry_run: bool) -> int:
    """Give every row of the component `target` as its clusterId. Returns rows changed."""
    where = (
        '("dedupKey" = ANY(:keys) OR "clusterId" = ANY(:cids)) '
        'AND "clusterId" IS DISTINCT FROM :target'
    )
    params = {"keys": keys, "cids": cids, "target": target}
    if dry_run:
        return s.execute(text(f'SELECT COUNT(*) FROM "Listing" WHERE {where}'), params).scalar_one()
    return s.execute(text(f'UPDATE "Listing" SET "clusterId" = :target WHERE {where}'), params).rowcount
