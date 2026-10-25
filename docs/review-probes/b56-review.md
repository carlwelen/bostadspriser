# B56 adversarial review

**APPROVE** — `c68e1f2159693c07b339786604dd9bff60921464`.

No blocking findings, nits, or new backlog items identified. Reviewed production changes in `scraper/src/scraper/backfill.py:17` and `scraper/src/scraper/run.py:511`, the committed regression tests, and the existing refresh/revalidation contracts.

## Evidence

- The callback runs after each successful SQL commit. Independent connections observed 2 then 4 committed keys; empty reruns and invalid batch sizes invoked no callback.
- Real PostgreSQL deferred constraint failures tested both the first commit and a later commit. The failed batch rolled back, earlier keys stayed committed, the CLI preserved the identical original `IntegrityError` with SQLSTATE `23514`, exited 1, and printed no success count.
- After a later commit failed, the real materialized snapshot collapsed the earlier cross-source pair (4 snapshot rows became 3). On an initial failure there was no refresh or notification.
- Notification-time queries over a separate connection matched the live deduplicated view, proving notification followed the committed refresh. Multiple successful batches refreshed/notified exactly once; an empty retry did neither.
- Missing and failing refresh functions retained the original worker exception and sent no notification. A real held read transaction on the materialized view caused the configured refresh lock timeout, returned `busy`, preserved the original worker failure, and sent no notification. A subsequent successful explicit refresh notified once.
- Source/main were read-only. All DB mutations used the repository's sanctioned `db` fixture on `bostadspriser_test_r_b56`. No provider/Mapbox requests, protected path access, or unrelated process termination.

## Verification

Environment for reviewer runs: `TEST_DB_NAME=bostadspriser_test_r_b56 E2E_PORT=3112`, scratch `/tmp/review-b56`, detached at the immutable SHA.

- `uv run pytest -q tests/test_refresh_view.py tests/test_dedup.py tests/test_revalidate.py`: **52 passed** (`focused-green.log`).
- `uv run pytest -q tests/test_review_b56.py`: **5 passed** (`independent-green.log`).
- `uv run pytest -q`: **769 passed** (764 committed + 5 independent; `full-pytest.log`).
- Ruff on both changed production files and the committed test file: **passed**.
- Inspected the supplied full gate, retained as `source-gate.log`: **506 vitest / 292 e2e / 764 pytest**, all gate steps passed. Reviewer did not repeat web build/e2e for this Python-only change.

**Proving tests fail without the fix: yes.** Restored both production files with `git checkout c68e1f2^ -- scraper/src/scraper/backfill.py scraper/src/scraper/run.py`, leaving all tests unchanged.

- `uv run --directory scraper pytest -q tests/test_refresh_view.py -k 'backfill_dedup_refreshes_committed_batches or backfill_dedup_keeps_original_failure'`: **4 failed, 1 passed**. Expected stale snapshot and missing refresh-attempt assertions (`production-reversion-red.log`), not signature/import failures.
- `uv run --directory scraper pytest -q tests/test_review_b56.py -k 'real_deferred_commit_failure or real_refresh_lock_timeout'`: **2 failed, 1 passed**. Real later SQL commit failure left a stale snapshot; actual lock-contention path never attempted refresh (`independent-red.log`).
- Restored production files to `c68e1f2`, verified no tracked diff, then ran the passing independent and full Python suites above.

Independent test source is retained in `test_review_b56.py` and reproduced below. Scratch checkout removed after review.

## Independent probes

