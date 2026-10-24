# Durable crawl state (B45)

Deploy Prisma migration `20261024110000_crawl_state` before this scraper version.
New scrape, update and backfill commands record their explicit kind and original
`since` in `ScrapeRun` before fetching. State database failures are command
failures; they cannot silently advance a watermark or report a saved checkpoint.

There is **no automatic read, import or write of `crawl_state.json`**. Existing
`legacy` runs retain their kind and do not establish update coverage or backfill
resume points. Existing Listing maxima cannot prove contiguous coverage either.
On upgrade with no database update state, `update` starts at today minus
`--lookback-days` (default 14). It persists and reuses this initial cutoff after
partial, failed or empty attempts, even if a retry requests a smaller lookback.
Only a successful nonempty update supplies `completeThrough`; later updates use
that watermark minus seven days. Empty/failed/partial runs cannot replace it.
A newer observed sale cannot make an older successful watermark move backwards.

This bootstrap claims no unverifiable legacy historical coverage. Load or repair
older history with an explicit `backfill --since YYYY-MM-DD`; review its database
run records rather than importing the old protected JSON file. Backfills always
use kind `backfill`, including page-one runs, and never count as freshness.

`pages` counts this invocation. `lastPage` is the absolute last completed page
whose rows committed. A failed batch cannot advance it. A retry with `--resume`
uses only the latest backfill with the same `since` and non-ok status, starting
at `max(1, lastPage)` (one page of overlap). The recorded page and oldest committed
date are carried forward if that retry makes no new progress. A latest successful
backfill clears the resume point. Completed rejection-only pages may be recorded
at a successful finish; conservative earlier checkpoints can reread pages.
