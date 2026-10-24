"""B36: pruning is explicit, previewable and limited to locked known-source rows."""
import importlib
import json

import pytest
import httpx
from click.testing import CliRunner
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from scraper import hemnet, run, revalidate
from scraper.db import upsert_listing, refresh_deduped
from tests.test_reparse import HEMNET_CARD

module = importlib.import_module("scraper.reparse")


def seed_invalid(source="hemnet", sid="one", address=None):
    card = {**HEMNET_CARD, "listingId": sid}
    if address is not None:
        card["streetAddress"] = address
    row = hemnet._to_row(card, "ostermalm")
    row.update(source=source, raw={"__typename": "SaleCard"})
    upsert_listing(row)
    return row["id"]


def ids(db):
    with db.connect() as conn:
        return set(conn.execute(text('SELECT id FROM "Listing"')).scalars())


def test_default_reparse_reports_without_pruning_known_or_unknown_sources(db):
    known, unknown = seed_invalid(), seed_invalid("future-source", "two")
    summary = module.reparse()
    assert summary.unparseable == 2
    assert summary.prunable == 1 and summary.pruned == 0
    assert ids(db) == {known, unknown}


def test_dry_run_previews_eligible_ids_without_deleting(db):
    known, unknown = seed_invalid(), seed_invalid("future-source", "two")
    result = CliRunner().invoke(run.cli, ["reparse", "--prune-unparseable", "--dry-run"])
    assert result.exit_code == 0, result.output
    assert "would prune 1" in result.output
    assert known in result.output
    assert ids(db) == {known, unknown}


def test_opt_in_prunes_only_known_unparseable_rows_and_refreshes_when_only_deleting(db, monkeypatch):
    known, unknown = seed_invalid(), seed_invalid("future-source", "two")
    valid = hemnet._to_row({**HEMNET_CARD, "listingId": "valid"}, "ostermalm")
    upsert_listing(valid)
    calls = []
    monkeypatch.setattr(run, "refresh_deduped", lambda: calls.append(True))
    result = CliRunner().invoke(run.cli, ["reparse", "--prune-unparseable", "--batch-size", "1"])
    assert result.exit_code == 0, result.output
    assert "pruned 1" in result.output and known in result.output
    assert ids(db) == {unknown, valid["id"]}
    assert calls == [True]
    assert module.reparse(prune_unparseable=True).pruned == 0


def test_prune_deletion_reaches_materialized_snapshot_and_notifies_cache(db, monkeypatch):
    seed_invalid()
    assert refresh_deduped() == "refreshed"
    with db.connect() as conn:
        assert conn.execute(text('SELECT count(*) FROM "DedupedListingMat"')).scalar_one() == 1
    requests = []
    real_client = httpx.Client

    def respond(request):
        requests.append(request)
        return httpx.Response(200)

    monkeypatch.setenv("APP_URL", "https://app.example")
    monkeypatch.setenv("REVALIDATE_SECRET", "fixture-prune-secret")
    monkeypatch.setattr(revalidate.httpx, "Client", lambda **kwargs: real_client(
        transport=httpx.MockTransport(respond), **kwargs))
    result = CliRunner().invoke(run.cli, ["reparse", "--prune-unparseable"])
    assert result.exit_code == 0, result.output
    with db.connect() as conn:
        assert conn.execute(text('SELECT count(*) FROM "DedupedListingMat"')).scalar_one() == 0
    assert len(requests) == 1
    assert requests[0].method == "POST"
    assert str(requests[0].url) == "https://app.example/api/revalidate"


def test_proof_of_unparseability_happens_while_row_is_locked(db, monkeypatch):
    listing_id = seed_invalid()
    original = module._DERIVERS["hemnet"]
    checked = []

    def derive(raw, district):
        with pytest.raises(DBAPIError) as exc:
            with db.begin() as conn:
                conn.execute(text("SET LOCAL lock_timeout = '50ms'"))
                conn.execute(text('UPDATE "Listing" SET raw = CAST(:raw AS jsonb) WHERE id = :id'),
                             {"raw": json.dumps(HEMNET_CARD), "id": listing_id})
        assert exc.value.orig.sqlstate == "55P03"
        checked.append(True)
        return original(raw, district)

    monkeypatch.setitem(module._DERIVERS, "hemnet", derive)
    summary = module.reparse(prune_unparseable=True)
    assert checked == [True] and summary.pruned == 1
    assert ids(db) == set()


