-- refresh_deduped_listing() used REFRESH ... CONCURRENTLY. Twice the test suite
-- hung for 15+ minutes inside it (one CPU-bound backend, every later TRUNCATE
-- queued behind it), while the same refresh normally takes well under a second.
-- Intermittent CPU-bound stall under mass TRUNCATE/refill of "Listing",
-- reproduced by the reviewer; root cause unknown. CONCURRENTLY also buys
-- nothing here: a plain refresh at 200k rows takes about a second and runs once
-- per scrape run.
--
-- So: a plain REFRESH. It briefly takes an ACCESS EXCLUSIVE lock, so readers
-- wait for those ~1-2 s; call the function in its own short transaction (not
-- at the start of a long one), once per scrape run.
CREATE OR REPLACE FUNCTION refresh_deduped_listing() RETURNS void
LANGUAGE sql
AS $$ REFRESH MATERIALIZED VIEW "DedupedListingMat" $$;
