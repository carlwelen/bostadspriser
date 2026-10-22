-- AlterTable: dedup key column for cross-source dedup.
ALTER TABLE "Listing" ADD COLUMN "dedupKey" VARCHAR(64);

-- CreateIndex
CREATE INDEX "Listing_dedupKey_idx" ON "Listing"("dedupKey");

-- CreateView: aggregations read from this instead of "Listing" so they never
-- see Hemnet+Booli double-counting. When two rows share a dedupKey:
--   1. The row with coordinates wins (Hemnet ships them inline; Booli often
--      doesn't, and we don't want to lose lat/lng on the heatmap).
--   2. Tie-broken by an explicit source priority — Hemnet first today.
--   3. Final fallback: the most recently scraped row.
--
-- COALESCE on id::text keeps legacy NULL-dedupKey rows visible as singletons
-- until backfill_dedup_keys() finishes.
CREATE OR REPLACE VIEW "DedupedListing" AS
SELECT DISTINCT ON (COALESCE("dedupKey", id::text))
       *
FROM "Listing"
ORDER BY COALESCE("dedupKey", id::text),
         (lat IS NOT NULL) DESC,
         CASE source
           WHEN 'hemnet' THEN 0
           WHEN 'booli'  THEN 1
           ELSE 2
         END ASC,
         "scrapedAt" DESC;
