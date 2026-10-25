"""CLI entrypoint: `python -m scraper.run` or `scraper`."""

from __future__ import annotations

import asyncio
import logging
import sys
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import click
from sqlalchemy import text

from .backfill import backfill_dedup_keys
from .booli import DISTRICT_AREA_IDS as _BOOLI_DISTRICTS
from .booli import iter_district as _booli_iter
from . import crawl_state, scrape_run
from .cluster import dedup_keys_in_multiple_clusters, match_clusters
from .db import DEFAULT_BATCH_SIZE, engine, refresh_deduped, upsert_listings
from .dates import stockholm_today
from .errors import CrawlIncomplete
from .geocode import MAX_ATTEMPTS as MAX_GEOCODE_ATTEMPTS
from .geocode import GeocodeConfigError, geocode_pending, mark_inline_pending
from .hemnet import DISTRICT_LOCATION_IDS
from .hemnet import iter_district as _hemnet_iter
from .lock import EXIT_BUSY as EXIT_TEMPFAIL
from .lock import exclusive
from .reparse import format_summary, reparse
from .source_base import MAX_PAGES, CrawlProgress

# Both sources cover the same four districts; the CLI accepts the union of slugs.
_ALL_DISTRICTS = sorted(set(DISTRICT_LOCATION_IDS) | set(_BOOLI_DISTRICTS))

EXIT_CONFIG = 78  # EX_CONFIG: missing or rejected credentials

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


async def _ingest(
    rows: AsyncIterator[dict],
    batch_size: int = DEFAULT_BATCH_SIZE,
    on_batch: Callable[[int], None] | None = None,
) -> int:
    """Upsert `rows` in batches (one transaction each); returns rows written.

    If the iterator fails (e.g. CrawlIncomplete), the rows already received are
    flushed before the error propagates, so a partial crawl keeps what it got.
    `on_batch(n)` is called after each batch is committed.
    """
    buf: list[dict] = []
    written = 0

    def flush() -> None:
        nonlocal written
        if not buf:
            return
        batch = list(buf)
        buf.clear()
        n = upsert_listings(batch, batch_size=batch_size)  # distinct rows written
        written += n
        if on_batch is not None:
            on_batch(n)

    try:
        async for row in rows:
            buf.append(row)
            if len(buf) >= batch_size:
                flush()
    except Exception:
        flush()
        raise
    flush()
    return written


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


class _LazyStderrHandler(logging.StreamHandler):
    """Writes to whatever sys.stderr is at emit time (CliRunner swaps it per invocation)."""

    def __init__(self) -> None:
        super().__init__()
        self.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))

    @property
    def stream(self):  # type: ignore[override]
        return sys.stderr

    @stream.setter
    def stream(self, _value) -> None:
        pass


def configure_logging(level: str) -> None:
    """Send `scraper.*` log records to stderr at LEVEL (once; re-running only re-levels)."""
    logger = logging.getLogger("scraper")
    logger.setLevel(level.upper())
    if not any(isinstance(h, _LazyStderrHandler) for h in logger.handlers):
        logger.addHandler(_LazyStderrHandler())


@click.group()
@click.option(
    "--log-level",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    default="INFO",
    show_default=True,
    help="Verbosity of the crawl log on stderr.",
)
def cli(log_level: str) -> None:
    """Bostadspriser scraper.

    \b
    One run at a time: scrape, update, backfill, reparse, geocode, cluster, refresh-view
    and backfill-dedup share an exclusive lock on update.lock (next to storageState.json, in
    scraper/.state/). A second run exits with code 75 (EX_TEMPFAIL) and a message
    naming the lock; the lock is released when the process ends, so a leftover
    file never blocks. Exit codes: 0 ok; 1 failed or incomplete; 75 (EX_TEMPFAIL) busy
    or, for geocode, rate-limited/unavailable (try again later); 78 (EX_CONFIG) the
    Mapbox token is missing or rejected.

    \b
    Because of that lock, a ScrapeRun row still `running` when a new run starts
    belongs to a run that died; the new run marks it failed with error
    'interrupted'. (The lock is per state directory and host: runs sharing one
    database from different hosts or state directories would reap each other.)
    """
    configure_logging(log_level)


# `update` stops at MAX_PAGES (a runaway guard for a week or two of new sales). A
# deep backfill legitimately needs far more (a 1.5-year Södermalm is ~170 pages),
# so it gets its own, explicit, higher ceiling. Pacing and single-worker behaviour
# are unchanged.
BACKFILL_MAX_PAGES = 1000


