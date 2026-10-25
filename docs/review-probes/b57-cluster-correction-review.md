# B57 independent adversarial review

**Verdict: APPROVE** — immutable task commit `023a8c2528c9b9cdc02a7694c4d6e1c7624fd4ca`.

Reviewed parent `582efba` only as the preparation baseline. Integrate **only the task commit**; never merge the preparation ancestor. Source worktree and main were read-only. Review used a detached scratch worktree `/tmp/review-b57`, isolated database `bostadspriser_test_r_b57`, and no live provider or geocoder operations.

## Findings

No blocker or major correctness finding. The original audit's explicit scrape/backfill/reparse price-correction failures are fixed. Every matcher input is covered; null-key corrections, exact-copy inheritance, source safety, pruning, legacy key backfill, partial committed batches, original exception preservation, and failed current-batch rollback passed real SQL probes.

**Minor, separate performance follow-up — `scraper/src/scraper/db.py:107` and `:157`.** Every batch containing any changed match fact rebuilds the entire dataset while the batch's row locks remain held. Using a bounded offline 200,000-row fixture with the repository's synthetic data shape, the following timings were measured on the same machine (one run per tree):

| Operation | Parent production | B57 production |
| --- | ---: | ---: |
| Unchanged 100-row upsert | 0.055 s | 0.072 s |
| Corrected 100 rows, one batch | 0.046 s | 5.971 s |
| Corrected 300 rows, three batches | 0.118 s | 20.433 s |

The initial clustering/setup pass was 12.12 s on the parent and 14.45 s on B57 and is excluded from these upsert timings. The changes were compatible room corrections, so this measures repeated full-table matching even when the final valid clusters remain the same. Large reparse/backfill correction runs now pay one full rebuild per committed batch; bulk duration and CLI lock occupancy can become substantial. This is a real new cost, not a correctness rejection: unchanged/fresh ingestion skips rebuilding, reads retain their previous coherent snapshot, and no batch-latency SLA is specified. Track profiling/affected-component repair separately if bulk corrections are operationally frequent. Preserve atomic repair and exact-key/source-safe closure in any optimization. Logs and the executable timing probe are preserved here.

No other new backlog item is established by this B57 review. B58/B61 and other audit findings were excluded.

## Evidence

- **803/803 Python tests passed after restoring the immutable patch**: all 786 source tests plus 14 independent probes and the 3 original B57 audit cases. Command: `TEST_DB_NAME=bostadspriser_test_r_b57 E2E_PORT=3112 uv run pytest -q --ignore=tests/test_r_b57_perf.py`. Log: `full-pytest-restored.log`.
- An initial targeted source run also passed 72/72 cluster, correction, and reparse tests.
- The independent probes include real two-connection visibility, a second thread blocked on the same row's SQL lock and then completing its correction, rollback after cluster writes but before commit, caller-owned matcher rollback, and dry-run preservation of the caller's transaction. Independent pruning and legacy backfill probes verify the resulting **materialized** counts and retained original errors.
- The complete provided source gate was inspected and copied to `source-gate.log`: **543 Vitest, 348 Playwright, 786 pytest**, all green. The web gate was not independently repeated because this commit changes only scraper code/tests.
- Tracked production files were verified byte-identical to `023a8c2` after reversion restoration (`git diff --exit-code 023a8c2 -- scraper/src`). No source/main edits, commits, pushes, live requests, protected-directory writes, or non-test database mutations were made.

## Meaningful production reversion

Yes, the proving tests fail without the fix. Only the four production files were restored to the parent; all tests remained intact:

```sh
git checkout 023a8c2^ -- scraper/src/scraper/db.py scraper/src/scraper/cluster.py scraper/src/scraper/reparse.py scraper/src/scraper/backfill.py
cd scraper
TEST_DB_NAME=bostadspriser_test_r_b57 E2E_PORT=3112 uv run pytest -q tests/test_cluster_corrections.py tests/test_r_b57_original.py tests/test_r_b57_probe.py -k 'not transaction_caller and not transaction_dry'
```

