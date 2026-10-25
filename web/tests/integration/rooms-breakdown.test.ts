import { afterAll, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { roomsBreakdown } from "@/lib/aggregations";
import { buildFixture, type FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

const [base] = buildFixture();
const sales = (rooms: FixtureListing["rooms"][]) => rooms.map((rooms, i) => ({
  ...base,
  id: `rooms-${i}`,
  sourceId: `rooms-${i}`,
  dedupKey: `rooms-${i}`,
  rooms,
}));

afterAll(async () => prisma.$disconnect());

it("includes the accepted 7, 8 and 15 room sales in the 7+ bucket", async () => {
  await seed(prisma, sales([7, 8, 15]));
  expect(await roomsBreakdown()).toMatchObject([{ rooms: 7, count: 3 }]);
});

it("floors fractional rooms and caps the bucket without extending the 1–15 domain", async () => {
  await seed(prisma, sales([1, 1.9, 6.9, 7.1, 14.9, 15, null, -1, 0, 0.9, 15.1, 16]));
  expect((await roomsBreakdown()).map(({ rooms, count }) => ({ rooms, count }))).toEqual([
    { rooms: 1, count: 2 },
    { rooms: 6, count: 1 },
    { rooms: 7, count: 3 },
  ]);
});

it("computes all 7+ statistics over the deduplicated priced population", async () => {
  const rows = sales([7, 8.5, 15, 10, 11]);
  rows.forEach((row, i) => Object.assign(row, {
    pricePerSqmSek: BigInt([100_000, 200_000, 900_000, 0, -1][i]),
    areaSqm: [50, 100, 150, 900, 900][i],
    priceSek: BigInt([5_000_000, 20_000_000, 35_000_000, 0, -1][i]),
  }));
  await seed(prisma, [...rows, {
    ...rows[1], id: "rooms-duplicate", source: "booli", sourceId: "rooms-duplicate",
  }]);
  expect(await roomsBreakdown()).toEqual([{
    rooms: 7, count: 3, meanPricePerSqm: 400_000, medianPricePerSqm: 200_000,
    meanAreaSqm: 100, meanPriceSek: 20_000_000,
  }]);
});

it("returns no buckets when no sale has a valid priced room count", async () => {
  await seed(prisma, sales([null, 0, 16]));
  // Prisma rejects NaN input, but legacy PostgreSQL numeric values can contain it.
  await prisma.$executeRaw`UPDATE "Listing" SET rooms = 'NaN'::numeric WHERE id = 'rooms-0'`;
  await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
  expect(await roomsBreakdown()).toEqual([]);
});
