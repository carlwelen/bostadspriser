"""DB tests for `scraper reparse` and the batched dedupKey backfill."""

from __future__ import annotations

from datetime import date

from click.testing import CliRunner
from sqlalchemy import event, text

from scraper import booli, hemnet
from scraper.backfill import backfill_dedup_keys
from scraper.db import upsert_listing
from scraper.normalize import dedup_key
from scraper.reparse import reparse
from scraper.run import cli

HEMNET_CARD = {
    "__typename": "SaleCard",
    "id": "1",
    "listingId": "100",
    "streetAddress": "Sankt Eriksgatan 10 B",
    "soldAt": "1777672800.0",
    "finalPrice": "4 900 000 kr",
    "livingArea": "35 m²",
    "squareMeterPrice": "140 000 kr/m²",
    "rooms": "1,5 rum",
    "coordinates": {"lat": 59.34, "long": 18.04},
}
BOOLI_CARD = {
    "__typename": "SoldProperty",
    "id": "200",
    "streetAddress": "Odengatan 5, lgh 1101",
    "soldDate": "2026-04-24",
    "soldPrice": {"raw": 5_925_000},
    "displayAttributes": {
        "dataPoints": [
            {"value": {"plainText": "42 m²"}},
            {"value": {"plainText": "2 rum"}},
            {"value": {"plainText": "141 100 kr/m²"}},
        ]
    },
    "latitude": 59.34,
    "longitude": 18.06,
}


def _legacy(module, card: dict, district: str, **overrides) -> dict:
    """A row as the pre-B2 parser stored it: bad split, stale dedupKey."""
    row = module._to_row(card, district)
    assert row is not None
    row.update(overrides)
    return row


def _seed(db) -> dict[str, str]:
    """Two badly split legacy rows plus one that is already right. Returns ids."""
    h = _legacy(
        hemnet, HEMNET_CARD, "sodermalm",
        street="Sankt Eriksgatan 10", houseNumber="B", dedupKey="stale-h",
    )
    b = _legacy(
        booli, BOOLI_CARD, "vasastan",
        street="Odengatan 5, lgh", houseNumber="1101", dedupKey="stale-b",
    )
    ok = _legacy(
        hemnet, {**HEMNET_CARD, "listingId": "101", "streetAddress": "Brahegatan 3A"}, "ostermalm"
    )
    for r in (h, b, ok):
        upsert_listing(r)
    return {"hemnet": h["id"], "booli": b["id"], "ok": ok["id"]}


def _rows(db) -> dict[str, dict]:
    with db.connect() as c:
        res = c.execute(text('SELECT * FROM "Listing" ORDER BY "sourceId"')).mappings().all()
    return {r["sourceId"]: dict(r) for r in res}


def test_reparse_fixes_legacy_street_splits(db) -> None:
    _seed(db)
    summary = reparse()
    assert summary.scanned == 3
    assert summary.changed == 2
    assert summary.unparseable == 0
    rows = _rows(db)
    h, b, ok = rows["100"], rows["200"], rows["101"]
    assert (h["street"], h["houseNumber"]) == ("Sankt Eriksgatan", "10B")
    assert (b["street"], b["houseNumber"]) == ("Odengatan", "5")
    assert h["dedupKey"] == dedup_key("Sankt Eriksgatan", "10B", h["soldAt"], 4_900_000)
    assert b["dedupKey"] == dedup_key("Odengatan", "5", b["soldAt"], 5_925_000)
    assert (ok["street"], ok["houseNumber"]) == ("Brahegatan", "3A")
    # Untouched columns survive: coordinates, geocodedAt and raw.
    assert h["lat"] == 59.34 and h["geocodedAt"] is not None
    assert h["raw"] == HEMNET_CARD


def test_reparse_second_run_is_a_no_op(db) -> None:
    _seed(db)
    assert reparse().changed == 2
    before = _rows(db)
    second = reparse()
    assert second.scanned == 3
    assert second.changed == 0
    assert not second.by_field
    assert _rows(db) == before


def test_reparse_dry_run_writes_nothing(db) -> None:
    _seed(db)
    before = _rows(db)
    summary = reparse(dry_run=True)
    assert summary.dry_run is True
    assert summary.changed == 2
    assert summary.by_field["street"] == 2
    assert summary.by_field["houseNumber"] == 2
    assert summary.by_field["dedupKey"] == 2
    assert summary.examples
    assert _rows(db) == before


def test_reparse_batches_by_keyset_cover_every_row(db) -> None:
    for i in range(7):
        row = _legacy(
            hemnet,
            {**HEMNET_CARD, "listingId": str(300 + i), "streetAddress": f"Götgatan {i + 1} A"},
            "sodermalm",
            street=f"Götgatan {i + 1}",
            houseNumber="A",
        )
        upsert_listing(row)
    summary = reparse(batch_size=2)
    assert summary.scanned == 7
    assert summary.changed == 7
    assert {r["houseNumber"] for r in _rows(db).values()} == {f"{i + 1}A" for i in range(7)}
    assert reparse(batch_size=3).changed == 0


