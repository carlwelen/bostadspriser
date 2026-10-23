import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { seed } from "../support/seed";

// B16 (schema half): geocoding bookkeeping on Listing, so a failed lookup is
// not recorded as a success.

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Listing.geocodeStatus / geocodeAttempts", () => {
  it("default to pending / 0 for inserts that do not mention them", async () => {
    await seed(prisma, []);
    // What the scraper's reflected insert looks like today.
    await prisma.$executeRaw`
      INSERT INTO "Listing" (id, source, "sourceId", street, district, "priceSek",
                             "pricePerSqmSek", "soldAt", raw)
      VALUES ('geo-1', 'booli', 'geo-1', 'Odengatan', 'vasastan', 1, 1, DATE '2026-03-10', '{}'::jsonb)`;
    const [row] = await prisma.$queryRaw<Array<{ status: string; attempts: number }>>`
      SELECT "geocodeStatus"::text AS status, "geocodeAttempts" AS attempts
      FROM "Listing" WHERE id = 'geo-1'`;
    expect(row).toEqual({ status: "pending", attempts: 0 });
  });

  it("accepts every status and rejects anything else", async () => {
    for (const status of ["pending", "ok", "not_found", "failed", "inline"] as const) {
      await prisma.listing.updateMany({ where: { id: "geo-1" }, data: { geocodeStatus: status } });
      const row = await prisma.listing.findUniqueOrThrow({ where: { id: "geo-1" } });
      expect(row.geocodeStatus).toBe(status);
    }
    await expect(
      prisma.$executeRaw`UPDATE "Listing" SET "geocodeStatus" = 'weird'::"GeocodeStatus" WHERE id = 'geo-1'`
    ).rejects.toThrow();
  });

  it("is visible through DedupedListing, which keeps the same column set", async () => {
    await prisma.listing.updateMany({
      where: { id: "geo-1" },
      data: { geocodeStatus: "not_found", geocodeAttempts: 2 },
    });
    const [row] = await prisma.$queryRaw<Array<{ status: string; attempts: number; sources: string[] }>>`
      SELECT "geocodeStatus"::text AS status, "geocodeAttempts" AS attempts, sources
      FROM "DedupedListing" WHERE id = 'geo-1'`;
    expect(row).toEqual({ status: "not_found", attempts: 2, sources: ["booli"] });
  });
});
