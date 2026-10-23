import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as heatmapGET } from "@/app/api/heatmap/route";
import type { HeatmapResponse } from "@/lib/api-types";
import { buildFixture, type FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// B5: the map's "5+" chip sends rooms=5, which must mean "5 rooms or more".

const get = async (qs: string): Promise<HeatmapResponse> => {
  const res = await heatmapGET(new Request(`http://localhost/api/heatmap${qs}`));
  expect(res.status).toBe(200);
  return res.json();
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe("rooms filter on the shared fixture", () => {
  const fixture = buildFixture();
  // Deduped, mappable rows. The fixture's duplicate pair is 3 rooms either way.
  const mappable = fixture.filter((r) => r.lat !== null);
  const roomsOf = (r: FixtureListing) => Number(r.rooms);

  beforeAll(async () => {
    await seed(prisma);
  });

  it("includes a 6-room sale with rooms=5 and excludes it with rooms=4", async () => {
    // Karlavägen, 2025-06-10: (street 0 + month 5) % 6 -> the fixture's 6-room row.
    const isSixRoom = (f: HeatmapResponse["features"][number]) =>
      f.properties.street === "Karlavägen" && f.properties.soldAt === "2025-06-10";
    expect(
      mappable.find((r) => r.street === "Karlavägen" && new Date(r.soldAt).toISOString().startsWith("2025-06-10"))?.rooms
    ).toBe(6);

    expect((await get("?rooms=5")).features.some(isSixRoom)).toBe(true);
    expect((await get("?rooms=4")).features.some(isSixRoom)).toBe(false);
  });

  it("rooms=5 returns exactly the rows with 5 or more rooms", async () => {
    const expected = mappable.filter((r) => roomsOf(r) >= 5).length;
    expect(expected).toBeGreaterThan(0);
    expect((await get("?rooms=5")).features).toHaveLength(expected);
  });

  it("rooms=4 returns exactly the 4-room rows", async () => {
    const expected = mappable.filter((r) => Math.floor(roomsOf(r)) === 4).length;
    expect((await get("?rooms=4")).features).toHaveLength(expected);
  });

  it("combines exact values with the 5+ bucket", async () => {
    const expected = mappable.filter((r) => Math.floor(roomsOf(r)) === 2 || roomsOf(r) >= 5).length;
    expect((await get("?rooms=2,5")).features).toHaveLength(expected);
  });
});

describe("rooms filter edge cases", () => {
  const base = {
    source: "hemnet",
    street: "Odengatan",
    district: "vasastan",
    areaSqm: 60,
    priceSek: BigInt(6_000_000),
    pricePerSqmSek: BigInt(100_000),
    soldAt: new Date(Date.UTC(2025, 5, 10)),
    lat: 59.34,
    lng: 18.05,
    raw: {},
  } as const;
  const rooms = [3, 4, 4.5, 5, 5.5, 6, 12, null];
  const rows: FixtureListing[] = rooms.map((r, i) => ({
    ...base,
    id: `rooms-${i}`,
    sourceId: `rooms-${i}`,
    dedupKey: `rooms-dedup-${i}`,
    houseNumber: String(i + 1),
    rooms: r,
  }));
  const houses = async (qs: string) =>
    (await get(qs)).features.map((f) => f.properties.houseNumber).sort();
  const idx = (...xs: Array<number | null>) =>
    xs.map((x) => String(rooms.indexOf(x) + 1)).sort();

  beforeAll(async () => {
    await seed(prisma, rows);
  });

  it("5 covers 5, 5.5, 6 and 12 rooms but not 4.5", async () => {
    expect(await houses("?rooms=5")).toEqual(idx(5, 5.5, 6, 12));
  });

  it("exact values floor fractional rooms", async () => {
    expect(await houses("?rooms=4")).toEqual(idx(4, 4.5));
  });

  it("excludes sales without a room count whenever rooms is set", async () => {
    expect(await houses("?rooms=3,5")).toEqual(idx(3, 5, 5.5, 6, 12));
    expect(await houses("")).toHaveLength(rooms.length);
  });
});
