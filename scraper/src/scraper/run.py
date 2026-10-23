"""CLI entrypoint: `python -m scraper.run` or `scraper`."""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import click
from sqlalchemy import text

from .backfill import backfill_dedup_keys
from .booli import DISTRICT_AREA_IDS as _BOOLI_DISTRICTS
from .booli import iter_district as _booli_iter
from .db import engine, upsert_listing
from .geocode import geocode_pending
from .hemnet import DISTRICT_LOCATION_IDS
from .hemnet import iter_district as _hemnet_iter
from .reparse import format_summary, reparse

# Both sources cover the same four districts; the CLI accepts the union of slugs.
_ALL_DISTRICTS = sorted(set(DISTRICT_LOCATION_IDS) | set(_BOOLI_DISTRICTS))

# Source slug -> async district iterator. New sources slot in here.
_SOURCE_ITER = {
    "hemnet": _hemnet_iter,
    "booli": _booli_iter,
}


def latest_sold_at(source: str, district: str) -> date | None:
    """MAX(soldAt) for one source/district, or None when nothing is stored yet."""
    with engine().connect() as c:
        return c.execute(
            text(
                'SELECT MAX("soldAt") FROM "Listing" '
                'WHERE district = CAST(:d AS "District") AND source = :s'
            ),
            {"d": district, "s": source},
        ).scalar_one()


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


@click.group()
def cli() -> None:
    """Bostadspriser scraper."""


@cli.command()
@click.option("--district", required=True, type=click.Choice(_ALL_DISTRICTS))
@click.option("--since", required=True, callback=lambda c, p, v: _parse_date(v))
@click.option(
    "--source",
    type=click.Choice(sorted(_SOURCE_ITER.keys())),
    default="hemnet",
    show_default=True,
    help="Which sold-listings source to scrape.",
)
def scrape(district: str, since: date, source: str) -> None:
    """Scrape SOURCE sold-listings for DISTRICT back to SINCE."""
    iter_district = _SOURCE_ITER[source]

    async def _run() -> int:
        n = 0
        async for row in iter_district(district, since):
            upsert_listing(row)
            n += 1
        return n

    n = asyncio.run(_run())
    click.echo(f"upserted {n} listings for {district} from {source}")


@cli.command()
@click.option(
    "--district",
    "districts",
    multiple=True,
    type=click.Choice(_ALL_DISTRICTS),
    default=tuple(_ALL_DISTRICTS),
    show_default=True,
)
@click.option(
    "--source",
    "sources",
    multiple=True,
    type=click.Choice(sorted(_SOURCE_ITER.keys())),
    default=tuple(sorted(_SOURCE_ITER.keys())),
    show_default=True,
    help="One or more sources to refresh; defaults to all.",
)
@click.option(
    "--lookback-days",
    default=14,
    show_default=True,
    type=int,
    help="Floor for the since cutoff when no rows exist for the district yet.",
)
def update(districts: tuple[str, ...], sources: tuple[str, ...], lookback_days: int) -> None:
    """Incrementally refresh: scrape from MAX(soldAt) - 7d per district per source.

    Designed to run from cron daily/weekly. Idempotent — re-scrapes about a week
    of overlap to catch late-listed sales. The MAX(soldAt) lookup is scoped to
    the source so a fresh Booli backfill doesn't piggyback on Hemnet's cutoff.
    """
    overlap = timedelta(days=7)
    results = [
        _refresh(source, d, overlap, lookback_days) for source in sources for d in districts
    ]
    click.echo(_format_results(results))
    failed = [r for r in results if r.error is not None]
    if failed:
        click.echo(f"{len(failed)} of {len(results)} failed", err=True)
        sys.exit(1)
    click.echo(f"{len(results)} of {len(results)} ok")


@dataclass
class UpdateResult:
    source: str
    district: str
    since: date | None = None
    upserted: int = 0
    error: str | None = None


def _refresh(source: str, district: str, overlap: timedelta, lookback_days: int) -> UpdateResult:
    """Refresh one source/district. Never raises: failures land in the result."""
    result = UpdateResult(source, district)
    iter_district = _SOURCE_ITER[source]

    async def _run() -> None:
        assert result.since is not None
        async for r in iter_district(district, result.since):
            upsert_listing(r)
            result.upserted += 1

    try:
        latest = latest_sold_at(source, district)
        result.since = (
            (latest - overlap) if latest else (date.today() - timedelta(days=lookback_days))
        )
        click.echo(f"{source}/{district}: refreshing since {result.since.isoformat()}")
        asyncio.run(_run())
        click.echo(f"  upserted {result.upserted} for {source}/{district}")
    except Exception as e:  # noqa: BLE001
        result.error = " ".join(f"{type(e).__name__}: {e}".split())
        click.echo(f"  {source}/{district} failed: {result.error}", err=True)
    return result


def _format_results(results: list[UpdateResult]) -> str:
    """Fixed-width summary table, one line per source/district."""
    header = f"{'source':8} {'district':10} {'since':10} {'upserted':>8} {'status':6} error"
    lines = ["", header]
    for r in results:
        since = r.since.isoformat() if r.since else "-"
        status = "ok" if r.error is None else "FAILED"
        error = (r.error or "")[:150]
        lines.append(
            f"{r.source:8} {r.district:10} {since:10} {r.upserted:>8} {status:6} {error}".rstrip()
        )
    return "\n".join(lines)


@cli.command()
@click.option("--limit", default=200, show_default=True)
def geocode(limit: int) -> None:
    """Geocode listings missing lat/lng via Mapbox."""
    n = geocode_pending(limit=limit)
    click.echo(f"geocoded {n} rows")


@cli.command()
def backfill_dedup() -> None:
    """Populate dedupKey on legacy rows that predate the column."""
    n = backfill_dedup_keys()
    click.echo(f"backfilled {n} rows")


@cli.command("reparse")
@click.option("--dry-run", is_flag=True, help="Report what would change without writing.")
@click.option(
    "--batch-size",
    default=1000,
    show_default=True,
    type=click.IntRange(min=1),
    help="Rows per keyset batch / transaction.",
)
def reparse_cmd(dry_run: bool, batch_size: int) -> None:
    """Re-derive street, house number, rooms, area, prices and dedupKey from `raw`."""
    click.echo(format_summary(reparse(dry_run=dry_run, batch_size=batch_size)))


@cli.command()
def stats() -> None:
    """Show row counts and date ranges per district."""
    with engine().connect() as c:
        rows = c.execute(
            text(
                'SELECT district::text, COUNT(*), MIN("soldAt"), MAX("soldAt"), '
                'AVG("pricePerSqmSek")::bigint '
                'FROM "Listing" GROUP BY district ORDER BY district'
            )
        ).all()
    if not rows:
        click.echo("no listings yet")
        return
    click.echo(f"{'district':12} {'n':>6} {'earliest':>12} {'latest':>12} {'mean kr/m²':>12}")
    for d, n, earliest, latest, mean in rows:
        click.echo(
            f"{d:12} {n:>6} {str(earliest):>12} {str(latest):>12} {(mean or 0):>12,}"
        )


if __name__ == "__main__":
    cli()
