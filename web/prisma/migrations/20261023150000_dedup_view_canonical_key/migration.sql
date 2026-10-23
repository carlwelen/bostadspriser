-- DedupedListing double-counted a sale when an exact copy arrived after the
-- fuzzy matcher had clustered it: upserts never set "clusterId", so the new
-- copy (same "dedupKey" as a clustered row, no "clusterId") formed its own
-- group. The group key is now derived across both columns: a row without a
-- "clusterId" inherits the cluster of any row that shares its "dedupKey".
--
--   group_key = COALESCE(own clusterId, cluster of its dedupKey, dedupKey, id)
--
-- Also: the coordinate preference now needs both lat and lng, so a lat-only
-- copy no longer ties with a fully geocoded one. Other preferences, the column
-- list and `sources` (aggregated over the whole group) are unchanged.
--
-- Listing_clusterId_idx serves the matcher's lookups, not this view (the view
-- scans the whole table anyway).
DROP VIEW IF EXISTS "DedupedListing";

CREATE VIEW "DedupedListing" AS
WITH key_cluster AS (
  SELECT "dedupKey", MIN("clusterId") AS cluster_id
  FROM "Listing"
  WHERE "clusterId" IS NOT NULL AND "dedupKey" IS NOT NULL
  GROUP BY "dedupKey"
), keyed AS (
  SELECT l.id,
         COALESCE(l."clusterId", kc.cluster_id, l."dedupKey", l.id::text) AS group_key
  FROM "Listing" l
  LEFT JOIN key_cluster kc ON kc."dedupKey" = l."dedupKey"
), source_groups AS (
  SELECT k.group_key,
         array_agg(DISTINCT l.source ORDER BY l.source) AS sources
  FROM keyed k
  JOIN "Listing" l ON l.id = k.id
  GROUP BY k.group_key
)
SELECT DISTINCT ON (k.group_key)
       l.*,
       sg.sources
FROM "Listing" l
JOIN keyed k ON k.id = l.id
JOIN source_groups sg ON sg.group_key = k.group_key
ORDER BY k.group_key,
         (l."pricePerSqmSek" > 0) DESC,
         (l.lat IS NOT NULL AND l.lng IS NOT NULL) DESC,
         CASE l.source
           WHEN 'hemnet' THEN 0
           WHEN 'booli'  THEN 1
           ELSE 2
         END ASC,
         l."lastSeenAt" DESC,
         l.id ASC;
