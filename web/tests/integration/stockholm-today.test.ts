import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { topMovers } from "@/lib/aggregations";
import { GET as heatmapGET } from "@/app/api/heatmap/route";
import { GET as addressGET } from "@/app/api/address/route";
import type { AddressResponse, HeatmapResponse } from "@/lib/api-types";
import type { FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// B34: "N days ago" cut-offs count from today's date in Europe/Stockholm, not
// the database session's CURRENT_DATE. The clock is pinned by faking Date: the
// code under test passes the JS clock to SQL, so the DB's own clock is irrelevant.
//
// 22:30 UTC on 31 March is 00:30 on 1 April in Stockholm (CEST, UTC+2).

const PINNED = new Date("2026-03-31T22:30:00Z");

let seq = 0;
function sale(soldAt: string, pps: number, extra: Partial<FixtureListing> = {}): FixtureListing {
  seq += 1;
  return {
    id: `st-${seq}`,
    source: "hemnet",
    sourceId: `st-${seq}`,
    dedupKey: `st-dedup-${seq}`,
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

const pin = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PINNED);
};

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sinceDays / period cut-offs use the Stockholm date", () => {
  // At the pinned instant Stockholm's date is 2026-04-01, so 30 days back is 2026-03-02.
  beforeAll(async () => {
    await seed(prisma, [sale("2026-03-01", 100_000), sale("2026-03-02", 110_000), sale("2026-03-31", 120_000)]);
  });

  it("/api/heatmap sinceDays=30", async () => {
    pin();
    const res = await heatmapGET(new Request("http://localhost/api/heatmap?sinceDays=30"));
    const body: HeatmapResponse = await res.json();
    expect(body.features.map((f) => f.properties.soldAt).sort()).toEqual([
      "2026-03-02",
      "2026-03-31",
    ]);
  });

  it("/api/address period=30d, for sales and for the street series", async () => {
    pin();
    const res = await addressGET(
      new Request("http://localhost/api/address?district=vasastan&street=Odengatan&period=30d")
    );
    const body: AddressResponse = await res.json();
    expect(body.addressSales.map((s) => s.soldAt).sort()).toEqual(["2026-03-02", "2026-03-31"]);
    expect(body.streetSeries.reduce((n, p) => n + p.count, 0)).toBe(2);
  });
});

describe("topMovers uses the Stockholm date for its 90-day window", () => {
  // 90 days before 2026-04-01 is 2026-01-01 (before the fix: 2025-12-31).
  beforeAll(async () => {
    await seed(prisma, [
      ...[1, 2, 3, 4].map((d) => sale(`2025-06-0${d}`, 100_000)),
      sale("2026-03-01", 200_000),
      sale("2026-03-05", 200_000),
      sale("2025-12-31", 1_000_000), // one day outside the Stockholm window
    ]);
  });

  it("excludes a sale one day before the window", async () => {
    pin();
    const [mover] = await topMovers("up", 5);
    expect(mover).toMatchObject({ street: "Odengatan", windowMeanPricePerSqm: 200_000 });
  });

  it("accepts an explicit asOf", async () => {
    const [mover] = await topMovers("up", 5, PINNED);
    expect(mover.windowMeanPricePerSqm).toBe(200_000);
  });
});