@dataclass
class RunReport:
    upserted: int
    progress: CrawlProgress
    error: str | None = None
    partial: bool = False  # some rows landed before the crawl ended early
    # last_completed_page as of the last *committed* batch. Pages are marked complete
    # when their cards are yielded, which can be ahead of what the database holds.
    committed_page: int = 0
    # Likewise for the oldest sale date: only what the committed batches cover.
    committed_oldest: date | None = None
    newest: date | None = None
    state_saved: bool = False


def _run_recorded(
    source: str, district: str, since: date, *, start_page: int = 1, max_pages: int = MAX_PAGES,
    kind: str = "scrape", base_last_page: int = 0, base_oldest: date | None = None,
    watermark: date | None = None,
) -> RunReport:
    """Commit rows before advancing durable progress; persistence failures fail the run."""
    today = stockholm_today()
    if watermark is not None and watermark > today:
        watermark = None
    progress = CrawlProgress()
    report = RunReport(0, progress, committed_page=base_last_page, committed_oldest=base_oldest)
    run_id = None

    def checkpoint() -> None:
        report.committed_page = max(report.committed_page, progress.last_completed_page)
        report.committed_oldest = min(
            (d for d in (report.committed_oldest, progress.oldest_sold_at) if d is not None), default=None
        )

    def _count(n: int) -> None:
        report.upserted += n
        checkpoint()
        scrape_run.bump(
            run_id, pages=progress.pages, rows_upserted=report.upserted,
            rows_rejected=progress.rejected, oldest_sold_at=report.committed_oldest,
            last_page=report.committed_page, required=True,
        )

    async def tracked():
        async for row in _SOURCE_ITER[source](
            district, since, progress=progress, max_pages=max_pages, start_page=start_page
        ):
            sold_at = row.get("soldAt")
            if isinstance(sold_at, date) and sold_at > stockholm_today():
                progress.rejected += 1
                continue
            if isinstance(sold_at, date):
                report.newest = max(report.newest or sold_at, sold_at)
            yield row

    try:
        run_id = scrape_run.start_run(
            source, district, kind=kind, since=since,
            last_page=base_last_page, oldest_sold_at=base_oldest,
        )
        if run_id is None:
            raise RuntimeError("durable run could not be started")
        asyncio.run(_ingest(tracked(), on_batch=_count))
        # The final batch has committed, including pages containing only rejections.
        checkpoint()
    except Exception as e:  # noqa: BLE001
        report.partial = report.upserted > 0 and (kind != "update" or isinstance(e, CrawlIncomplete))
        report.error = " ".join(f"{type(e).__name__}: {e}".split())
    if run_id is not None:
        try:
            scrape_run.finish_run(
                run_id, "ok" if report.error is None else ("partial" if report.partial else "failed"),
                pages=progress.pages, rows_upserted=report.upserted, rows_rejected=progress.rejected,
                oldest_sold_at=report.committed_oldest, last_page=report.committed_page,
                complete_through=(max(report.newest, watermark or report.newest)
                                  if kind == "update" and report.error is None and report.newest else None),
                error=report.error, required=True,
            )
            report.state_saved = True
        except Exception as e:  # noqa: BLE001
            report.partial = report.upserted > 0 and kind != "update"
            report.error = f"{report.error + '; ' if report.error else ''}durable state not saved: {type(e).__name__}: {e}"
    return report


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
@click.option(
    "--max-pages",
    default=MAX_PAGES,
    show_default=True,
    type=click.IntRange(min=1),
    help="Highest result page to fetch (a runaway guard). Use `backfill` for deep history.",
)
@exclusive
def scrape(district: str, since: date, source: str, max_pages: int) -> None:
    """Scrape SOURCE sold-listings for DISTRICT back to SINCE."""
    report = _run_recorded(source, district, since, max_pages=max_pages)
    click.echo(f"upserted {report.upserted} listings for {district} from {source}")
    if report.upserted:
        refresh_deduped()  # also after an incomplete crawl: its rows are stored
    if report.error is not None:
        click.echo(f"crawl incomplete: {report.error}", err=True)
        sys.exit(1)


