import { afterAll, expect, expectTypeOf, it } from "vitest";
import { prisma } from "@/lib/db";
import { addressDrawerData, type SalesSummary } from "@/lib/aggregations";
import { GET } from "@/app/api/address/route";
import type { AddressResponse } from "@/lib/api-types";
import { buildFixture } from "../fixtures/listings";
import { seed } from "../support/seed";

afterAll(() => prisma.$disconnect());

it("returns an uncapped SQL street median over the period, across houses", async () => {
  const base = buildFixture()[0];
  const rows = Array.from({ length: 205 }, (_, i) => ({
    ...base, id: `drawer-${i}`, sourceId: `drawer-${i}`, dedupKey: `drawer-${i}`,
    district: "vasastan" as const, street: "Odengatan", houseNumber: i ? "9" : "7",
    pricePerSqmSek: BigInt(i < 200 ? 100_000 : 900_000),
    soldAt: new Date(i < 200 ? "2026-03-01T00:00:00Z" : "2026-03-02T00:00:00Z"),
  }));
  await seed(prisma, [...rows, { ...rows[0], id: "old", sourceId: "old", dedupKey: "old",
    pricePerSqmSek: BigInt(5_000_000), soldAt: new Date("2025-01-01T00:00:00Z") },
    { ...rows[0], id: "dup", sourceId: "dup", source: "booli" },
    { ...rows[0], id: "zero", sourceId: "zero", dedupKey: "zero", pricePerSqmSek: BigInt(0) },
  ]);
  const result = await addressDrawerData("vasastan", "Odengatan", "7", { days: 30, bucket: "day" }, new Date("2026-03-15T00:00:00Z"));
  expect(result.addressSales).toHaveLength(1);
  expect(result.streetSummary).toEqual({ count: 205, meanPricePerSqm: 119_512,
    medianPricePerSqm: 100_000, earliest: "2026-03-01", latest: "2026-03-02" });
  const all = await addressDrawerData("vasastan", "Odengatan", undefined, { days: null, bucket: "month" });
  expect(all.addressSales).toHaveLength(200);
  expect(all.streetSummary.count).toBe(206);
  const empty = await addressDrawerData("vasastan", "Odengatan", undefined, { days: 30, bucket: "day" }, new Date("2027-01-01T00:00:00Z"));
  expect(empty.streetSummary).toEqual({ count: 0, meanPricePerSqm: null, medianPricePerSqm: null, earliest: null, latest: null });
  const response = await GET(new Request("http://localhost/api/address?district=vasastan&street=Odengatan&house=7&period=all"));
  const body: AddressResponse = await response.json();
  expectTypeOf(body.streetSummary).toEqualTypeOf<SalesSummary | undefined>();
  expect(body.streetSummary).toEqual(all.streetSummary);
});
