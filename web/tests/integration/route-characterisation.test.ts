import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as heatmapGET } from "@/app/api/heatmap/route";
import { GET as streetsAllGET } from "@/app/api/streets/all/route";
import { GET as addressGET } from "@/app/api/address/route";
import { seed } from "../support/seed";

// Characterisation of the three routes whose SQL moved into aggregations.ts
// (B27). Each response is reduced to {count, sha256} of its canonical JSON, so
// any change in rows, fields or values shows up; ordering is asserted
// separately where the route promises one.
//
// The clock is pinned before the fixture is built: its "recent" sales are
// dated relative to today and every cut-off and bucket reads the same fixed
// instant, so the snapshots do not decay with the calendar.
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
});

const canonical = (value: unknown) => JSON.stringify(value);

const digest = (items: unknown[]) => {
  const lines = items.map((i) => canonical(i)).sort();
  return {
    count: items.length,
    sha: createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16),
  };
};

const call = async (handler: (r: Request) => Promise<Response>, path: string) => {
  const res = await handler(new Request(`http://localhost${path}`));
  expect(res.status, path).toBe(200);
  return res.json();
};

beforeAll(async () => {
  await seed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("/api/heatmap", () => {
  const queries = [
    "",
    "?districts=vasastan,sodermalm",
    "?districts=norrmalm&rooms=2,5",
    "?rooms=4",
    "?rooms=5",
    "?priceMin=125000&priceMax=140000",
    "?priceMin=150000",
    "?bbox=18.04,59.33,18.07,59.34",
    "?sinceDays=30",
    "?sinceDays=3650&districts=ostermalm&priceMax=160000&rooms=1,2,3",
    "?districts=sodermalm&priceMin=9000000",
  ];

  it.each(queries)("response for %j is unchanged", async (qs) => {
    const body = await call(heatmapGET, `/api/heatmap${qs}`);
    expect(body.type).toBe("FeatureCollection");
    expect(digest(body.features)).toMatchSnapshot();
  });

  it("is ordered newest sale first", async () => {
    const body = await call(heatmapGET, "/api/heatmap");
    const dates: string[] = body.features.map((f: { properties: { soldAt: string } }) => f.properties.soldAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe("/api/address", () => {
  const queries = [
    "district=vasastan&street=Odengatan&period=all",
    "district=vasastan&street=Odengatan&period=12mo",
    "district=vasastan&street=Odengatan&house=10&period=all",
    "district=ostermalm&street=Karlav%C3%A4gen&house=2&period=3mo",
    "district=ostermalm&street=Karlav%C3%A4gen&house=2&period=30d",
    "district=ostermalm&street=Karlav%C3%A4gen&house=10&period=all",
    "district=sodermalm&street=G%C3%B6tgatan&period=all",
    "district=sodermalm&street=Nowhere&period=all",
  ];

  it.each(queries)("response for %j is unchanged", async (qs) => {
    const body = await call(addressGET, `/api/address?${qs}`);
    expect(body).toHaveProperty("granularity");
    expect(digest([{ ...body, streetSeries: undefined, addressSales: undefined }])).toMatchSnapshot("meta");
    expect(digest(body.streetSeries)).toMatchSnapshot("series");
    expect(digest(body.addressSales)).toMatchSnapshot("sales");
  });

  it("lists address sales newest first", async () => {
    const body = await call(addressGET, "/api/address?district=vasastan&street=Odengatan&period=all");
    const dates: string[] = body.addressSales.map((s: { soldAt: string }) => s.soldAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(body.streetSeries.map((p: { bucket: string }) => p.bucket)).toEqual(
      body.streetSeries.map((p: { bucket: string }) => p.bucket).sort()
    );
  });
});

describe("/api/streets/all", () => {
  it.each(["", "?limit=5", "?limit=1"])("response for %j is unchanged", async (qs) => {
    const body = await call(streetsAllGET, `/api/streets/all${qs}`);
    expect(digest(body)).toMatchSnapshot();
  });

  it("is ordered by sales count then street name", async () => {
    const body: Array<{ count: number; street: string }> = await call(streetsAllGET, "/api/streets/all");
    for (let i = 1; i < body.length; i++) {
      const [a, b] = [body[i - 1], body[i]];
      expect(a.count > b.count || (a.count === b.count && a.street <= b.street)).toBe(true);
    }
  });
});