@cli.command()
@click.option("--district", required=True, type=click.Choice(_ALL_DISTRICTS))
@click.option("--since", required=True, callback=lambda c, p, v: _parse_date(v))
@click.option(
    "--source",
    type=click.Choice(sorted(_SOURCE_ITER.keys())),
    default="hemnet",
    show_default=True,
    help="Which sold-listings source to backfill.",
)
@click.option(
    "--resume",
    is_flag=True,
    help="Continue from the page where the previous backfill of this source/district "
    "(same --since) stopped, instead of starting at page 1.",
)
@click.option(
    "--max-pages",
    default=BACKFILL_MAX_PAGES,
    show_default=True,
    type=click.IntRange(min=1),
    help="Highest result page to fetch.",
)
@exclusive
def backfill(district: str, since: date, source: str, resume: bool, max_pages: int) -> None:
    """Deep, resumable history load for DISTRICT back to SINCE.

    Progress (the next page to fetch and the oldest sale reached) is recorded when a
    run stops early, and each run is logged in ScrapeRun. Result pages are
    newest-first and shift as new sales arrive, so resuming re-reads a little
    rather than skipping anything; upserts are idempotent. A backfill does not move
    the `update` cutoff.
    """
    start_page = 1
    base_next = 1
    base_oldest = None
    if resume:
        saved = crawl_state.backfill_progress(source, district)
        if saved is None:
            click.echo("no recorded progress for this source/district; starting at page 1")
        elif saved["since"] != since:
            click.echo(f"recorded progress is for a different --since ({saved['since']}); starting at page 1")
        else:
            base_next = saved["next_page"]
            base_oldest = saved["oldest_sold_at"]
            start_page = max(1, base_next - 1)
            click.echo(f"resuming {source}/{district} at page {start_page} (recorded: {base_next})")
    report = _run_recorded(
        source, district, since, start_page=start_page, max_pages=max_pages, kind="backfill",
        base_last_page=base_next - 1, base_oldest=base_oldest,
    )
    click.echo(f"upserted {report.upserted} listings for {district} from {source}")
    if report.upserted:
        refresh_deduped()
    if report.error is not None:
        click.echo(f"crawl incomplete: {report.error}", err=True)
        if report.state_saved:
            click.echo(f"progress saved; continue with: backfill ... --resume (next page {report.committed_page + 1})", err=True)
        sys.exit(1)


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
    type=click.IntRange(min=1),
    help="Initial window when no durable update state exists; older history requires backfill.",
)
@click.option(
    "--max-pages",
    default=MAX_PAGES,
    show_default=True,
    type=click.IntRange(min=1),
    help="Highest result page to fetch per source/district (a runaway guard).",
)
@exclusive
def update(
    districts: tuple[str, ...], sources: tuple[str, ...], lookback_days: int, max_pages: int
) -> None:
    """Incrementally refresh: scrape from (newest complete date - 7d) per district per source.

    Designed to run from cron daily/weekly. Idempotent — re-scrapes about a week
    of overlap to catch late-listed sales. The cutoff is scoped to the source so a
    fresh Booli backfill doesn't piggyback on Hemnet's, and it only advances after a
    crawl that finished (see crawl_state.py): partial/failed crawls are retried from
    the same cutoff. Without a database watermark it bootstraps --lookback-days and persists that
    initial window for retries. Older history requires an explicit backfill.
    """
    overlap = timedelta(days=7)
    results: list[UpdateResult] = []
    try:
        for source in sources:
            for d in districts:
                results.append(_refresh(source, d, overlap, lookback_days, max_pages))
        try:
            # Rows that shipped coordinates inline must not stay `pending` just because
            # cron never runs `geocode`. Best-effort: it can't change the exit code.
            mark_inline_pending()
        except Exception as e:  # noqa: BLE001
            click.echo(f"warning: could not relabel inline-coordinate rows: {e}", err=True)
        try:
            # Link cross-source copies the exact dedupKey misses, before the snapshot
            # is refreshed so it sees the clusters. Also best-effort.
            clustered = match_clusters()
            if clustered.rows_updated:
                click.echo(f"clustered {clustered.rows_updated} rows in {clustered.components} clusters")
            _warn_split_keys(clustered.violations)
        except Exception as e:  # noqa: BLE001
            click.echo(f"warning: clustering failed: {e}", err=True)
    finally:
        # Once, after every source/district (partial and failed runs stored rows too).
        # Unconditional: `update` is the cron entry point, so a refresh that failed on a
        # previous run is retried even when this run found nothing new (about 1 s at
        # 200k rows). The other commands only refresh when they wrote rows.
        refresh_deduped()
    click.echo(_format_results(results))
    failed = [r for r in results if r.error is not None and not r.partial]
    partial = [r for r in results if r.partial]
    if failed:
        click.echo(f"{len(failed)} of {len(results)} failed", err=True)
    if partial:
        click.echo(f"{len(partial)} of {len(results)} partial (crawl incomplete)", err=True)
    if failed or partial:
        sys.exit(1)
    click.echo(f"{len(results)} of {len(results)} ok")


@dataclass
class UpdateResult:
    source: str
    district: str
    since: date | None = None
    upserted: int = 0
    error: str | None = None
    # The crawl stopped early (CrawlIncomplete): rows already upserted are kept.
    partial: bool = False


