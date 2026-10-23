import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as addressGET } from "@/app/api/address/route";
import type { AddressResponse } from "@/lib/api-types";
import { RECENT_DAYS_AGO } from "../fixtures/listings";
import { seed } from "../support/seed";

// B8: the period selects the per-address sales as well as the street series.

const get = async (qs: string): Promise<AddressResponse> => {
  const res = await addressGET(new Request(`http://localhost/api/address?${qs}`));
  expect(res.status).toBe(200);
  return res.json();
};

const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe("/api/address period vs per-address sales (shared fixture)", () => {
  const q = "district=ostermalm&street=Karlav%C3%A4gen&house=2";

  beforeAll(async () => {
    await seed(prisma);
  });

  it("period=30d returns only the recent sale at the address", async () => {
    const body = await get(`${q}&period=30d`);
    expect(body.addressSales.map((s) => s.soldAt)).toEqual([isoDaysAgo(RECENT_DAYS_AGO)]);
  });

  it("period=all still returns the whole history", async () => {
    const body = await get(`${q}&period=all`);
    // Fixture: house 2 sold in 2025-01, -05 and -09, plus the recent sale.
    expect(body.addressSales).toHaveLength(4);
  });

  it("applies the period to the street series and the sales alike", async () => {
    const body = await get(`${q}&period=30d`);
    const seriesCount = body.streetSeries.reduce((n, p) => n + p.count, 0);
    // Whole street in the window: only the recent sale at no. 2.
    expect(seriesCount).toBe(1);
  });
});

describe("/api/address period boundaries", () => {
  // The route cuts off at the database's CURRENT_DATE, so build the dates from
  // it instead of the JS clock (they differ around midnight UTC).
  let today = "";
  const dbDaysAgo = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const row = (daysAgo: number, i: number) => ({
    id: `p-${i}`,
    source: "hemnet",
    sourceId: `p-${i}`,
    dedupKey: `p-dedup-${i}`,
    street: "Odengatan",
    houseNumber: "7",
    district: "vasastan" as const,
    rooms: 2,
    areaSqm: 50,
    priceSek: BigInt(5_000_000),
    pricePerSqmSek: BigInt(100_000),
    soldAt: new Date(`${dbDaysAgo(daysAgo)}T00:00:00Z`),
    lat: 59.34,
    lng: 18.05,
    raw: {},
  });
  // 30/31, 90/91 and 365/366 days ago straddle each period's cut-off.
  const ages = [1, 30, 31, 90, 91, 365, 366, 800];

  beforeAll(async () => {
    const [r] = await prisma.$queryRaw<Array<{ today: string }>>`
      SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`;
    today = r.today;
    await seed(prisma, ages.map(row));
  });

  const soldAgo = (body: AddressResponse) =>
    body.addressSales.map((s) => s.soldAt).sort();
  const iso = (...ns: number[]) => ns.map(dbDaysAgo).sort();
  const q = "district=vasastan&street=Odengatan&house=7";

  it("30d includes the cut-off day and excludes the day before it", async () => {
    expect(soldAgo(await get(`${q}&period=30d`))).toEqual(iso(1, 30));
  });

  it("3mo is 90 days", async () => {
    expect(soldAgo(await get(`${q}&period=3mo`))).toEqual(iso(1, 30, 31, 90));
  });

  it("12mo is 365 days", async () => {
    expect(soldAgo(await get(`${q}&period=12mo`))).toEqual(iso(1, 30, 31, 90, 91, 365));
  });

  it("an empty window is an empty list, not an error", async () => {
    await seed(prisma, [row(800, 0)]);
    const body = await get(`${q}&period=30d`);
    expect(body.addressSales).toEqual([]);
    expect(body.streetSeries).toEqual([]);
  });
});
