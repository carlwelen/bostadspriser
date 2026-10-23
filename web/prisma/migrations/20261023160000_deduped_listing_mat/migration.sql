-- Fast reads for the deduplicated view (B21, see docs/perf.md).
--
-- "DedupedListing" computes its groups with a sort and joins over the whole
-- "Listing" table on every query: ~1-2 s per query at 200k rows. The web app
-- now reads a materialized snapshot of it instead, with indexes that match its
-- queries. The live view stays as the single definition of the dedup rules
-- (and is what the scraper's own tests use); the snapshot is refreshed by
--
--     SELECT refresh_deduped_listing();
--
-- which the scraper must call after each run (until then the web app shows the
-- previous snapshot). REFRESH ... CONCURRENTLY keeps readers unblocked.
--
-- Maintenance note: the snapshot depends on the live view, so a migration that
-- recreates "DedupedListing" (e.g. after adding a Listing column) must first
-- DROP MATERIALIZED VIEW "DedupedListingMat" and then recreate it with its
-- indexes, as below.

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

CREATE FUNCTION refresh_deduped_listing() RETURNS void
LANGUAGE sql
AS $$ REFRESH MATERIALIZED VIEW CONCURRENTLY "DedupedListingMat" $$;
