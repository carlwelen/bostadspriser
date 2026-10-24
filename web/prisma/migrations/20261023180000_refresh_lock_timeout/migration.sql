-- A plain REFRESH needs an ACCESS EXCLUSIVE lock on "DedupedListingMat". If a
-- long reader holds the snapshot, the refresh queues for the lock and every
-- later page query queues behind the refresh. Give up after 5 s instead: the
-- caller sees a "lock timeout" error, the readers carry on with the previous
-- snapshot, and the scraper can retry.
--
-- Callers must not run this inside a long transaction: the lock is held until
-- that transaction ends. Call it in its own short transaction, once per run.
ALTER FUNCTION refresh_deduped_listing() SET lock_timeout = '5s';
