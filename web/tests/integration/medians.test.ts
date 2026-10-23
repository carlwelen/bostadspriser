import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addressDrawerData,
  districtSummary,
  districtTimeseries,
  globalSummary,
  listAllStreets,
  listHouseNumbers,
  listStreets,
  roomsBreakdown,
  streetTimeseries,
} from "@/lib/aggregations";
import type { FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// B14 (SQL side): every time-series and summary aggregation exposes the median
// next to the mean, and always the count. The dataset has an outlier so that
// median != mean.
//
//   vasastan / Odengatan 7, 2026-01: 100k, 100k, 100k, 1 000k  -> mean 325k, median 100k
//   vasastan / Odengatan 7, 2026-02: 100k, 200k                -> mean 150k, median 150k
//   norrmalm / Kungsgatan 1, 2026-01: 500k                      -> single sale

let seq = 0;
const sale = (
  pps: number,
  soldAt: string,
  extra: Partial<FixtureListing> = {}
): FixtureListing => {
  seq += 1;
  return {
    id: `md-${seq}`,
    source: "hemnet",
    sourceId: `md-${seq}`,
    dedupKey: `md-dedup-${seq}`,
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
};

beforeAll(async () => {
  await seed(prisma, [
    sale(100_000, "2026-01-05"),
    sale(100_000, "2026-01-12"),
    sale(100_000, "2026-01-20"),
    sale(1_000_000, "2026-01-28"),
    sale(100_000, "2026-02-03"),
    sale(200_000, "2026-02-17"),
    sale(500_000, "2026-01-15", { district: "norrmalm", street: "Kungsgatan", houseNumber: "1", rooms: 3 }),
    // Dedup: a second source reporting the first sale must not count again.
    { ...sale(100_000, "2026-01-05"), id: "md-booli", source: "booli", sourceId: "md-booli", dedupKey: "md-dedup-1" },
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("time series", () => {
  const expected = [
    { bucket: "2026-01-01", count: 4, meanPricePerSqm: 325_000, medianPricePerSqm: 100_000 },
    { bucket: "2026-02-01", count: 2, meanPricePerSqm: 150_000, medianPricePerSqm: 150_000 },
  ];

  it("districtTimeseries", async () => {
    expect(await districtTimeseries("vasastan", "month")).toEqual(expected);
  });

  it("districtTimeseries by year", async () => {
    expect(await districtTimeseries("vasastan", "year")).toEqual([
      { bucket: "2026-01-01", count: 6, meanPricePerSqm: 266_667, medianPricePerSqm: 100_000 },
    ]);
  });

  it("streetTimeseries, for the street and for a house", async () => {
    expect(await streetTimeseries("vasastan", "Odengatan", "month")).toEqual(expected);
    expect(await streetTimeseries("vasastan", "Odengatan", "month", "7")).toEqual(expected);
    expect(await streetTimeseries("vasastan", "Odengatan", "month", "9")).toEqual([]);
  });

  it("addressDrawerData's street series", async () => {
    const { streetSeries } = await addressDrawerData(
      "vasastan",
      "Odengatan",
      "7",
      { days: null, bucket: "month" },
      new Date("2026-03-01T00:00:00Z")
    );
    expect(streetSeries).toEqual(expected);
  });
});

describe("summaries", () => {
  it("listStreets", async () => {
    expect(await listStreets("vasastan")).toEqual([
      {
        street: "Odengatan",
        slug: "odengatan",
        count: 6,
        meanPricePerSqm: 266_667,
        medianPricePerSqm: 100_000,
        latestSoldAt: "2026-02-17",
      },
    ]);
  });

  it("listHouseNumbers", async () => {
    expect(await listHouseNumbers("vasastan", "Odengatan")).toEqual([
      { houseNumber: "7", count: 6, meanPricePerSqm: 266_667, medianPricePerSqm: 100_000 },
    ]);
  });

  it("districtSummary", async () => {
    expect(await districtSummary("vasastan")).toEqual({
      count: 6,
      meanPricePerSqm: 266_667,
      medianPricePerSqm: 100_000,
      earliest: "2026-01-05",
      latest: "2026-02-17",
    });
    expect(await districtSummary("sodermalm")).toEqual({
      count: 0,
      meanPricePerSqm: null,
      medianPricePerSqm: null,
      earliest: null,
      latest: null,
    });
  });

  it("globalSummary, overall and per district", async () => {
    const g = await globalSummary();
    // 7 sales: 100k x4, 200k, 500k, 1000k -> median 100k, mean 2 100k / 7 = 300k.
    expect(g).toMatchObject({ total: 7, meanPricePerSqm: 300_000, medianPricePerSqm: 100_000 });
    expect(g.byDistrict).toEqual([
      { district: "vasastan", count: 6, meanPricePerSqm: 266_667, medianPricePerSqm: 100_000 },
      { district: "norrmalm", count: 1, meanPricePerSqm: 500_000, medianPricePerSqm: 500_000 },
    ]);
  });

  it("listAllStreets", async () => {
    expect(await listAllStreets()).toEqual([
      { district: "vasastan", street: "Odengatan", slug: "odengatan", count: 6, meanPricePerSqm: 266_667, medianPricePerSqm: 100_000 },
      { district: "norrmalm", street: "Kungsgatan", slug: "kungsgatan", count: 1, meanPricePerSqm: 500_000, medianPricePerSqm: 500_000 },
    ]);
  });

  it("listHouseNumbers and listStreets ignore unpriced sales alike", async () => {
    await seed(prisma, [
      sale(100_000, "2026-01-05"),
      sale(0, "2026-01-06"),
      sale(0, "2026-01-07", { houseNumber: "9" }), // only unpriced sales: not listed
    ]);
    expect(await listHouseNumbers("vasastan", "Odengatan")).toEqual([
      { houseNumber: "7", count: 1, meanPricePerSqm: 100_000, medianPricePerSqm: 100_000 },
    ]);
    expect(await listStreets("vasastan")).toMatchObject([
      { street: "Odengatan", count: 1, meanPricePerSqm: 100_000, medianPricePerSqm: 100_000 },
    ]);
  });

  it("globalSummary on an empty database", async () => {
    await seed(prisma, []);
    expect(await globalSummary()).toMatchObject({ total: 0, meanPricePerSqm: null, medianPricePerSqm: null });
  });

  it("roomsBreakdown", async () => {
    await seed(prisma, [
      sale(100_000, "2026-01-05"),
      sale(100_000, "2026-01-06"),
      sale(1_000_000, "2026-01-07"),
      sale(400_000, "2026-01-08", { rooms: 3 }),
    ]);
    expect(await roomsBreakdown()).toMatchObject([
      { rooms: 2, count: 3, meanPricePerSqm: 400_000, medianPricePerSqm: 100_000 },
      { rooms: 3, count: 1, meanPricePerSqm: 400_000, medianPricePerSqm: 400_000 },
    ]);
  });
});
