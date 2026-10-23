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