**29 failed, 8 passed, 2 deselected** (`reversion.log`). These include 18 of the 22 source correction cases, all three original audit cases, and eight independent semantic probes. The two new transaction-signature tests were deliberately excluded from this reversion run, so missing new API arguments did not count as proof. Failures show stale canonical counts (one instead of two), retained invalid assignments, pruning not releasing source membership, or the correction committing instead of invoking/rolling back failed repair. Restoring the four production files to `023a8c2` yielded the full 803/803 result above.

## Scope and operational limits

All supported CLI mutators use the existing exclusive single-worker lock. Same-row SQL locking and external-reader visibility were independently checked; this is not a claim of serializable matching among arbitrary simultaneous writers bypassing the CLI lock. The matcher itself still reads the global dataset in multiple statements, as it did before B57.

Previously stale stored assignments are repaired by the next ordinary `update`/`cluster` pass. A re-scrape whose facts are already unchanged intentionally skips rebuilding; this patch is not an automatic migration of historical bad assignments.

The scratch worktree was removed after verification. Test fixtures left the isolated database empty. Evidence files remain under `/tmp/r-b57`.

## Independent probe source

### test_r_b57_probe.py

```python
"""Independent B57 review probes. Only fixture data in the isolated test DB."""
from datetime import timedelta
from threading import Event, Thread

import pytest
from click.testing import CliRunner
from sqlalchemy import event, select, text

from scraper import backfill as backfill_mod, cluster, reparse as reparse_mod, run
from scraper.db import listing_table, refresh_deduped, session, upsert_listings
from tests.test_cluster import DAY, _clusters, _row


def count(db, materialized=False):
    name = "DedupedListingMat" if materialized else "DedupedListing"
    with db.connect() as connection:
        return connection.execute(text(f'SELECT count(*) FROM "{name}"')).scalar_one()


def seed():
    upsert_listings([_row("hemnet", "h"), _row("booli", "b", price=4_905_000)])
    assert cluster.match_clusters().rows_updated == 2


def test_transaction_caller_can_rollback_matcher_writes(db):
    upsert_listings([_row("hemnet", "h"), _row("booli", "b", price=4_905_000)])
    with session() as transaction:
        assert cluster.match_clusters(transaction=transaction).rows_updated == 2
        assert transaction.in_transaction()
        assert transaction.execute(text('SELECT count(*) FROM "DedupedListing"')).scalar_one() == 1
        assert count(db) == 2
        transaction.rollback()
    assert set(_clusters(db).values()) == {None}


def test_transaction_dry_run_does_not_commit_callers_write(db):
    seed()
    with session() as transaction:
        transaction.execute(text('UPDATE "Listing" SET "priceSek"=6000000 WHERE "sourceId"=\'h\''))
        assert cluster.match_clusters(transaction=transaction, dry_run=True).rows_updated == 2
        assert count(db) == 1
        transaction.rollback()
    assert count(db) == 1


def test_null_key_correction_does_not_pull_away_unchanged_exact_copy(db):
    seed()
    upsert_listings([_row("hemnet", "copy")])
    upsert_listings([_row("hemnet", "h", dedupKey=None)])
    groups = _clusters(db)
    assert groups["h"] is None
    assert groups["copy"] == groups["b"] is not None
    assert count(db) == 2


def test_corrected_existing_row_to_exact_key_removes_unsafe_fuzzy_partner(db):
    seed()
    upsert_listings([_row("booli", "existing", street="Odengatan")])
    upsert_listings([_row("booli", "existing")])
    groups = _clusters(db)
    assert groups["h"] == groups["existing"] is not None
    assert groups["b"] is None
    assert count(db) == 2
    with db.connect() as connection:
        assert connection.execute(text('SELECT "clusterId", source FROM "Listing" '
            'WHERE "clusterId" IS NOT NULL GROUP BY "clusterId", source '
            'HAVING count(DISTINCT "dedupKey") > 1')).all() == []


def test_same_batch_duplicate_last_wins_and_does_not_rebuild(db, monkeypatch):
    seed()
    before = _clusters(db)
    def forbidden(**kwargs):
        raise AssertionError("the final facts are unchanged")
    monkeypatch.setattr(cluster, "match_clusters", forbidden)
    assert upsert_listings([_row("hemnet", "h", price=6_000_000), _row("hemnet", "h")]) == 1
    assert _clusters(db) == before


def test_reparse_pruning_releases_source_and_rebuilds_remaining_groups(db, monkeypatch):
    rows = [_row("hemnet", "h", id="a", raw={"sid": "h"}),
            _row("booli", "exact", id="b", raw={"sid": "exact"}),
            _row("booli", "fuzzy", id="c", price=4_905_000, raw={"sid": "fuzzy"})]
    upsert_listings(rows)
    cluster.match_clusters()
    assert count(db) == 2
    derived = {r["sourceId"]: {f: r[f] for f in reparse_mod.FIELDS} for r in rows}
    def derive(raw, district):
        return None if raw["sid"] == "exact" else derived[raw["sid"]]
    monkeypatch.setitem(reparse_mod._DERIVERS, "hemnet", derive)
    monkeypatch.setitem(reparse_mod._DERIVERS, "booli", derive)
    result = CliRunner().invoke(run.cli, ["reparse", "--prune-unparseable", "--batch-size", "1"])
    assert result.exit_code == 0, result.output
    groups = _clusters(db)
    assert groups["h"] == groups["fuzzy"] is not None
    assert "exact" not in groups
    assert count(db, materialized=True) == 1


def test_legacy_backfill_partial_failure_publishes_repaired_prior_batch(db, monkeypatch):
    upsert_listings([_row("hemnet", "h", id="a", price=6_000_000, dedupKey=None, clusterId="legacy"),
                    _row("booli", "b", id="b", price=4_905_000, clusterId="legacy"),
                    _row("hemnet", "later", id="z", street="Odengatan", dedupKey=None)])
    assert refresh_deduped() == "refreshed"
    real_key = backfill_mod.dedup_key
    def key(street, *args):
        if street == "Odengatan":
            raise RuntimeError("later legacy key failure")
        return real_key(street, *args)
    monkeypatch.setattr(backfill_mod, "dedup_key", key)
    monkeypatch.setattr(run, "backfill_dedup_keys", lambda **kw: backfill_mod.backfill_dedup_keys(batch_size=1, **kw))
    result = CliRunner().invoke(run.cli, ["backfill-dedup"])
    assert result.exit_code == 1
    assert str(result.exception) == "later legacy key failure"
    assert count(db, materialized=True) == 3


def test_failure_after_cluster_writes_rolls_back_correction_and_groups(db, monkeypatch):
    seed()
    before = _clusters(db)
    def fail(**kwargs):
        raise RuntimeError("post-write invariant check failed")
    monkeypatch.setattr(cluster, "dedup_keys_in_multiple_clusters", fail)
    with pytest.raises(RuntimeError, match="post-write invariant check failed"):
        upsert_listings([_row("hemnet", "h", price=6_000_000)])
    assert _clusters(db) == before
    with db.connect() as connection:
        assert connection.execute(text('SELECT "priceSek" FROM "Listing" WHERE "sourceId"=\'h\'')).scalar_one() == 4_900_000


def test_same_row_concurrent_correction_waits_then_sees_committed_facts(db):
    seed()
    listing_table()
    began = Event()
    finished = Event()
    errors = []
    def update():
        began.set()
        try:
            upsert_listings([_row("hemnet", "h", price=6_000_000)])
        except BaseException as error:
            errors.append(error)
        finally:
            finished.set()
    with session() as transaction:
        transaction.execute(select(listing_table()).where(listing_table().c.sourceId == "h").with_for_update()).all()
        worker = Thread(target=update)
        worker.start()
        assert began.wait(2)
        assert not finished.wait(0.15)
        assert count(db) == 1
        transaction.commit()
    worker.join(timeout=5)
    assert not worker.is_alive()
    assert errors == []
    assert count(db) == 2


@pytest.mark.parametrize("change", [{"areaSqm": None}, {"rooms": None}, {"houseNumber": "3 a"}])
def test_compatible_corrections_keep_valid_cluster(db, change):
    seed()
    before = _clusters(db)
    with db.connect() as connection:
        row = dict(connection.execute(select(listing_table()).where(listing_table().c.sourceId == "h")).mappings().one())
    row.update(change)
    upsert_listings([row])
    assert _clusters(db) == before


def test_correction_moves_closest_partner_without_same_source_chain(db):
    upsert_listings([_row("hemnet", "h"),
                    _row("booli", "near", sold=DAY + timedelta(days=1), price=4_905_000),
                    _row("booli", "far", sold=DAY + timedelta(days=2), price=4_910_000)])
    cluster.match_clusters()
    assert _clusters(db)["h"] == _clusters(db)["near"]
    upsert_listings([_row("hemnet", "h", sold=DAY + timedelta(days=2))])
    groups = _clusters(db)
    assert groups["h"] == groups["far"] is not None
    assert groups["near"] is None
    assert count(db) == 2


def test_upsert_correction_before_commit_has_old_visible_facts_and_group(db):
    seed()
    observed = []
    from sqlalchemy.orm import Session
    def before_commit(transaction):
        with db.connect() as connection:
            observed.append((connection.execute(text('SELECT "priceSek" FROM "Listing" WHERE "sourceId"=\'h\'')).scalar_one(), count(db)))
    event.listen(Session, "before_commit", before_commit)
    try:
        upsert_listings([_row("hemnet", "h", price=6_000_000)])
    finally:
        event.remove(Session, "before_commit", before_commit)
    assert observed == [(4_900_000, 1)]
    assert count(db) == 2

```

