import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { listHouseNumbers } from "@/lib/aggregations";
import type { FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// F14: house numbers sort naturally (numeric prefix, then letter, then range
// end), not as text ("10" < "2").

const rowFor = (houseNumber: string, i: number): FixtureListing => ({
  id: `hn-${i}`,
  source: "hemnet",
  sourceId: `hn-${i}`,
  dedupKey: `hn-dedup-${i}`,
  street: "Odengatan",
  houseNumber,
  district: "vasastan",
  rooms: 2,
  areaSqm: 50,
  priceSek: BigInt(5_000_000),
  pricePerSqmSek: BigInt(100_000),
  soldAt: new Date("2026-03-10T00:00:00Z"),
  lat: 59.34,
  lng: 18.05,
  raw: {},
});

const order = async () => (await listHouseNumbers("vasastan", "Odengatan")).map((h) => h.houseNumber);

async function seedHouses(houses: Array<string | null>) {
  await seed(prisma, houses.map((h, i) => rowFor(h as string, i)));
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("listHouseNumbers ordering", () => {
  beforeAll(async () => {
    await seedHouses(["21", "3A", "10", "2"]);
  });

  it("sorts 2, 3A, 10, 21 (not 10, 2, 21, 3A)", async () => {
    expect(await order()).toEqual(["2", "3A", "10", "21"]);
  });
});

describe("listHouseNumbers ordering, harder cases", () => {
  it("orders by number, then letter, then range end, with unparseable ones last", async () => {
    await seedHouses(["Kv", "10B", "100", "10-14", "10", "10A", "2", "2 B", "10-12", "9", "3a"]);
    expect(await order()).toEqual([
      "2",
      "2 B",
      "3a",
      "9",
      "10",
      "10-12",
      "10-14",
      "10A",
      "10B",
      "100",
      "Kv",
    ]);
  });

  it("trims whitespace and accepts an en dash in ranges", async () => {
    await seedHouses([" 10", "10–12", "9 ", "10-11", "8"]);
    expect(await order()).toEqual(["8", "9 ", " 10", "10-11", "10–12"]);
  });

  it("treats non-breaking spaces like spaces (leading, trailing and before a letter)", async () => {
    await seedHouses([" 10", "9 ", "3 B", "3 A", "10 – 12"]);
    expect(await order()).toEqual(["3 A", "3 B", "9 ", " 10", "10 – 12"]);
  });

  it("does not overflow on absurdly long digit runs", async () => {
    await seedHouses(["99999999999999999999", "7"]);
    expect(await order()).toEqual(["7", "99999999999999999999"]);
  });

  it("keeps counts and means per house", async () => {
    await seedHouses(["2", "10", "10"]);
    const rows = await listHouseNumbers("vasastan", "Odengatan");
    expect(rows.map((r) => [r.houseNumber, r.count])).toEqual([
      ["2", 1],
      ["10", 2],
    ]);
  });
});
