import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addressSummary,
  districtStreetCount,
  streetSummary,
  type SalesSummary,
} from "@/lib/aggregations";
import { buildFixture, type FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// F13 (SQL side): street / address / district summaries with count, mean,
// median, earliest and latest, over deduplicated sales.

let seq = 0;
function sale(
  pps: number,
  soldAt: string,
  extra: Partial<FixtureListing> = {}
): FixtureListing {
  seq += 1;
  return {
    id: `sm-${seq}`,
    source: "hemnet",
    sourceId: `sm-${seq}`,
    dedupKey: `sm-dedup-${seq}`,
    street: "Odengatan",
    houseNumber: "7",
    district: "vasastan",
    rooms: 2,
    areaSqm: 50,
    priceSek: BigInt(pps * 50),
    pricePerSqmSek: BigInt(pps),
    soldAt: new Date(`${soldAt}T00:00:00Z`),
    lat: 59.34,
    lng: 18.05,
    raw: {},
    ...extra,
  };
}

const EMPTY: SalesSummary = {
  count: 0,
  meanPricePerSqm: null,
  medianPricePerSqm: null,
  earliest: null,
  latest: null,
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe("streetSummary / addressSummary", () => {
  it("reports count, mean, median, earliest and latest", async () => {
    // Odd count, skewed: mean 325k vs median 100k with the outlier.
    await seed(prisma, [
      sale(100_000, "2026-01-10"),
      sale(100_000, "2026-02-10"),
      sale(100_000, "2026-03-10"),
      sale(1_000_000, "2026-04-10"),
    ]);
    expect(await streetSummary("vasastan", "Odengatan")).toEqual({
      count: 4,
      meanPricePerSqm: 325_000,
      medianPricePerSqm: 100_000,
      earliest: "2026-01-10",
      latest: "2026-04-10",
    });
  });

  it("interpolates the median for an even count and rounds to whole kr", async () => {
    await seed(prisma, [sale(100_000, "2026-01-10"), sale(200_001, "2026-02-10")]);
    const s = await streetSummary("vasastan", "Odengatan");
    expect(s.medianPricePerSqm).toBe(150_001); // 150000.5 rounds up
    expect(s.meanPricePerSqm).toBe(150_001);
  });

  it("scopes to the district, the street and (for addresses) the house number", async () => {
    await seed(prisma, [
      sale(100_000, "2026-01-10", { houseNumber: "7" }),
      sale(200_000, "2026-02-10", { houseNumber: "7" }),
      sale(300_000, "2026-03-10", { houseNumber: "9" }),
      sale(900_000, "2026-03-11", { street: "Surbrunnsgatan" }),
      sale(800_000, "2026-03-12", { district: "norrmalm" }),
    ]);
    expect(await streetSummary("vasastan", "Odengatan")).toMatchObject({
      count: 3,
      meanPricePerSqm: 200_000,
      medianPricePerSqm: 200_000,
    });
    expect(await addressSummary("vasastan", "Odengatan", "7")).toEqual({
      count: 2,
      meanPricePerSqm: 150_000,
      medianPricePerSqm: 150_000,
      earliest: "2026-01-10",
      latest: "2026-02-10",
    });
    expect(await addressSummary("vasastan", "Odengatan", "9")).toMatchObject({ count: 1 });
  });

  it("returns an all-null summary when there are no sales", async () => {
    await seed(prisma, [sale(100_000, "2026-01-10")]);
    expect(await streetSummary("vasastan", "Nowhere")).toEqual(EMPTY);
    expect(await addressSummary("vasastan", "Odengatan", "999")).toEqual(EMPTY);
    expect(await streetSummary("sodermalm", "Odengatan")).toEqual(EMPTY);
  });

  it("counts a sale reported by two sources once and ignores zero prices", async () => {
    const a = sale(100_000, "2026-01-10");
    await seed(prisma, [
      a,
      { ...a, id: "sm-booli", source: "booli", sourceId: "sm-booli" },
      sale(0, "2026-02-10"),
    ]);
    expect(await streetSummary("vasastan", "Odengatan")).toMatchObject({ count: 1 });
  });

  it("matches hand-computed values on the shared fixture", async () => {
    const fixture = buildFixture();
    await seed(prisma, fixture);
    // Dedupe by dedupKey like the view does (the duplicate pair share pps).
    const seen = new Set<string>();
    const rows = fixture.filter((r) => {
      if (r.street !== "Karlavägen" || r.district !== "ostermalm") return false;
      if (seen.has(r.dedupKey as string)) return false;
      seen.add(r.dedupKey as string);
      return true;
    });
    const pps = rows.map((r) => Number(r.pricePerSqmSek)).sort((a, b) => a - b);
    const mid = pps.length / 2;
    const median = pps.length % 2 ? pps[(pps.length - 1) / 2] : (pps[mid - 1] + pps[mid]) / 2;
    const s = await streetSummary("ostermalm", "Karlavägen");
    expect(s.count).toBe(rows.length);
    expect(s.meanPricePerSqm).toBe(Math.round(pps.reduce((a, b) => a + b, 0) / pps.length));
    expect(s.medianPricePerSqm).toBe(Math.round(median));
    expect(s.earliest).toBe("2025-01-10");
  });
});

describe("districtStreetCount", () => {
  it("counts distinct streets with sales and carries the district summary", async () => {
    await seed(prisma, [
      sale(100_000, "2026-01-10"),
      sale(300_000, "2026-02-10", { street: "Surbrunnsgatan" }),
      sale(500_000, "2026-03-10", { street: "Surbrunnsgatan", houseNumber: "1" }),
      sale(700_000, "2026-03-11", { district: "norrmalm", street: "Kungsgatan" }),
    ]);
    expect(await districtStreetCount("vasastan")).toEqual({
      streetCount: 2,
      count: 3,
      meanPricePerSqm: 300_000,
      medianPricePerSqm: 300_000,
      earliest: "2026-01-10",
      latest: "2026-03-10",
    });
  });

  it("is not capped (12+ streets are counted exactly)", async () => {
    await seed(
      prisma,
      Array.from({ length: 15 }, (_, i) => sale(100_000, "2026-01-10", { street: `Gata ${i}` }))
    );
    expect((await districtStreetCount("vasastan")).streetCount).toBe(15);
  });

  it("is zero for an empty district", async () => {
    await seed(prisma, []);
    expect(await districtStreetCount("sodermalm")).toEqual({ streetCount: 0, ...EMPTY });
  });
});
