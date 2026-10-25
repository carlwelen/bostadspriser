import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { HEATMAP_LIMIT } from "@/lib/aggregations";
import { GET as heatmapGET } from "@/app/api/heatmap/route";
import type { HeatmapResponse } from "@/lib/api-types";
import { seed } from "../support/seed";

// B25: the heatmap payload is capped on purpose, says when it was capped, and
// carries only what the map reads.

const get = async (qs = ""): Promise<HeatmapResponse> => {
  const res = await heatmapGET(new Request(`http://localhost/api/heatmap${qs}`));
  expect(res.status).toBe(200);
  return res.json();
};

/** Insert `n` mappable sales in SQL, one per day going back from 2026-03-01. */
async function seedMany(n: number) {
  await seed(prisma, []);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Listing" (id, source, "sourceId", "dedupKey", street, "houseNumber", district,
                           rooms, "areaSqm", "priceSek", "pricePerSqmSek", "soldAt", lat, lng, raw)
    SELECT 'cap-' || g, 'hemnet', 'cap-' || g, 'cap-dedup-' || g, 'Odengatan', (g % 50)::text,
           'vasastan', 2, 50, 5000000, 100000, DATE '2026-03-01' - g, 59.123456789, 18.987654321, '{}'::jsonb
    FROM generate_series(1, ${n}) g`);
  await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
}

afterAll(async () => {
  await prisma.$disconnect();
});

// Seeding 30k rows and refreshing the snapshot is slow on a loaded machine.
describe("/api/heatmap payload", { timeout: 120_000 }, () => {
  it("documents a deliberate cap", () => {
    expect(HEATMAP_LIMIT).toBe(30_000);
  });

  it("carries only the properties the map reads, with coordinates rounded to ~1 m", async () => {
    await seedMany(3);
    const body = await get();
    expect(body.truncated).toBe(false);
    const f = body.features[0];
    expect(Object.keys(f.properties).sort()).toEqual(
      ["address", "district", "houseNumber", "pricePerSqm", "soldAt", "sources", "street"].sort()
    );
    expect(f.geometry.coordinates).toEqual([18.98765, 59.12346]);
  });

  it("is not truncated at exactly the cap", async () => {
    await seedMany(HEATMAP_LIMIT);
    const body = await get();
    expect(body.features).toHaveLength(HEATMAP_LIMIT);
    expect(body.truncated).toBe(false);
  });

  it("flags truncation and drops the oldest sales first", async () => {
    await seedMany(HEATMAP_LIMIT + 1);
    const body = await get();
    expect(body.features).toHaveLength(HEATMAP_LIMIT);
    expect(body.truncated).toBe(true);
    const dates = body.features.map((f) => f.properties.soldAt);
    expect(dates[0]).toBe("2026-02-28"); // newest
    expect(dates).toEqual([...dates].sort().reverse());
    // The single oldest sale (g = 30001) is the one that was cut.
    const oldest = new Date(Date.UTC(2026, 2, 1) - (HEATMAP_LIMIT + 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(dates).not.toContain(oldest);
  });

  it("filters that leave fewer rows than the cap are not truncated", async () => {
    const tenYears = await get("?sinceDays=3650"); // ~3,500 of the 30,001 rows are that recent
    expect(tenYears.features.length).toBeLessThan(HEATMAP_LIMIT);
    expect(tenYears.truncated).toBe(false);
    const none = await get("?priceMin=999999");
    expect(none.features).toHaveLength(0);
    expect(none.truncated).toBe(false);
  });

  it("cuts the same rows every time when many sales share a date (id tie-break)", async () => {
    await seed(prisma, []);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Listing" (id, source, "sourceId", "dedupKey", street, "houseNumber", district,
                             rooms, "areaSqm", "priceSek", "pricePerSqmSek", "soldAt", lat, lng, raw)
      SELECT 'tie-' || lpad(g::text, 6, '0'), 'hemnet', 'tie-' || g, 'tie-dedup-' || g,
             'Gata ' || lpad(g::text, 6, '0'), '1', 'vasastan', 2, 50, 5000000, 100000,
             DATE '2026-03-01', 59.1, 18.9, '{}'::jsonb
      FROM generate_series(1, ${HEATMAP_LIMIT + 5}) g`);
    await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
    const streets = async () => (await get()).features.map((f) => f.properties.street);
    const first = await streets();
    expect(first).toHaveLength(HEATMAP_LIMIT);
    // The lowest ids win; the five highest are the ones cut.
    expect(first).not.toContain(`Gata ${String(HEATMAP_LIMIT + 5).padStart(6, "0")}`);
    expect(first).toContain("Gata 000001");
    expect(await streets()).toEqual(first);
  });

  it("excludes invalid newer rows before applying the cap and truncation flag", async () => {
    await seedMany(HEATMAP_LIMIT);
    await prisma.$executeRaw`
      INSERT INTO "Listing" (id, source, "sourceId", "dedupKey", street, district,
                             rooms, "areaSqm", "priceSek", "pricePerSqmSek", "soldAt", lat, lng, raw)
      SELECT 'invalid-geo-' || g, 'hemnet', 'invalid-geo-' || g, 'invalid-geo-' || g,
             'Invalid coordinates', 'vasastan', 2, 50, 5000000, 100000,
             DATE '2026-03-02', 91, 18, '{}'::jsonb
      FROM generate_series(1, 400) g`;
    await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
    const exact = await get();
    expect(exact.features).toHaveLength(HEATMAP_LIMIT);
    expect(exact.features.some((f) => f.properties.street === "Invalid coordinates")).toBe(false);
    expect(exact.truncated).toBe(false);
    expect(exact.features[0].properties.soldAt).toBe("2026-02-28");

    await prisma.$executeRaw`
      INSERT INTO "Listing" (id, source, "sourceId", "dedupKey", street, district,
                             rooms, "areaSqm", "priceSek", "pricePerSqmSek", "soldAt", lat, lng, raw)
      VALUES ('extra-valid', 'hemnet', 'extra-valid', 'extra-valid', 'Newest valid', 'vasastan',
              2, 50, 5000000, 100000, DATE '2026-03-01', 59, 18, '{}'::jsonb)`;
    await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
    const overflow = await get();
    expect(overflow.features).toHaveLength(HEATMAP_LIMIT);
    expect(overflow.truncated).toBe(true);
    expect(overflow.features[0].properties.street).toBe("Newest valid");
    expect(overflow.features.some((f) => f.properties.street === "Invalid coordinates")).toBe(false);
  });
});
