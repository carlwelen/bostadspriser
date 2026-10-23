import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  districtSummary,
  districtTimeseries,
  listHouseNumbers,
  listStreets,
  recentSales,
  streetFromSlug,
  streetTimeseries,
} from "@/lib/aggregations";
import { FIXTURE_COUNTS, monthlyPps } from "../fixtures/listings";
import { seed } from "../support/seed";

// Characterisation tests for aggregations.ts against the deterministic fixture.
// They pin behaviour that is correct today; known bugs are tracked in
// docs/backlog.md and get their own failing-first tests.

beforeAll(async () => {
  await seed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("DedupedListing", () => {
  it("collapses rows that share a dedupKey and keeps every source", async () => {
    const [{ raw }] = await prisma.$queryRaw<Array<{ raw: bigint }>>`
      SELECT COUNT(*)::bigint AS raw FROM "Listing"`;
    const [{ deduped }] = await prisma.$queryRaw<Array<{ deduped: bigint }>>`
      SELECT COUNT(*)::bigint AS deduped FROM "DedupedListing"`;
    expect(Number(raw)).toBe(FIXTURE_COUNTS.raw);
    expect(Number(deduped)).toBe(FIXTURE_COUNTS.deduped);

    const [dup] = await prisma.$queryRaw<Array<{ source: string; sources: string[]; lat: number | null }>>`
      SELECT source, sources, lat FROM "DedupedListing" WHERE "dedupKey" = 'fx-dedup-duplicate'`;
    // The row with coordinates (Hemnet) wins; both sources are reported.
    expect(dup.source).toBe("hemnet");
    expect(dup.lat).not.toBeNull();
    expect(dup.sources).toEqual(["booli", "hemnet"]);
  });
});

describe("districtTimeseries", () => {
  it("returns ascending monthly buckets with counts", async () => {
    const ts = await districtTimeseries("vasastan", "month");
    const year2025 = ts.filter((p) => p.bucket.startsWith("2025-"));
    expect(year2025).toHaveLength(12);
    expect(year2025[0].bucket).toBe("2025-01-01");
    expect(year2025.every((p) => p.count === 3)).toBe(true);
    // Mean of the three streets in January.
    const jan = (monthlyPps("vasastan", 0, 0) + monthlyPps("vasastan", 1, 0) + monthlyPps("vasastan", 2, 0)) / 3;
    expect(year2025[0].meanPricePerSqm).toBe(Math.round(jan));
    const buckets = ts.map((p) => p.bucket);
    expect([...buckets].sort()).toEqual(buckets);
  });

  it("supports yearly buckets", async () => {
    const ts = await districtTimeseries("norrmalm", "year");
    const y2025 = ts.find((p) => p.bucket === "2025-01-01");
    expect(y2025?.count).toBe(36);
  });
});

describe("street queries", () => {
  it("lists streets for a district with counts", async () => {
    const streets = await listStreets("sodermalm");
    const names = streets.map((s) => s.street);
    expect(names).toEqual(expect.arrayContaining(["Götgatan", "Hornsgatan", "Ringvägen"]));
    const gotgatan = streets.find((s) => s.street === "Götgatan");
    expect(gotgatan?.slug).toBe("gotgatan");
    // 12 monthly + 1 recent + 1 Booli-only.
    expect(gotgatan?.count).toBe(14);
  });

  it("resolves a slug back to the street name", async () => {
    expect(await streetFromSlug("vasastan", "sankt-eriksgatan")).toBe("Sankt Eriksgatan");
    expect(await streetFromSlug("vasastan", "no-such-street")).toBeNull();
  });

  it("returns street and address time series", async () => {
    const street = await streetTimeseries("ostermalm", "Strandvägen", "month");
    expect(street.filter((p) => p.bucket.startsWith("2025-"))).toHaveLength(12);
    const house = await streetTimeseries("ostermalm", "Strandvägen", "month", "10");
    expect(house.reduce((n, p) => n + p.count, 0)).toBe(3);
  });

  it("lists house numbers with counts", async () => {
    const houses = await listHouseNumbers("norrmalm", "Kungsgatan");
    expect(houses.map((h) => h.houseNumber).sort()).toEqual(["10", "2", "21", "3A"]);
    expect(houses.reduce((n, h) => n + h.count, 0)).toBe(12);
  });

  it("returns recent sales newest first", async () => {
    const sales = await recentSales({ district: "ostermalm", street: "Karlavägen" }, 5);
    expect(sales).toHaveLength(5);
    const dates = sales.map((s) => s.soldAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("districtSummary", () => {
  it("counts deduped sales", async () => {
    const s = await districtSummary("ostermalm");
    // 36 monthly + 1 recent + 1 collapsed duplicate pair.
    expect(s.count).toBe(38);
    expect(s.earliest).toBe("2025-01-10");
  });
});
