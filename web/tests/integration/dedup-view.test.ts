import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// B9 (schema half): DedupedListing breaks the final tie between duplicate rows
// by `lastSeenAt` (when a scraper last saw the row), not `scrapedAt` (when it
// first inserted it).

const base = {
  source: "hemnet",
  dedupKey: "view-dup",
  street: "Odengatan",
  houseNumber: "7",
  district: "vasastan",
  rooms: 2,
  areaSqm: 50,
  priceSek: BigInt(5_000_000),
  pricePerSqmSek: BigInt(100_000),
  soldAt: new Date("2026-03-10T00:00:00Z"),
  lat: 59.34,
  lng: 18.05,
  raw: {},
} as const;

const row = (id: string, extra: Partial<FixtureListing>): FixtureListing => ({
  ...base,
  id,
  sourceId: id,
  ...extra,
});

const winner = async (key = "view-dup") => {
  const rows = await prisma.$queryRaw<Array<{ id: string; sources: string[] }>>`
    SELECT id, sources FROM "DedupedListing" WHERE "dedupKey" = ${key}`;
  expect(rows).toHaveLength(1);
  return rows[0];
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe("DedupedListing tie-breaker", () => {
  beforeEach(async () => {
    await seed(prisma, []);
  });

  it("prefers the row seen most recently when everything else ties", async () => {
    await seed(prisma, [
      // "old" was scraped later than "new" but last seen earlier: lastSeenAt decides.
      row("old", {
        scrapedAt: new Date("2026-04-02T00:00:00Z"),
        lastSeenAt: new Date("2026-04-02T00:00:00Z"),
      }),
      row("new", {
        scrapedAt: new Date("2026-04-01T00:00:00Z"),
        lastSeenAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ]);
    expect((await winner()).id).toBe("new");
  });

  it("is independent of insertion order", async () => {
    await seed(prisma, [
      row("new", { lastSeenAt: new Date("2026-06-01T00:00:00Z") }),
      row("old", { lastSeenAt: new Date("2026-04-02T00:00:00Z") }),
    ]);
    expect((await winner()).id).toBe("new");
  });

  it("still ranks coordinates and source priority above lastSeenAt", async () => {
    await seed(prisma, [
      row("hemnet-old", { lastSeenAt: new Date("2026-01-01T00:00:00Z") }),
      row("booli-new", { source: "booli", lastSeenAt: new Date("2026-06-01T00:00:00Z") }),
    ]);
    const w = await winner();
    expect(w.id).toBe("hemnet-old");
    expect(w.sources).toEqual(["booli", "hemnet"]);

    await seed(prisma, [
      row("no-coords-new", { lat: null, lng: null, lastSeenAt: new Date("2026-06-01T00:00:00Z") }),
      row("coords-old", { lastSeenAt: new Date("2026-01-01T00:00:00Z") }),
    ]);
    expect((await winner()).id).toBe("coords-old");
  });
});

describe("Listing.lastSeenAt column", () => {
  beforeEach(async () => {
    await seed(prisma, []);
  });

  it("is NOT NULL and defaults to now() for inserts that do not mention it", async () => {
    // What the Python scraper's reflected insert looks like today: no lastSeenAt.
    await prisma.$executeRaw`
      INSERT INTO "Listing" (id, source, "sourceId", street, district, "priceSek",
                             "pricePerSqmSek", "soldAt", raw)
      VALUES ('raw-insert', 'hemnet', 'raw-insert', 'Odengatan', 'vasastan', 1, 1,
              DATE '2026-03-10', '{}'::jsonb)`;
    const [r] = await prisma.$queryRaw<Array<{ ageMs: number }>>`
      SELECT (EXTRACT(EPOCH FROM (now() - "lastSeenAt")) * 1000)::float8 AS "ageMs"
      FROM "Listing" WHERE id = 'raw-insert'`;
    expect(r.ageMs).toBeGreaterThanOrEqual(-1000);
    expect(r.ageMs).toBeLessThan(60_000);

    const [{ nullable }] = await prisma.$queryRaw<Array<{ nullable: string }>>`
      SELECT is_nullable AS nullable FROM information_schema.columns
      WHERE table_name = 'Listing' AND column_name = 'lastSeenAt'`;
    expect(nullable).toBe("NO");
  });
});
