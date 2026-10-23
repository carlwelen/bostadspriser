-- AlterTable: when a scraper last saw each sale. `scrapedAt` is only the first
-- insert, so the view's "most recently scraped" tie-breaker was really "first
-- scraped". Existing rows are backfilled from scrapedAt (their only known
-- sighting); the column then becomes NOT NULL with a DB default so inserts that
-- don't mention it keep working.
ALTER TABLE "Listing" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

UPDATE "Listing" SET "lastSeenAt" = "scrapedAt";

ALTER TABLE "Listing" ALTER COLUMN "lastSeenAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Listing" ALTER COLUMN "lastSeenAt" SET NOT NULL;

-- Recreate DedupedListing with "lastSeenAt" as the final tie-breaker (an id
-- tail keeps the pick deterministic when even that ties). Same shape as the
-- previous version: all Listing columns (l.* now also carries "lastSeenAt")
-- followed by `sources`. DROP + CREATE because CREATE OR REPLACE can't insert a
-- column before `sources`.
DROP VIEW IF EXISTS "DedupedListing";

CREATE VIEW "DedupedListing" AS
WITH source_groups AS (
  SELECT
    COALESCE("dedupKey", id::text) AS group_key,
    array_agg(DISTINCT source ORDER BY source) AS sources
  FROM "Listing"
  GROUP BY group_key
)
SELECT DISTINCT ON (COALESCE(l."dedupKey", l.id::text))
       l.*,
       sg.sources
FROM "Listing" l
JOIN source_groups sg
  ON sg.group_key = COALESCE(l."dedupKey", l.id::text)
ORDER BY COALESCE(l."dedupKey", l.id::text),
         (l.lat IS NOT NULL) DESC,
         CASE l.source
           WHEN 'hemnet' THEN 0
           WHEN 'booli'  THEN 1
           ELSE 2
         END ASC,
         l."lastSeenAt" DESC,
         l.id ASC;