def _refresh(
    source: str, district: str, overlap: timedelta, lookback_days: int, max_pages: int = MAX_PAGES
) -> UpdateResult:
    """Refresh one source/district. Never raises: failures land in the result."""
    result = UpdateResult(source, district)
    try:
        result.since, watermark = crawl_state.update_window(source, district, overlap, lookback_days)
        click.echo(f"{source}/{district}: refreshing since {result.since.isoformat()}")
        report = _run_recorded(source, district, result.since, max_pages=max_pages, kind="update", watermark=watermark)
        result.upserted, result.error, result.partial = report.upserted, report.error, report.partial
        if result.error:
            click.echo(f"  {source}/{district} {'partial' if result.partial else 'failed'}: {result.error}", err=True)
        else:
            click.echo(f"  upserted {result.upserted} for {source}/{district}")
    except Exception as e:  # noqa: BLE001
        result.error = " ".join(f"{type(e).__name__}: {e}".split())
        click.echo(f"  {source}/{district} failed: {result.error}", err=True)
    return result


def _format_results(results: list[UpdateResult]) -> str:
    """Fixed-width summary table, one line per source/district."""
    header = f"{'source':8} {'district':10} {'since':10} {'upserted':>8} {'status':7} error"
    lines = ["", header]
    for r in results:
        since = r.since.isoformat() if r.since else "-"
        status = "partial" if r.partial else ("ok" if r.error is None else "FAILED")
        error = (r.error or "")[:150]
        lines.append(
            f"{r.source:8} {r.district:10} {since:10} {r.upserted:>8} {status:7} {error}".rstrip()
        )
    return "\n".join(lines)


@cli.command()
@click.option("--limit", default=200, show_default=True)
@click.option(
    "--max-attempts",
    default=MAX_GEOCODE_ATTEMPTS,
    show_default=True,
    type=click.IntRange(min=1),
    help="Give up on a row after this many lookups.",
)
@exclusive
def geocode(limit: int, max_attempts: int) -> None:
    """Geocode listings missing lat/lng via Mapbox (pending and previously failed rows).

    Takes the same single-instance lock as scrape/update. Exit codes: 0 done;
    75 (EX_TEMPFAIL) another run holds the lock, Mapbox rate-limited the pass, or
    Mapbox/the network was unavailable (nothing was charged, rows keep their attempt
    budget; run again later); 78 (EX_CONFIG) the Mapbox token is missing or rejected;
    1 an unexpected internal error repeated on several rows (nothing charged).

    A row that Mapbox only ever answers with 5xx/network errors is never charged: it
    stays selectable and costs about 4 requests (with backoff) each time it is reached
    first, and the pass exits 75 when nothing else was answered.
    """
    coordinates_cleared = 0
    summary = None

    def cleanup_committed(count: int) -> None:
        nonlocal coordinates_cleared
        coordinates_cleared += count

    try:
        summary = geocode_pending(limit=limit, max_attempts=max_attempts, on_cleanup=cleanup_committed)
    except GeocodeConfigError as e:
        summary = e.summary
        click.echo(f"error: {e}", err=True)
        sys.exit(EXIT_CONFIG)
    finally:
        if coordinates_cleared or (summary is not None and summary.ok):
            refresh_deduped()
    click.echo(
        f"geocoded: ok {summary.ok}, not found {summary.not_found}, failed {summary.failed}"
    )
    if summary.rate_limited:
        click.echo("rate limited by Mapbox: pass stopped early; run again later", err=True)
        sys.exit(EXIT_TEMPFAIL)
    if summary.unavailable:
        click.echo(
            "Mapbox unavailable (repeated 5xx/network errors): pass stopped early, "
            "no attempts were charged; run again later",
            err=True,
        )
        sys.exit(EXIT_TEMPFAIL)
    if summary.internal_error:
        click.echo(
            "internal error on several rows in a row: pass stopped early, no attempts "
            "were charged (see the log)",
            err=True,
        )
        sys.exit(1)


@cli.command()
@exclusive
def backfill_dedup() -> None:
    """Populate dedupKey on legacy rows that predate the column."""
    committed = False

    def wrote_batch() -> None:
        nonlocal committed
        committed = True

    try:
        n = backfill_dedup_keys(on_commit=wrote_batch)
        click.echo(f"backfilled {n} rows")
    finally:
        # Earlier batches survive a later failure and still change the snapshot.
        if committed:
            refresh_deduped()


