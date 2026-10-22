-- Extend DedupedListing so consumers know which source(s) reported each sale.
-- The previous view only exposed the winning row's `source`; this version adds
-- a `sources` text[] containing every source that reported the same dedupKey.
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
         l."scrapedAt" DESC;