def test_parser_exception_cannot_prune_other_rows_in_same_batch(db, monkeypatch):
    first, second = seed_invalid(sid="one"), seed_invalid(sid="two")
    original = module._DERIVERS["hemnet"]
    calls = []

    def derive(raw, district):
        calls.append(True)
        if len(calls) == 2:
            raise RuntimeError("parser bug")
        return original(raw, district)

    monkeypatch.setitem(module._DERIVERS, "hemnet", derive)
    with pytest.raises(RuntimeError, match="parser bug"):
        module.reparse(prune_unparseable=True)
    assert ids(db) == {first, second}


@pytest.mark.parametrize("source", ["hemnet", "booli"])
@pytest.mark.parametrize("raw", [None, {}, [], "not a card"])
def test_known_source_invalid_raw_shapes_are_prunable(source, raw, db):
    row = hemnet._to_row(HEMNET_CARD, "ostermalm")
    row.update(source=source, raw=raw)
    upsert_listing(row)
    summary = module.reparse(prune_unparseable=True)
    assert (summary.unparseable, summary.prunable, summary.pruned) == (1, 1, 1)
    assert ids(db) == set()


def test_dry_run_samples_are_bounded_and_never_include_unknown_sources(db):
    known = {seed_invalid(sid=str(i)) for i in range(25)}
    unknown = seed_invalid("future-source", "unknown")
    summary = module.reparse(dry_run=True, prune_unparseable=True, batch_size=2)
    assert (summary.unparseable, summary.prunable, summary.pruned) == (26, 25, 0)
    assert len(summary.prunable_samples) == 20
    assert set(summary.prunable_samples) <= known
    assert ids(db) == known | {unknown}


def test_deletions_from_prior_batches_are_refreshed_even_when_a_later_parser_fails(db, monkeypatch):
    seed_invalid(sid="one")
    seed_invalid(sid="two", address="Brahegatan 99")
    assert refresh_deduped() == "refreshed"
    with db.connect() as conn:
        assert conn.execute(text('SELECT count(*) FROM "DedupedListingMat"')).scalar_one() == 2
    original = module._DERIVERS["hemnet"]
    calls = []

    def derive(raw, district):
        calls.append(True)
        if len(calls) == 2:
            raise RuntimeError("parser bug")
        return original(raw, district)

    monkeypatch.setitem(module._DERIVERS, "hemnet", derive)
    result = CliRunner().invoke(run.cli, ["reparse", "--prune-unparseable", "--batch-size", "1"])
    assert result.exit_code == 1
    assert len(ids(db)) == 1
    with db.connect() as conn:
        assert conn.execute(text('SELECT count(*) FROM "DedupedListingMat"')).scalar_one() == 1


def test_preview_and_unknown_only_runs_never_refresh(db, monkeypatch):
    seed_invalid("future-source")
    calls = []
    monkeypatch.setattr(run, "refresh_deduped", lambda: calls.append(True))
    assert CliRunner().invoke(run.cli, ["reparse", "--prune-unparseable"]).exit_code == 0
    seed_invalid("hemnet", "known")
    assert CliRunner().invoke(run.cli, ["reparse", "--prune-unparseable", "--dry-run"]).exit_code == 0
    assert calls == []


def test_pruning_and_valid_reparse_updates_commit_together(db):
    seed_invalid()
    valid = hemnet._to_row({**HEMNET_CARD, "listingId": "valid"}, "ostermalm")
    valid["street"] = "Wrong legacy street"
    upsert_listing(valid)
    summary = module.reparse(prune_unparseable=True)
    assert (summary.changed, summary.pruned) == (1, 1)
    assert ids(db) == {valid["id"]}
    with db.connect() as conn:
        assert conn.execute(text('SELECT street FROM "Listing"')).scalar_one() == "Sankt Eriksgatan"
    again = module.reparse(prune_unparseable=True)
    assert (again.changed, again.pruned) == (0, 0)
