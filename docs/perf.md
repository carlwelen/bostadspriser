# Performance record

Measurements for backlog item B21 (and a place for later ones). Reproduce with

```
cd web && TEST_DB_NAME=bostadspriser_test_c pnpm perf     # not part of scripts/check.sh
```

The run uses its own database `<TEST_DB_NAME>_perf`, creates and migrates it if
needed, and fills it with synthetic data (`web/tests/perf/synthetic.ts`) on the
first run. It times each aggregation function (median of 5 warm runs, wall clock
including Prisma) and runs `EXPLAIN (ANALYZE, BUFFERS)` on every statement the
function issues. The table and all plans are written to
`web/tests/perf/last-run.txt` (untracked).

## Dataset

- 200,000 raw `Listing` rows: 150,000 Hemnet sales over about five years across
  4 districts x 300 streets, plus 50,000 Booli copies of some of them (same
  `dedupKey`, half without coordinates). 2% of rows carry a `clusterId`.
- 150,000 rows after deduplication.
- Local Postgres 16, default configuration (`work_mem` 4 MB), Apple silicon laptop.
  Absolute numbers will differ on a server, the ratios should not.

## Before: `DedupedListing` as a live view

`DISTINCT ON (group key)` over the whole table with a CTE that derives the
group key (B13 review) and a per-group `sources` aggregate. Every query pays a
200k-row join plus a sort (spilling to temp files at `work_mem` 4 MB) before its
own `WHERE` is applied, because the district filter cannot be pushed below
`DISTINCT ON`.

| query | median wall ms | statements | EXPLAIN execution ms |
|---|---|---|---|
| districtTimeseries | 1153 | 1 | 1360 |
| streetTimeseries | 871 | 1 | 1085 |
| addressDrawerData (12mo) | 1325 | 2 | 2622 |
| heatmapPoints (district, 365d) | 875 | 1 | 1459 |
| heatmapPoints (everything) | 1428 | 1 | 1753 |
| listStreets | 1243 | 1 | 1731 |
| listAllStreets | 1456 | 1 | 1585 |
| districtSummary | 1734 | 1 | 1709 |
| globalSummary | 2345 | 2 | 3472 |
| streetFromSlug | 1450 | 1 | 1356 |
| topMovers | 1638 | 1 | 1322 |

A district page issues roughly five of these, so about 6-8 s of database time
per uncached render at this size.

## Decision

Materialize the view. A maintained flag/`group_key` column would keep reads
live, but the canonical row of a group changes whenever any member is inserted,
re-priced, geocoded or re-clustered (including the cluster-inheritance rule),
so the trigger would have to recompute whole groups on every upsert and on
every `clusterId` write. That is a lot of subtle code on the scraper's hot path
for data that is only refreshed in batches anyway. A materialized snapshot that
is refreshed once after each scrape run is simple, and the measurements below
show the reads become cheap.

Design (migration `20261023160000_deduped_listing_mat`):

- `"DedupedListing"` stays as the live view and the single definition of the
  dedup rules. The scraper's own tests keep using it.
- `"DedupedListingMat"` = `SELECT * FROM "DedupedListing"`, with a unique index
  on `id` (one canonical row per group)
  and indexes `(district, soldAt)`, `(district, street, houseNumber, soldAt)`,
  `(lat, lng)` and `(soldAt DESC)`.
- `SELECT refresh_deduped_listing();` refreshes it (a plain `REFRESH`; readers
  wait ~1-3 s, see below). **The scraper must call it after each run**, in its
  own short transaction; until then the web app shows the previous snapshot. `web/tests/support/seed.ts` calls it, so
  the integration and e2e fixtures are refreshed.
- `web/src/lib/aggregations.ts` reads `"DedupedListingMat"`.
- A migration that recreates `"DedupedListing"` must drop and recreate the
  snapshot (it depends on the view); the migration says so.

## After

(Second run, on a machine that was also running other test suites, so a few
numbers are noisier than the first run: every query stayed within 0-175 ms.)