### test_r_b57_original.py

```python
"""Independent whole-code audit probes; fixture/network-free source records."""
from datetime import date
import pytest
from click.testing import CliRunner
from sqlalchemy import text
from scraper import run, hemnet
from scraper.cluster import match_clusters
from scraper.db import upsert_listings, refresh_deduped
from tests.test_cluster import _row


def _count(db):
    with db.connect() as c:
        return c.execute(text('SELECT count(*) FROM "DedupedListingMat"')).scalar_one()


@pytest.mark.parametrize('command', ['scrape', 'backfill'])
def test_explicit_correction_publishes_split_sale(db, monkeypatch, command):
    original = _row('hemnet', 'h', price=4_900_000)
    partner = _row('booli', 'b', price=4_905_000)
    upsert_listings([original, partner])
    assert match_clusters().rows_updated == 2
    assert refresh_deduped() == 'refreshed'
    assert _count(db) == 1
    async def corrected(*args, **kwargs):
        yield _row('hemnet', 'h', price=6_000_000)
    monkeypatch.setitem(run._SOURCE_ITER, 'hemnet', corrected)
    result = CliRunner().invoke(run.cli, [command, '--source', 'hemnet', '--district', 'ostermalm', '--since', '2026-05-01'])
    assert result.exit_code == 0, result.output
    with db.connect() as c:
        assert c.execute(text('SELECT "priceSek" FROM "Listing" WHERE "sourceId"=\'h\'')).scalar_one() == 6_000_000
    assert _count(db) == 2, 'Corrected 6m and 4.905m sales must no longer share one canonical sale'


def test_reparse_correction_publishes_split_sale(db):
    raw = {'listingId': 'h', 'streetAddress': 'Brahegatan 3A', 'soldAt': '1777845600',
           'livingArea': '35 m²', 'rooms': '1 rum', 'finalPrice': '6 000 000 kr',
           'squareMeterPrice': '171 429 kr/m²'}
    fields = hemnet.card_fields(raw, 'ostermalm')
    assert fields
    upsert_listings([_row('hemnet', 'h', sold=fields['soldAt'], raw=raw),
                     _row('booli', 'b', sold=fields['soldAt'], price=4_905_000)])
    assert match_clusters().rows_updated == 2
    assert refresh_deduped() == 'refreshed'
    assert _count(db) == 1
    result = CliRunner().invoke(run.cli, ['reparse'])
    assert result.exit_code == 0, result.output
    assert _count(db) == 2, 'Reparse refresh publishes a stale cluster although current prices no longer match'


```

