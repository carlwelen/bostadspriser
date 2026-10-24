# Reviewing and pruning unparseable rows (B36)

`reparse` keeps its existing behavior by default: re-derive valid rows and report
unparseable rows without deleting them. Reports distinguish known-source rows
eligible for pruning from unknown sources, which are always retained.

Preview the explicit pruning option before using it:

```sh
uv run scraper reparse --prune-unparseable --dry-run --batch-size 1000
```

The preview writes nothing. It shows the eligible count and up to 20 eligible
row IDs, separately from unknown-source diagnostics. A preview is advisory: data
may change before a later invocation. The writing command is:

```sh
uv run scraper reparse --prune-unparseable --batch-size 1000
```

Only rows with a registered source parser (currently Hemnet and Booli) whose raw
card cannot be parsed by that parser are eligible. The writing run selects each
batch with `FOR UPDATE`, re-evaluates its current raw cards while holding those
locks, then deletes only proven unparseable known-source rows in that transaction.
A parser exception aborts the current batch; it is not treated as proof that a
row is unparseable. Valid rows and unknown-source rows are retained.

Each batch commits independently. If a later batch fails, earlier batches may
already have changed or deleted rows. The CLI refreshes the materialized snapshot
and attempts normal web-cache revalidation after committed writes, including a
run that only deletes rows or fails after earlier commits. Dry-run and report-only
runs with no writes do not refresh. Repeating a completed prune removes nothing
further unless the underlying rows or parsers have changed.

Implementation verification uses isolated test databases and hermetic HTTP
transports only; this task does not run pruning against the development database
or any actual scraped dataset.