```python
"""Independent B56 review probes; only the sanctioned isolated db fixture is used."""

from contextlib import contextmanager

import pytest
from click.testing import CliRunner
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from scraper import backfill, run
from scraper import db as database
from tests.test_refresh_view import _row


def keys(db, relation="Listing"):
    assert relation in {"Listing", "DedupedListing", "DedupedListingMat"}
    with db.connect() as conn:
        return dict(conn.execute(text(f'SELECT id, "dedupKey" FROM "{relation}"')).all())


def seed(db):
    database.upsert_listings([
        _row("a", id="a", dedupKey=None),
        _row("b", id="b", dedupKey=None, source="booli"),
        _row("c", id="c", dedupKey=None, street="Odengatan"),
        _row("d", id="d", dedupKey=None, street="Odengatan", source="booli"),
    ])
    assert database.refresh_deduped() == "refreshed"
    assert keys(db, "DedupedListingMat") == dict.fromkeys("abcd")


@contextmanager
def rejected_commit(db, row_id):
    assert row_id in {"a", "c"}
    with db.begin() as conn:
        assert conn.execute(text("SELECT current_database()")).scalar_one() == "bostadspriser_test_r_b56"
        conn.execute(text(f"""
            CREATE FUNCTION review_b56_reject() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.id = '{row_id}' THEN
                RAISE EXCEPTION 'review deferred commit rejection' USING ERRCODE = '23514';
              END IF;
              RETURN NEW;
            END $$
        """))
        conn.execute(text("""
            CREATE CONSTRAINT TRIGGER review_b56_commit_check AFTER UPDATE ON "Listing"
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION review_b56_reject()
        """))
    try:
        yield
    finally:
        with db.begin() as conn:
            conn.execute(text('DROP TRIGGER review_b56_commit_check ON "Listing"'))
            conn.execute(text("DROP FUNCTION review_b56_reject()"))


def observe(monkeypatch, db):
    worker, refresher = run.backfill_dedup_keys, run.refresh_deduped
    errors, statuses, notifications = [], [], []

    def wrapped(**kw):
        try:
            return worker(batch_size=2, **kw)
        except Exception as exc:
            errors.append(exc)
            raise

    def refresh():
        status = refresher()
        statuses.append(status)
        return status

    def notified():
        # A separate connection must see the committed materialized snapshot
        # at notification time; an in-transaction refresh is insufficient.
        snapshot = keys(db, "DedupedListingMat")
        assert snapshot == keys(db, "DedupedListing")
        notifications.append(snapshot)

    monkeypatch.setattr(run, "backfill_dedup_keys", wrapped)
    monkeypatch.setattr(run, "refresh_deduped", refresh)
    monkeypatch.setattr(database, "revalidate_app", notified)
    return errors, statuses, notifications


@pytest.mark.parametrize("reject", ["a", "c"])
def test_real_deferred_commit_failure_preserves_error_and_refreshes_only_prior_commits(db, monkeypatch, reject):
    seed(db)
    errors, statuses, notifications = observe(monkeypatch, db)
    with rejected_commit(db, reject):
        result = CliRunner().invoke(run.cli, ["backfill-dedup"])
    assert result.exit_code == 1
    assert len(errors) == 1 and result.exception is errors[0]
    assert isinstance(result.exception, IntegrityError)
    assert result.exception.orig.sqlstate == "23514"
    assert "backfilled" not in result.output
    live = keys(db)
    assert live["c"] is None and live["d"] is None
    assert (live["a"] is not None) == (reject == "c")
    assert live["a"] == live["b"]
    assert keys(db, "DedupedListingMat") == keys(db, "DedupedListing")
    assert statuses == (["refreshed"] if reject == "c" else [])
    assert len(notifications) == (1 if reject == "c" else 0)
    assert len(keys(db, "DedupedListingMat")) == (3 if reject == "c" else 4)


def test_real_refresh_lock_timeout_preserves_failure_and_never_notifies(db, monkeypatch):
    seed(db)
    errors, statuses, notifications = observe(monkeypatch, db)
    with rejected_commit(db, "c"), db.connect() as holder:
        # SELECT retains ACCESS SHARE until this transaction ends; PostgreSQL
        # does not accept explicit LOCK TABLE for materialized views.
        holder.execute(text('SELECT id FROM "DedupedListingMat" LIMIT 1')).all()
        result = CliRunner().invoke(run.cli, ["backfill-dedup"])
        holder.rollback()
    assert result.exit_code == 1 and result.exception is errors[0]
    assert statuses == ["busy"] and notifications == []
    assert keys(db)["a"] is not None
    assert keys(db, "DedupedListingMat") == dict.fromkeys("abcd")
    assert database.refresh_deduped() == "refreshed"
    assert len(notifications) == 1 and len(notifications[0]) == 3


def test_success_multiple_batches_refreshes_once_then_empty_retry_does_nothing(db, monkeypatch):
    seed(db)
    errors, statuses, notifications = observe(monkeypatch, db)
    result = CliRunner().invoke(run.cli, ["backfill-dedup"])
    assert result.exit_code == 0 and "backfilled 4 rows" in result.output
    assert errors == [] and statuses == ["refreshed"]
    assert len(notifications) == 1 and len(notifications[0]) == 2
    result = CliRunner().invoke(run.cli, ["backfill-dedup"])
    assert result.exit_code == 0 and "backfilled 0 rows" in result.output
    assert statuses == ["refreshed"] and len(notifications) == 1


def test_callback_occurs_after_each_real_commit_and_not_for_empty_or_invalid_batches(db):
    seed(db)
    observed = []

    def committed():
        observed.append(sum(value is not None for value in keys(db).values()))

    assert backfill.backfill_dedup_keys(batch_size=2, on_commit=committed) == 4
    assert observed == [2, 4]
    assert backfill.backfill_dedup_keys(batch_size=2, on_commit=committed) == 0
    with pytest.raises(ValueError):
        backfill.backfill_dedup_keys(batch_size=0, on_commit=committed)
    assert observed == [2, 4]
```
