import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as agg from "@/lib/aggregations";
import { buildFixture } from "../fixtures/listings";
import { seed } from "../support/seed";

beforeAll(async () => {
  const base = buildFixture()[0];
  await seed(prisma, [2, 2.5, 4, 5, 6.5, null].map((rooms, i) => ({
    ...base, id: `segment-${i}`, sourceId: `segment-${i}`, dedupKey: `segment-${i}`,
    district: "vasastan", street: i === 2 ? "Other" : "Odengatan",
    houseNumber: String(i), rooms, pricePerSqmSek: BigInt((i + 1) * 100_000),
    soldAt: new Date("2026-01-10T00:00:00Z"),
  })));
});
afterAll(() => prisma.$disconnect());

it.each([
  [undefined, 6, 5], [[], 6, 5], [[2], 2, 2], [[5], 2, 2], [[2, 5], 4, 4], [[1], 0, 0],
] as Array<[number[] | undefined, number, number]>)("keeps SQL series and summaries consistent for %j", async (rooms, districtN, streetN) => {
  const district = await agg.districtTimeseries("vasastan", "month", rooms);
  const street = await agg.streetTimeseries("vasastan", "Odengatan", "month", undefined, rooms);
  const summary = await agg.streetSummary("vasastan", "Odengatan", rooms);
  const totals = await agg.districtStreetCount("vasastan", rooms);
  expect(district.reduce((n, p) => n + p.count, 0)).toBe(districtN);
  expect(street.reduce((n, p) => n + p.count, 0)).toBe(streetN);
  expect(summary.count).toBe(streetN);
  expect(totals.count).toBe(districtN);
  expect(totals.streetCount).toBe(districtN === 0 ? 0 : districtN === 6 ? 2 : 1);
  if (streetN) {
    expect(summary.meanPricePerSqm).toBe(street[0].meanPricePerSqm);
    expect(summary.medianPricePerSqm).toBe(street[0].medianPricePerSqm);
  }
  expect((await agg.districtSummary("vasastan", rooms)).count).toBe(districtN);
  expect((await agg.listStreets("vasastan", 200, rooms)).reduce((n, s) => n + s.count, 0)).toBe(districtN);
  expect((await agg.listHouseNumbers("vasastan", "Odengatan", rooms)).reduce((n, s) => n + s.count, 0)).toBe(streetN);
  expect((await agg.recentSales({ district: "vasastan", rooms }, 25)).length).toBe(districtN);
  const mom = await agg.districtMomChange("vasastan", new Date("2026-02-01T00:00:00Z"), rooms);
  expect(mom?.currentCount ?? 0).toBe(districtN);
});

it("preserves the positional house-number filter and year granularity", async () => {
  expect(await agg.streetTimeseries("vasastan", "Odengatan", "year", "4", [5])).toMatchObject([{ bucket: "2026-01-01", count: 1 }]);
  expect(await agg.streetTimeseries("vasastan", "Odengatan", "year", "4", [2])).toEqual([]);
});
