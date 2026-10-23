-- Fuzzy cross-source matching: "clusterId" groups the copies of one real-world
-- sale whose exact dedupKeys differ (e.g. a price differing by a few kronor, or
-- an address spelled differently). Nullable: rows the matcher hasn't touched
-- behave exactly as before.

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "clusterId" VARCHAR(64);

-- CreateIndex
CREATE INDEX "Listing_clusterId_idx" ON "Listing"("clusterId");

-- Recreate DedupedListing so it groups on the cluster when there is one:
-- COALESCE("clusterId", "dedupKey", id). Row preference (priced, coordinates,
-- source priority, "lastSeenAt", id) is unchanged, and `sources` is now
-- aggregated over the whole cluster. The column list gains "clusterId" via l.*,
-- before `sources`.
DROP VIEW IF EXISTS "DedupedListing";

CREATE VIEW "DedupedListing" AS
WITH source_groups AS (
  SELECT
    COALESCE("clusterId", "dedupKey", id::text) AS group_key,
    array_agg(DISTINCT source ORDER BY source) AS sources
  FROM "Listing"
  GROUP BY group_key
)
SELECT DISTINCT ON (COALESCE(l."clusterId", l."dedupKey", l.id::text))
       l.*,
       sg.sources
FROM "Listing" l
JOIN source_groups sg
  ON sg.group_key = COALESCE(l."clusterId", l."dedupKey", l.id::text)
ORDER BY COALESCE(l."clusterId", l."dedupKey", l.id::text),
         (l."pricePerSqmSek" > 0) DESC,
         (l.lat IS NOT NULL) DESC,
         CASE l.source
           WHEN 'hemnet' THEN 0
           WHEN 'booli'  THEN 1
           ELSE 2
         END ASC,
         l."lastSeenAt" DESC,
         l.id ASC;