### test_r_b57_perf.py

```python
"""Bounded offline timing probe using the repository's 200k synthetic shape."""
import json
from time import perf_counter

from sqlalchemy import select, text

from scraper.cluster import match_clusters
from scraper.db import listing_table, upsert_listings


def test_offline_correction_cost(db):
    with db.begin() as connection:
        assert connection.execute(text("SELECT current_database()")).scalar_one() == "bostadspriser_test_r_b57"
        connection.execute(text("SELECT setseed(0.42)"))
        connection.execute(text('''
          INSERT INTO "Listing" (id, source, "sourceId", "dedupKey", street, "houseNumber",
            district, rooms, "areaSqm", "priceSek", "pricePerSqmSek", "soldAt", raw)
          SELECT 'p-' || g, 'hemnet', 'h-' || g, md5('k' || g),
            'Gata ' || ((g / 4) % 300),
            ((g * 7) % 60 + 1)::text || CASE WHEN g % 5 = 0 THEN 'A' ELSE '' END,
            (ARRAY['ostermalm','vasastan','norrmalm','sodermalm'])[1 + g % 4]::"District",
            1 + (g % 6), 20 + (g % 90), pps * (20 + (g % 90)), pps,
            DATE '2021-01-01' + (random() * 1800)::int, '{}'::jsonb
          FROM (SELECT g, 60000 + floor(random() * 120000)::bigint AS pps
                FROM generate_series(1, 150000) g) s
        '''))
        connection.execute(text('''
          INSERT INTO "Listing" (id, source, "sourceId", "dedupKey", street, "houseNumber",
            district, rooms, "areaSqm", "priceSek", "pricePerSqmSek", "soldAt", raw)
          SELECT 'b-' || SUBSTRING(id FROM 3), 'booli', 'b-' || SUBSTRING(id FROM 3),
            "dedupKey", street, "houseNumber", district, rooms, "areaSqm", "priceSek", "pricePerSqmSek", "soldAt", '{}'::jsonb
          FROM "Listing" WHERE source = 'hemnet' AND SUBSTRING(id FROM 3)::int <= 50000
        '''))
        connection.execute(text('ANALYZE "Listing"'))
    started = perf_counter()
    match_clusters()
    timings = {"initial_cluster_seconds": perf_counter() - started}
    with db.connect() as connection:
        rows = [dict(row) for row in connection.execute(select(listing_table()).where(listing_table().c.source == "hemnet").order_by(listing_table().c.id).limit(400)).mappings()]
    # Parser-shaped input has no clusterId. Keep the full database precision of
    # all other facts, and avoid measuring schema reflection in the timed region.
    for row in rows:
        row.pop("clusterId")
    started = perf_counter()
    upsert_listings(rows[:100])
    timings["unchanged_100_seconds"] = perf_counter() - started
    for row in rows:
        row["rooms"] += 0.1 if isinstance(row["rooms"], float) else type(row["rooms"])("0.1")
    started = perf_counter()
    upsert_listings(rows[:100])
    timings["corrected_100_one_batch_seconds"] = perf_counter() - started
    started = perf_counter()
    upsert_listings(rows[100:])
    timings["corrected_300_three_batches_seconds"] = perf_counter() - started
    print(json.dumps(timings, sort_keys=True))

```

