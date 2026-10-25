import { afterAll, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { heatmapPoints } from "@/lib/aggregations";
import { GET as heatmapGET } from "@/app/api/heatmap/route";
import type { HeatmapResponse } from "@/lib/api-types";
import { buildFixture } from "../fixtures/listings";
import { seed } from "../support/seed";

const [base] = buildFixture();
type CoordinateCase = [id: string, lat: string | null, lng: string | null];
const valid: CoordinateCase[] = [
  ["valid-origin", "0", "0"],
  ["valid-north-east", "90", "180"],
  ["valid-south-west", "-90", "-180"],
  ["valid-stockholm", "59.34", "18.05"],
];
const invalid: CoordinateCase[] = [
  ["null-both", null, null],
  ["null-lat", null, "18"],
  ["null-lng", "59", null],
  ["high-lat", "90.0001", "18"],
  ["low-lat", "-90.0001", "18"],
  ["high-lng", "59", "180.0001"],
  ["low-lng", "59", "-180.0001"],
  ["both-outside", "91", "181"],
  ["nan-lat", "NaN", "18"],
  ["nan-lng", "59", "NaN"],
  ["infinite-lat", "Infinity", "18"],
  ["negative-infinite-lat", "-Infinity", "18"],
  ["infinite-lng", "59", "Infinity"],
  ["negative-infinite-lng", "59", "-Infinity"],
];

async function seedCoordinates(cases: CoordinateCase[]) {
  await seed(prisma, cases.map(([id]) => ({
    ...base, id, sourceId: id, dedupKey: id, street: id,
  })));
  // Write legacy non-finite values through PostgreSQL's float parser.
  for (const [id, lat, lng] of cases) {
    await prisma.$executeRaw`UPDATE "Listing" SET lat = ${lat}::float8, lng = ${lng}::float8 WHERE id = ${id}`;
  }
  await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
}

afterAll(async () => prisma.$disconnect());

it("excludes null, non-finite and out-of-world legacy coordinates on either axis", async () => {
  await seedCoordinates([...invalid, ...valid]);
  const { points, truncated } = await heatmapPoints();
  expect(points.map((point) => point.street)).toEqual(valid.map(([id]) => id).sort());
  expect(truncated).toBe(false);
  expect(points.map(({ lat, lng }) => [lat, lng])).toEqual([
    [90, 180], [0, 0], [-90, -180], [59.34, 18.05],
  ]);
});

it("returns empty valid GeoJSON for an entirely unmappable legacy population", async () => {
  await seedCoordinates(invalid);
  const response = await heatmapGET(new Request("http://localhost/api/heatmap"));
  expect(response.status).toBe(200);
  const body: HeatmapResponse = await response.json();
  expect(body).toEqual({ type: "FeatureCollection", features: [], truncated: false });
});

it("keeps geographic bounds independent of the existing selection filters", async () => {
  await seedCoordinates([...invalid, ...valid]);
  const selected = { ...base, rooms: 5, soldAt: new Date("2026-09-01"), pricePerSqmSek: 100_000 };
  await prisma.listing.createMany({ data: [
    { ...selected, id: "match-a", sourceId: "match-a", dedupKey: "match-a", street: "Match A",
      rooms: 5.5 },
    { ...selected, id: "match-b", sourceId: "match-b", dedupKey: "match-b", street: "Match B",
      rooms: 7, pricePerSqmSek: 150_000 },
    { ...selected, id: "other-rooms", sourceId: "other-rooms", dedupKey: "other-rooms", rooms: 4 },
    { ...selected, id: "other-price", sourceId: "other-price", dedupKey: "other-price", pricePerSqmSek: 200_000 },
    { ...selected, id: "other-district", sourceId: "other-district", dedupKey: "other-district", district: "vasastan" },
    { ...selected, id: "other-bbox", sourceId: "other-bbox", dedupKey: "other-bbox", lat: -59 },
    { ...selected, id: "other-date", sourceId: "other-date", dedupKey: "other-date", soldAt: new Date("2026-01-01") },
  ] });
  await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
  const result = await heatmapPoints({
    districts: ["ostermalm"], bbox: [18, 59, 19, 60], rooms: [5],
    priceMin: 100_000, priceMax: 150_000, sinceDays: 90,
  }, new Date("2026-10-01T00:00:00Z"));
  expect(result.points.map(({ street }) => street)).toEqual(["Match A", "Match B"]);
  expect(result.truncated).toBe(false);
});
