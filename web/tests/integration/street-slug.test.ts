import { readFileSync } from "node:fs";
import { afterAll, expect, it, vi } from "vitest";
import vectors from "../../../shared/slug-vectors.json";
import { prisma } from "@/lib/db";
import { slugifyStreet, streetFromSlug } from "@/lib/aggregations";
import { buildFixture } from "../fixtures/listings";
import { seed } from "../support/seed";

afterAll(() => prisma.$disconnect());

it("persists SQL slugs matching shared stable URL vectors and TS", async () => {
  const names = [...vectors.slug.map((v) => v.input), "ÅÄÖ ÉÈ Ü", "İgatan", "Kgatan"];
  const base = buildFixture()[0];
  await seed(prisma, names.map((street, i) => ({ ...base, id: `slug-${i}`, sourceId: `slug-${i}`, dedupKey: `slug-${i}`, street })));
  const rows = await prisma.$queryRaw<Array<{ street: string; streetSlug: string }>>`SELECT street, "streetSlug" FROM "Listing"`;
  for (const row of rows) expect(row.streetSlug, row.street).toBe(slugifyStreet(row.street));
  for (const v of vectors.slug) expect(rows.find((r) => r.street === v.input)?.streetSlug).toBe(v.expected);
});

it("maintains slugs on inserts and updates, overriding stale supplied values", async () => {
  const row = buildFixture()[0];
  await seed(prisma, [row]);
  for (const street of ["Götgatan", "Götgatan", "S:t Eriksgatan"]) {
    await prisma.$executeRaw`UPDATE "Listing" SET street = ${street}, "streetSlug" = 'stale' WHERE id = ${row.id}`;
    const [stored] = await prisma.$queryRaw<Array<{ streetSlug: string }>>`SELECT "streetSlug" FROM "Listing" WHERE id = ${row.id}`;
    expect(stored.streetSlug).toBe(slugifyStreet(street));
  }
  await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
  const [live] = await prisma.$queryRaw<Array<{ streetSlug: string }>>`SELECT "streetSlug" FROM "DedupedListing"`;
  const [snapshot] = await prisma.$queryRaw<Array<{ streetSlug: string }>>`SELECT "streetSlug" FROM "DedupedListingMat"`;
  expect(live.streetSlug).toBe("s-t-eriksgatan");
  expect(snapshot).toEqual(live);
});

it("uses direct district/slug lookup with deterministic collision resolution", async () => {
  const base = buildFixture()[0];
  await seed(prisma, ["Ågatan", "Agatan"].map((street, i) => ({ ...base, district: "vasastan", id: `collision-${i}`, sourceId: `collision-${i}`, dedupKey: `collision-${i}`, street })));
  const spy = vi.spyOn(prisma, "$queryRaw");
  try {
    expect(await streetFromSlug("vasastan", "agatan")).toBe("Agatan");
    const query = spy.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(query.sql).toContain('"streetSlug" =');
    expect(query.sql).toContain("LIMIT 1");
    expect(query.values).toContain("agatan");
    expect(await streetFromSlug("norrmalm", "agatan")).toBeNull();
  } finally { spy.mockRestore(); }
  const indexes = await prisma.$queryRaw<Array<{ tablename: string; indexdef: string }>>`SELECT tablename, indexdef FROM pg_indexes WHERE tablename IN ('Listing', 'DedupedListingMat')`;
  for (const table of ["Listing", "DedupedListingMat"]) {
    expect(indexes.some((r) => r.tablename === table && r.indexdef.includes('(district, "streetSlug"'))).toBe(true);
  }
});

it("backfills legacy rows idempotently using the migration statement", async () => {
  await seed(prisma, [buildFixture()[0]]);
  const migration = readFileSync(new URL("../../prisma/migrations/20261024100000_street_slug/migration.sql", import.meta.url), "utf8");
  const backfill = migration.match(/UPDATE "Listing" SET "streetSlug" = street_slug\(street\);/)?.[0];
  expect(backfill).toBeDefined();
  await prisma.$transaction(async (tx) => {
    // Model a row that predates the trigger, without changing the shared schema.
    await tx.$executeRawUnsafe('ALTER TABLE "Listing" DISABLE TRIGGER "Listing_streetSlug"');
    await tx.$executeRaw`UPDATE "Listing" SET "streetSlug" = ''`;
    await tx.$executeRawUnsafe(backfill!);
    const first = await tx.$queryRaw<Array<{ street: string; streetSlug: string }>>`SELECT street, "streetSlug" FROM "Listing"`;
    expect(first[0].streetSlug).toBe(slugifyStreet(first[0].street));
    await tx.$executeRawUnsafe(backfill!);
    expect(await tx.$queryRaw`SELECT street, "streetSlug" FROM "Listing"`).toEqual(first);
    await tx.$executeRawUnsafe('ALTER TABLE "Listing" ENABLE TRIGGER "Listing_streetSlug"');
  });
});
