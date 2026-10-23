-- DedupedListing could pick a duplicate whose "pricePerSqmSek" is 0 (a source
-- that failed to parse the price) while another copy of the same sale was
-- priced. Every aggregation filters on "pricePerSqmSek" > 0, so the sale then
-- vanished. Priced rows now win first; the rest of the ordering is unchanged
-- (coordinates, source priority, "lastSeenAt", id) and so is the column list.
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