| query | median wall ms | statements | EXPLAIN execution ms | speed-up (wall) |
|---|---|---|---|---|
| districtTimeseries | 29 | 1 | 33 | 40x |
| streetTimeseries | 1 | 1 | 0 | 870x |
| addressDrawerData (12mo) | 1 | 2 | 0 | >1000x |
| heatmapPoints (district, 365d) | 7 | 1 | 4 | 125x |
| heatmapPoints (everything) | 103 | 1 | 26 | 14x |
| listStreets | 38 | 1 | 42 | 33x |
| listAllStreets | 174 | 1 | 206 | 8x |
| districtSummary | 47 | 1 | 49 | 37x |
| globalSummary | 160 | 2 | 241 | 15x |
| streetFromSlug | 15 | 1 | 16 | 97x |
| topMovers | 34 | 1 | 38 | 48x |
| `refresh_deduped_listing()` | 2528 | 1 | - | (new) |

The remaining cost is in whole-table aggregates (`listAllStreets`,
`globalSummary`, the unfiltered heatmap, which also serializes the rows) and the
per-district scans.

A refresh takes about 1.7-2.5 s at 200k rows, so calling it once per scrape run
(or per district) is fine; calling it per page is not.

### Why a plain REFRESH, not CONCURRENTLY

The first version used `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Twice the
integration suite hung for 15+ minutes inside it (a single CPU-bound backend,
every later `TRUNCATE` queued behind it) although the same call normally takes
well under a second; I could not reproduce it in isolation. CONCURRENTLY diffs
the new rows against the snapshot through a temporary table that has no
statistics, so a bad plan is plausible, and that is not a risk worth taking for
a once-per-run refresh. A plain refresh blocks readers for its duration
(~1-3 s at 200k rows), is predictable, and has no diff step. The unique index
on `id` is kept (cheap, and it allows going back to CONCURRENTLY if the data
ever grows enough for the blocking to matter). Call the function in its own
short transaction, not at the start of a long one, so the lock is not held
while the scraper does other work.

## Not done / ideas

- `heatmapPoints` compares `district::text IN (...)`, which cannot use the
  `(district, soldAt)` index; it falls back to the `soldAt` index and a
  filter. Casting the bound values to the enum instead would let it use the
  composite index. It is already ~4 ms, so it was left alone.
- If the data ever outgrows a full refresh (millions of rows), switch to
  incremental maintenance of a group-key column.

## Heatmap payload (B25)

`GET /api/heatmap` returns at most `HEATMAP_LIMIT` = 30,000 features, newest
sales first, and a top-level `truncated: boolean` (a GeoJSON foreign member,
ignored by Mapbox) that is true when older matching sales were cut.

- Why 30,000: a feature is about 250 bytes of JSON, so the cap is ~7.5 MB raw
  (roughly 1 MB gzipped) and about the most Mapbox GL takes comfortably as a
  single GeoJSON source. The UI's default period (12 months) stays well below
  it; "all time" over a large database is what reaches it, and dropping the
  oldest sales is the least harmful way to cap.
- Properties kept: `pricePerSqm`, `address`, `street`, `houseNumber`,
  `district`, `soldAt`, `sources` (everything `HeatmapMap` reads for the
  popup, hover list and address drawer). Dropped: `source` and `dedupKey`,
  which nothing reads. Coordinates are rounded to 5 decimals (~1 m).
- Compression: **`next start` does not gzip route-handler responses** (checked:
  no `Content-Encoding` on a 36 KB response with `Accept-Encoding: gzip`, and
  `compress` is on by default), so enable gzip/brotli at the reverse proxy or
  CDN in front of the app (e.g. nginx `gzip on; gzip_types application/json;`).
  The JSON is repetitive: a 37 KB fixture response gzips to 2 KB.

## Caching (B24)

Every page is `force-dynamic` and renders per request, but the data changes a
few times a day at most. Instead of editing the pages (E's and D's files), the
aggregation functions in `web/src/lib/aggregations.ts` are wrapped with
`cached()` (`web/src/lib/cache.ts`), which uses Next's data cache
(`unstable_cache`):

- **Tags.** Every entry carries `listings` and `agg:<function name>`.
- **Invalidation.** `POST /api/revalidate` with `Authorization: Bearer
  $REVALIDATE_SECRET` (scheme case-insensitive) drops entries by tag (body
  `{"tags": ["listings"]}`; no body means `listings`). Valid tags are `listings`
  and `agg:<name>` for the functions actually passed to `cached()`. 401 without
  a Bearer token, 403 for a wrong token or when `REVALIDATE_SECRET` is missing
  or shorter than 16 characters (then nobody can invalidate), 400 for a
  malformed body or unknown tag. The secret is compared in constant time
  (SHA-256 of both sides, then `timingSafeEqual`).
- **Who calls it.** The scraper calls it after a successful committed
  `refresh_deduped_listing()` (B49). `APP_URL` and a 16+ character
  `REVALIDATE_SECRET` configure the notification; failures are logged safely
  and do not abort the completed database operation. The call has a five-second
  timeout, no redirects, no inherited proxy settings and no retries.
- **Safety net.** Entries expire after 3600 s (freshness queries: 300 s), so a
  missed call means up to an hour of stale pages, not forever.
- **Which functions.** Everything the pages and `/api/streets*` /
  `/api/timeseries` use. Not cached: `heatmapPoints` and `addressDrawerData`
  (large or keyed by free-form input; they rely on the HTTP `Cache-Control`
  headers) and `dedupKeysInMultipleClusters` (a diagnostic). Cached results must
  survive JSON (no Date/bigint/Decimal/undefined); a test calls every cached
  function twice and compares the fresh result with the cache hit.
- **Memory only.** `next.config.ts` sets `experimental.isrFlushToDisk: false`,
  which keeps the data cache in an LRU with explicit `cacheMaxMemorySize:
  16 * 1024 * 1024` (16 MiB) and never writes `.next/cache/fetch-cache`.
  This bounds serialized payload size, not process heap: keys, objects and
  per-entry overhead use additional memory, especially with many tiny entries.
  `streetFromSlug` misses return null without populating the cache; valid
  lookups still cache and revalidate normally, with one query on a cold lookup. Without it, some cached
  queries are keyed by URL input (street names, slugs, house numbers), so
  anonymous requests grew the on-disk cache without bound (200 random street ids
  added ~200 files), Next never cleans it, and it would also outlive restarts.
  Checked against a real `next start`: 400 requests with random street ids left
  the `fetch-cache` directory at 31 files before and after, while identical
  requests were still served from cache.
- **Where it is active.** Only when `NODE_ENV=production`; `AGG_CACHE=on|off`
  overrides. `next dev` and vitest always query the database.
- **`next build` needs no database.** The pages are dynamic and nothing runs an
  aggregation at build time.
- **No leakage across the e2e seed.** The cache is in memory, so it dies with
  the server process; Playwright starts a fresh server for every run, its
  readiness probe is `/robots.txt` (no database), and the fixture is seeded
  before the first data request. Old on-disk entries from earlier runs are never
  read (`isrFlushToDisk: false` also skips reads). A spec that changed data
  after the server's first data request would have to call `/api/revalidate`
  (set a 16+ character `REVALIDATE_SECRET` in the web server's env).
- **`asOf` defaults lag.** Functions with an `asOf = new Date()` default
  (`topMovers`, `districtMomChange`) compute their windows when the entry is
  filled and keep it until expiry or revalidation: across midnight or a month
  boundary a page can show the previous day's windows (or, for the month-over-
  month change, the previous month) for up to 3600 s. Passing an explicit `asOf`
  that is not midnight UTC makes a key per call, so it throws outside
  production and runs uncached (with one warning) in production.
- **Single instance.** `revalidateTag` and the in-memory cache are per server
  process. With several web instances, a call reaches only the instance that
  receives it, and the others serve cached data until expiry (at most an hour).
  A multi-instance deployment needs a shared cache handler or one call per
  instance.

No page needs to change. Optional, for E and D: the pages could move from
`force-dynamic` to `revalidate = 3600` for HTTP-level caching as well; that is a
one-line change per page and not required for any of this.
