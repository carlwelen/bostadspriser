-- B45 C half: additive state contract; deploy before the Python writer adopts it.
-- Old writers keep working with kind=legacy, lastPage=0 and null state dates.
-- Existing runs cannot be safely retroclassified: they did not record whether
-- they started at page 1, resumed history, or ran an incremental update.
-- Freshness retains legacy/scrape/update behavior and excludes every backfill.
CREATE TYPE "ScrapeKind" AS ENUM ('legacy', 'scrape', 'update', 'backfill');
ALTER TABLE "ScrapeRun"
  ADD COLUMN kind "ScrapeKind" NOT NULL DEFAULT 'legacy',
  ADD COLUMN "lastPage" integer NOT NULL DEFAULT 0,
  ADD COLUMN since date,
  ADD COLUMN "completeThrough" date,
  ADD CONSTRAINT "ScrapeRun_lastPage_nonnegative" CHECK ("lastPage" >= 0),
  ADD CONSTRAINT "ScrapeRun_completeThrough_successful_update" CHECK (
    "completeThrough" IS NULL OR
    (kind = 'update' AND status = 'ok' AND "finishedAt" IS NOT NULL)
  );
CREATE INDEX "ScrapeRun_source_district_kind_startedAt_idx"
  ON "ScrapeRun" (source, district, kind, "startedAt");

-- Python adoption contract:
-- * Explicit kind on start; since is the original requested cutoff.
-- * Persist lastPage only after the page's rows commit, not when yielded.
--   pages remains this invocation's count. lastPage is absolute, with 0 unknown.
-- * Resume the latest backfill for source/district only when since matches and
--   status is not ok: next_page=lastPage+1, restart=max(1,next_page-1). Carry the
--   previous lastPage/oldestSoldAt forward when a retry makes no new progress.
--   A latest ok backfill means complete, replacing the old JSON-key removal.
-- * On successful update finish, completeThrough is the newest date that crawl
--   observed. Derive the next cutoff from the latest ok update with a non-null
--   completeThrough, not MAX(Listing.soldAt). Partial/failed/empty updates leave
--   it null and cannot replace a previous watermark.
-- * No automatic import of protected JSON state or inference from legacy rows.
--   The Python half owns fallback/import and must switch readers and writers
--   together. Historical backfills must always set kind=backfill, even on page1.
