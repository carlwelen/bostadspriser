-- Stable URL slugs follow shared/slug-vectors.json and lib/text.ts. Use ASCII
-- lowercasing after explicit Unicode folds so database locale cannot change URLs.
-- JS lowercases U+0130 to i + combining dot, and Kelvin sign to k.
CREATE FUNCTION street_slug(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT trim(BOTH '-' FROM regexp_replace(
    lower(translate(replace(value, 'İ', U&'i\0307'),
      'ÅÄÖÉåäöéK', 'AAOEaaoek') COLLATE "C"),
    '[^a-z0-9]+', '-', 'g'))
$$;

DROP MATERIALIZED VIEW "DedupedListingMat";
DROP VIEW "DedupedListing";
ALTER TABLE "Listing" ADD COLUMN "streetSlug" text NOT NULL DEFAULT '';
UPDATE "Listing" SET "streetSlug" = street_slug(street);

CREATE FUNCTION maintain_street_slug() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."streetSlug" := street_slug(NEW.street);
  RETURN NEW;
END
$$;
CREATE TRIGGER "Listing_streetSlug"
BEFORE INSERT OR UPDATE ON "Listing"
FOR EACH ROW EXECUTE FUNCTION maintain_street_slug();
CREATE INDEX "Listing_district_streetSlug_idx" ON "Listing" (district, "streetSlug");

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

CREATE MATERIALIZED VIEW "DedupedListingMat" AS
SELECT * FROM "DedupedListing"
WITH DATA;

-- Required for REFRESH ... CONCURRENTLY; "id" is unique in the view (one
-- canonical row per group).
CREATE UNIQUE INDEX "DedupedListingMat_id_key" ON "DedupedListingMat" (id);

-- Match the query shapes in aggregations.ts: district time series and
-- summaries, street/house drill-downs, the map's bounding box, and "newest
-- first" scans.
CREATE INDEX "DedupedListingMat_district_soldAt_idx"
  ON "DedupedListingMat" (district, "soldAt");
CREATE INDEX "DedupedListingMat_district_street_houseNumber_soldAt_idx"
  ON "DedupedListingMat" (district, street, "houseNumber", "soldAt");
CREATE INDEX "DedupedListingMat_lat_lng_idx"
  ON "DedupedListingMat" (lat, lng);
CREATE INDEX "DedupedListingMat_soldAt_idx"
  ON "DedupedListingMat" ("soldAt" DESC);

CREATE INDEX "DedupedListingMat_district_streetSlug_idx"
ON "DedupedListingMat" (district, "streetSlug");
-- The refresh function survives view recreation; retain its plain REFRESH and
-- existing 5s lock_timeout. Snapshot reads remain stale until it is called.