def test_reparse_reports_rows_that_no_longer_parse_and_keeps_them(db) -> None:
    ids = _seed(db)
    broken = _legacy(hemnet, {**HEMNET_CARD, "listingId": "102"}, "sodermalm")
    broken["raw"] = {"__typename": "SaleCard"}  # nothing to parse
    upsert_listing(broken)
    odd = _legacy(hemnet, {**HEMNET_CARD, "listingId": "103"}, "sodermalm", source="other")
    upsert_listing(odd)

    summary = reparse()
    assert summary.scanned == 5
    assert summary.unparseable == 2
    reasons = {sid: reason for sid, _, reason in summary.unparseable_samples}
    assert reasons[broken["id"]] == "raw card no longer parses"
    assert "unknown source" in reasons[odd["id"]]
    # Reported, not deleted or rewritten; the parseable legacy rows were fixed.
    rows = _rows(db)
    assert rows["102"]["street"] == broken["street"]
    assert rows["103"]["street"] == odd["street"]
    assert rows["100"]["street"] == "Sankt Eriksgatan"
    assert ids["hemnet"] == rows["100"]["id"]


def test_reparse_derives_missing_per_sqm_and_never_rewrites_to_zero(db) -> None:
    """B4 rules apply to reparse: derive kr/m², report rows that would become invalid."""
    # Legacy row stored with kr/m² 0 although price and area are in the card.
    no_sqm_card = {**HEMNET_CARD, "listingId": "500", "squareMeterPrice": None}
    legacy = _legacy(hemnet, HEMNET_CARD, "sodermalm", sourceId="500", pricePerSqmSek=0)
    legacy["raw"] = no_sqm_card
    upsert_listing(legacy)
    # Legacy row whose card has no price at all: stored 0s, card can't be re-derived.
    no_price_card = {k: v for k, v in HEMNET_CARD.items() if k != "finalPrice"}
    dead = _legacy(
        hemnet, HEMNET_CARD, "sodermalm",
        sourceId="501", priceSek=0, pricePerSqmSek=0, dedupKey="old",
    )
    dead["raw"] = {**no_price_card, "listingId": "501"}
    upsert_listing(dead)

    summary = reparse()
    assert summary.changed == 1
    assert summary.by_field["pricePerSqmSek"] == 1
    assert summary.unparseable == 1
    rows = _rows(db)
    assert rows["500"]["pricePerSqmSek"] == 140_000  # round(4_900_000 / 35)
    assert rows["501"]["priceSek"] == 0 and rows["501"]["dedupKey"] == "old"  # reported, untouched
    assert reparse().changed == 0


def test_reparse_corrects_sold_at_and_keeps_dedup_key_consistent(db) -> None:
    """Legacy UTC/DST off-by-one: raw is authoritative, key must match the stored date."""
    legacy = _legacy(hemnet, HEMNET_CARD, "sodermalm", soldAt=date(2026, 5, 1), dedupKey="stale")
    upsert_listing(legacy)
    summary = reparse(dry_run=True)
    assert summary.by_field["soldAt"] == 1
    assert summary.sold_at_mismatch == 1
    assert _rows(db)["100"]["soldAt"] == date(2026, 5, 1)  # dry run wrote nothing

    reparse()
    row = _rows(db)["100"]
    assert row["soldAt"] == date(2026, 5, 2)
    assert row["dedupKey"] == dedup_key(row["street"], row["houseNumber"], row["soldAt"], row["priceSek"])
    assert reparse().changed == 0


def test_reparse_is_idempotent_for_two_decimal_areas_and_rooms(db) -> None:
    """The DB rounds to 1 decimal; card_fields must too or every run rewrites the row."""
    card = {**HEMNET_CARD, "livingArea": "35,25 m²", "rooms": "2,25 rum", "squareMeterPrice": "140 000 kr/m²"}
    row = hemnet._to_row(card, "sodermalm")
    assert row is not None
    assert row["areaSqm"] == 35.3 and row["rooms"] == 2.3
    upsert_listing(row)
    assert reparse().changed == 0
    assert reparse().changed == 0


def test_reparse_locks_batch_rows_unless_dry_run(db) -> None:
    """A concurrent upsert must not slip a newer raw in between SELECT and UPDATE."""
    _seed(db)
    statements: list[str] = []

    def capture(conn, cursor, statement, *args):  # noqa: ARG001
        statements.append(statement)

    event.listen(db, "before_cursor_execute", capture)
    try:
        reparse(dry_run=True)
        dry = [s for s in statements if s.lstrip().upper().startswith("SELECT") and '"Listing"' in s]
        statements.clear()
        reparse()
        real = [s for s in statements if s.lstrip().upper().startswith("SELECT") and '"Listing"' in s]
    finally:
        event.remove(db, "before_cursor_execute", capture)
    assert dry and not any("FOR UPDATE" in s for s in dry)
    assert real and all("FOR UPDATE" in s for s in real)


def test_reparse_cli_dry_run_then_real(db) -> None:
    _seed(db)
    runner = CliRunner()
    dry = runner.invoke(cli, ["reparse", "--dry-run", "--batch-size", "2"])
    assert dry.exit_code == 0, dry.output
    assert "DRY RUN" in dry.output
    assert "would change 2" in dry.output
    assert "street" in dry.output
    assert _rows(db)["100"]["street"] == "Sankt Eriksgatan 10"
    real = runner.invoke(cli, ["reparse"])
    assert real.exit_code == 0, real.output
    assert "changed 2" in real.output
    assert _rows(db)["100"]["street"] == "Sankt Eriksgatan"


def test_backfill_dedup_keys_batches_and_is_idempotent(db) -> None:
    for i in range(5):
        row = _legacy(hemnet, {**HEMNET_CARD, "listingId": str(400 + i)}, "sodermalm", dedupKey=None)
        upsert_listing(row)
    assert backfill_dedup_keys(batch_size=2) == 5
    assert backfill_dedup_keys(batch_size=2) == 0
    for r in _rows(db).values():
        assert r["dedupKey"] == dedup_key(r["street"], r["houseNumber"], r["soldAt"], 4_900_000)
