import type { PrismaClient } from "@prisma/client";

/** Hemnet-only rows; each also gets a Booli copy for the first `COPIES` of them. */
export const BASE_ROWS = 150_000;
export const COPIES = 50_000;

/**
 * Fill "Listing" with a synthetic, roughly Stockholm-shaped dataset:
 * 150k Hemnet sales over ~5 years across 4 districts x 300 streets, plus 50k
 * Booli copies of some of them (same dedupKey; half without coordinates), and a
 * sprinkle of clustered rows. ~200k raw rows, ~150k after deduplication.
 * Runs in SQL so it takes seconds. Idempotent: does nothing if already seeded.
 */
export async function seedSynthetic(prisma: PrismaClient): Promise<boolean> {
  const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  if (!/(^|_)test(_|$)/.test(db)) throw new Error(`refusing to seed non-test database "${db}"`);
  const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM "Listing"`;
  if (Number(n) >= BASE_ROWS) return false;

  await prisma.$executeRawUnsafe(`TRUNCATE "Listing"`);
  await prisma.$executeRawUnsafe(`SELECT setseed(0.42)`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Listing" (id, source, "sourceId", "dedupKey", "clusterId", street, "houseNumber",
                           district, rooms, "areaSqm", "priceSek", "pricePerSqmSek", "soldAt",
                           lat, lng, raw, "geocodeStatus")
    SELECT 'p-' || g, 'hemnet', 'h-' || g, md5('k' || g),
           CASE WHEN g % 50 = 0 THEN md5('k' || g) END,
           'Gata ' || ((g / 4) % 300),
           ((g * 7) % 60 + 1)::text || CASE WHEN g % 5 = 0 THEN 'A' ELSE '' END,
           (ARRAY['ostermalm','vasastan','norrmalm','sodermalm'])[1 + g % 4]::"District",
           1 + (g % 6),
           20 + (g % 90),
           pps * (20 + (g % 90)),
           pps,
           DATE '2021-01-01' + (random() * 1800)::int,
           59.30 + random() * 0.07,
           18.00 + random() * 0.12,
           '{}'::jsonb,
           'inline'
    FROM (SELECT g, 60000 + floor(random() * 120000)::bigint AS pps
          FROM generate_series(1, ${BASE_ROWS}) g) s
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Listing" (id, source, "sourceId", "dedupKey", street, "houseNumber", district, rooms,
                           "areaSqm", "priceSek", "pricePerSqmSek", "soldAt", lat, lng, raw)
    SELECT 'b-' || SUBSTRING(id FROM 3), 'booli', 'b-' || SUBSTRING(id FROM 3), "dedupKey", street,
           "houseNumber", district, rooms, "areaSqm", "priceSek", "pricePerSqmSek", "soldAt",
           CASE WHEN ascii("dedupKey") % 2 = 0 THEN lat END,
           CASE WHEN ascii("dedupKey") % 2 = 0 THEN lng END,
           '{}'::jsonb
    FROM "Listing"
    WHERE source = 'hemnet' AND SUBSTRING(id FROM 3)::int <= ${COPIES}
  `);
  await prisma.$executeRawUnsafe(`ANALYZE "Listing"`);
  return true;
}