@cli.command("reparse")
@click.option("--prune-unparseable", is_flag=True, help="Delete unparseable known-source rows; preview with --dry-run.")
@click.option("--dry-run", is_flag=True, help="Report what would change without writing.")
@click.option(
    "--batch-size",
    default=1000,
    show_default=True,
    type=click.IntRange(min=1),
    help="Rows per keyset batch / transaction.",
)
@exclusive
def reparse_cmd(dry_run: bool, batch_size: int, prune_unparseable: bool) -> None:
    """Re-derive street, house number, rooms, area, prices and dedupKey from `raw`."""
    committed = False

    def wrote_batch() -> None:
        nonlocal committed
        committed = True

    try:
        summary = reparse(dry_run=dry_run, batch_size=batch_size,
                          prune_unparseable=prune_unparseable, on_commit=wrote_batch)
        click.echo(format_summary(summary))
    finally:
        # Earlier batches may already have committed if a later parser fails.
        if not dry_run and committed:
            refresh_deduped()


def _warn_split_keys(violations: list[tuple[str, list[str]]]) -> None:
    if violations:
        click.echo(
            f"warning: {len(violations)} dedupKey(s) span more than one cluster "
            "(the same sale split over clusters); `scraper cluster` heals this",
            err=True,
        )
        for key, cids in violations[:5]:
            click.echo(f"  {key}: {', '.join(cids)}", err=True)


@cli.command("cluster")
@click.option("--dry-run", is_flag=True, help="Report what would be linked without writing.")
@click.option("--batch-size", default=500, show_default=True, type=click.IntRange(min=1),
              help="Clusters written per transaction.")
@exclusive
def cluster_cmd(dry_run: bool, batch_size: int) -> None:
    """Link cross-source copies of one sale that `dedupKey` misses (assigns clusterId).

    Same normalized address, different sources, sold within 3 days, price within 0.5%.
    All rows sharing a dedupKey share one clusterId, which is the smallest dedupKey of
    the cluster. Idempotent; `update` runs it too. Exits 1 if a dedupKey is still split
    over several clusters afterwards.
    """
    summary = match_clusters(dry_run=dry_run, batch_size=batch_size)
    verb = "would update" if dry_run else "updated"
    click.echo(
        f"{'dry run: ' if dry_run else ''}{summary.pairs} matching pairs; {verb} "
        f"{summary.rows_updated} rows in {summary.components} clusters "
        f"({summary.propagated} rows inherited a cluster from their dedupKey)"
    )
    for target, keys in summary.examples:
        click.echo(f"  cluster {target}: {len(keys)} dedupKeys")
    if not dry_run:
        # A previous pass may have written clusters but failed to refresh.
        refresh_deduped()
    if summary.violations:
        _warn_split_keys(summary.violations)
        sys.exit(1)


@cli.command("refresh-view")
@exclusive
def refresh_view() -> None:
    """Refresh the DedupedListingMat snapshot now (what runs after a crawl)."""
    outcome = refresh_deduped()
    if outcome == "refreshed":
        click.echo("refreshed DedupedListingMat")
    elif outcome == "missing":
        click.echo("refresh_deduped_listing() does not exist in this database; nothing to do")
    elif outcome == "busy":
        click.echo("database busy (lock timeout); run again later", err=True)
        sys.exit(EXIT_TEMPFAIL)
    else:
        click.echo("refresh failed (see the log)", err=True)
        sys.exit(1)


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
    _echo_snapshot_counts()
    _warn_split_keys(dedup_keys_in_multiple_clusters())


def _echo_snapshot_counts() -> None:
    """When the DedupedListingMat snapshot exists, show it next to the live view and
    warn if they differ: by row count, or by the newest lastSeenAt (same count but
    stale content, e.g. a refresh failed after rows were re-scraped)."""
    with engine().connect() as c:
        if not c.execute(text("SELECT to_regclass('\"DedupedListingMat\"') IS NOT NULL")).scalar_one():
            return
        live, live_seen = c.execute(
            text('SELECT COUNT(*), MAX("lastSeenAt") FROM "DedupedListing"')
        ).one()
        snap, snap_seen = c.execute(
            text('SELECT COUNT(*), MAX("lastSeenAt") FROM "DedupedListingMat"')
        ).one()
    click.echo(
        f"DedupedListing {live:>8} (newest seen {live_seen})  "
        f"DedupedListingMat {snap:>8} (newest seen {snap_seen})"
    )
    if (live, live_seen) != (snap, snap_seen):
        click.echo(
            "warning: DedupedListing and DedupedListingMat differ (row count or newest "
            "lastSeenAt); run `scraper refresh-view`",
            err=True,
        )


if __name__ == "__main__":
    cli()
