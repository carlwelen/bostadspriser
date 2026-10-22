"""CLI entrypoint: `python -m scraper.run` or `scraper`."""

from __future__ import annotations

import asyncio
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

# Both sources cover the same four districts; the CLI accepts the union of slugs.
_ALL_DISTRICTS = sorted(set(DISTRICT_LOCATION_IDS) | set(_BOOLI_DISTRICTS))

# Source slug -> async district iterator. New sources slot in here.
_SOURCE_ITER = {
    "hemnet": _hemnet_iter,
    "booli": _booli_iter,
}


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
    for source in sources:
        iter_district = _SOURCE_ITER[source]
        for d in districts:
            with engine().connect() as c:
                row = c.execute(
                    text(
                        'SELECT MAX("soldAt") FROM "Listing" '
                        'WHERE district = :d::"District" AND source = :s'
                    ),
                    {"d": d, "s": source},
                ).first()
            latest = row[0] if row and row[0] else None
            since = (latest - overlap) if latest else (date.today() - timedelta(days=lookback_days))
            click.echo(f"{source}/{d}: refreshing since {since.isoformat()}")

            async def _run() -> int:
                n = 0
                async for r in iter_district(d, since):
                    upsert_listing(r)
                    n += 1
                return n

            try:
                n = asyncio.run(_run())
                click.echo(f"  upserted {n} for {source}/{d}")
            except Exception as e:  # noqa: BLE001
                click.echo(f"  {source}/{d} failed: {e}", err=True)


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
