-- U+212B (Angstrom sign) lowercases to å in JS, then folds to a. Preserve
-- existing URL behavior without changing the already applied slug migration.
BEGIN;
CREATE OR REPLACE FUNCTION street_slug(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT trim(BOTH '-' FROM regexp_replace(
    lower(translate(replace(value, 'İ', U&'i\0307'),
      'ÅÄÖÉåäöéKÅ', 'AAOEaaoeka') COLLATE "C"),
    '[^a-z0-9]+', '-', 'g'))
$$;
-- Correct already persisted values; the trigger maintains future writes.
UPDATE "Listing" SET "streetSlug" = street_slug(street) WHERE "streetSlug" IS DISTINCT FROM street_slug(street);
-- Readers use the snapshot, so make corrected URLs visible in the same commit.
SELECT refresh_deduped_listing();
COMMIT;
