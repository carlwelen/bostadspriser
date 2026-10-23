-- refresh_deduped_listing() used REFRESH ... CONCURRENTLY. Twice the test suite
-- hung for 15+ minutes inside it (one CPU-bound backend, every later TRUNCATE
-- queued behind it), while the same refresh normally takes well under a second.
-- CONCURRENTLY builds a temporary table and diffs it against the snapshot with
-- a plan the planner picks without statistics for that temp table, which is a
-- production risk for no real benefit here: a plain refresh at 200k rows takes
-- about a second and runs once per scrape run.
--
-- So: a plain REFRESH. It briefly takes an ACCESS EXCLUSIVE lock, so readers
-- wait for those ~1-2 s; call the function in its own short transaction (not
-- at the start of a long one), once per scrape run.
CREATE OR REPLACE FUNCTION refresh_deduped_listing() RETURNS void
LANGUAGE sql
AS $$ REFRESH MATERIALIZED VIEW "DedupedListingMat" $$;
