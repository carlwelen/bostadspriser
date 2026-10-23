-- Geocoding bookkeeping. "geocodedAt" was stamped even when the lookup found
-- nothing, so a failed lookup looked like a success. The status records the
-- outcome of the last attempt:
--   pending    never tried, or a retry is wanted
--   ok         coordinates came from the geocoder
--   inline     coordinates shipped with the source's own data
--   not_found  the geocoder answered but had no match
--   failed     the attempt errored (network, rate limit); retry later
-- New rows start as 'pending'; the scraper sets the status when it writes
-- coordinates or tries a lookup.

-- CreateEnum
CREATE TYPE "GeocodeStatus" AS ENUM ('pending', 'ok', 'not_found', 'failed', 'inline');

-- AlterTable
ALTER TABLE "Listing"
  ADD COLUMN "geocodeStatus" "GeocodeStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "geocodeAttempts" INTEGER NOT NULL DEFAULT 0;

-- Backfill from what the old columns can tell us. Rows with coordinates are
-- 'ok' (we can't tell inline from geocoded after the fact); rows that were
-- stamped without coordinates were attempted and found nothing; the rest were
-- never tried and keep the 'pending' default.
UPDATE "Listing" SET "geocodeStatus" = 'ok', "geocodeAttempts" = CASE WHEN "geocodedAt" IS NULL THEN 0 ELSE 1 END
  WHERE lat IS NOT NULL AND lng IS NOT NULL;
UPDATE "Listing" SET "geocodeStatus" = 'not_found', "geocodeAttempts" = 1
  WHERE (lat IS NULL OR lng IS NULL) AND "geocodedAt" IS NOT NULL;

-- CreateIndex
CREATE INDEX "Listing_geocodeStatus_idx" ON "Listing"("geocodeStatus");

-- Recreate DedupedListing so its l.* picks up the new columns (a view's column
-- list is fixed when it is created). Definition otherwise identical to
-- 20261023110000_dedup_prefer_priced.
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
         (l."pricePerSqmSek" > 0) DESC,
         (l.lat IS NOT NULL) DESC,
         CASE l.source
           WHEN 'hemnet' THEN 0
           WHEN 'booli'  THEN 1
           ELSE 2
         END ASC,
         l."lastSeenAt" DESC,
         l.id ASC;
