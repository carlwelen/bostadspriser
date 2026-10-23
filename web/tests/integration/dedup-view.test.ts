import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// B9 (schema half): DedupedListing breaks the final tie between duplicate rows
// by `lastSeenAt` (when a scraper last saw the row), not `scrapedAt` (when it
// first inserted it).

const base = {
  source: "hemnet",
  dedupKey: "view-dup",
  street: "Odengatan",
  houseNumber: "7",
  district: "vasastan",
  rooms: 2,
  areaSqm: 50,
  priceSek: BigInt(5_000_000),
  pricePerSqmSek: BigInt(100_000),
  soldAt: new Date("2026-03-10T00:00:00Z"),
  lat: 59.34,
  lng: 18.05,
  raw: {},
} as const;

const row = (id: string, extra: Partial<FixtureListing>): FixtureListing => ({
  ...base,
  id,
  sourceId: id,
  ...extra,
});

const winner = async (key = "view-dup") => {
  const rows = await prisma.$queryRaw<Array<{ id: string; sources: string[] }>>`
    SELECT id, sources FROM "DedupedListing" WHERE "dedupKey" = ${key}`;
  expect(rows).toHaveLength(1);
  return rows[0];
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe("DedupedListing tie-breaker", () => {
  beforeEach(async () => {
    await seed(prisma, []);
  });

  it("prefers the row seen most recently when everything else ties", async () => {
    await seed(prisma, [
      // "old" was scraped later than "new" but last seen earlier: lastSeenAt decides.
      row("old", {
        scrapedAt: new Date("2026-04-02T00:00:00Z"),
        lastSeenAt: new Date("2026-04-02T00:00:00Z"),
      }),
      row("new", {
        scrapedAt: new Date("2026-04-01T00:00:00Z"),
        lastSeenAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ]);
    expect((await winner()).id).toBe("new");
  });

  it("is independent of insertion order", async () => {
    await seed(prisma, [
      row("new", { lastSeenAt: new Date("2026-06-01T00:00:00Z") }),
      row("old", { lastSeenAt: new Date("2026-04-02T00:00:00Z") }),
    ]);
    expect((await winner()).id).toBe("new");
  });

  it("still ranks coordinates and source priority above lastSeenAt", async () => {
    await seed(prisma, [
      row("hemnet-old", { lastSeenAt: new Date("2026-01-01T00:00:00Z") }),
      row("booli-new", { source: "booli", lastSeenAt: new Date("2026-06-01T00:00:00Z") }),
    ]);
    const w = await winner();
    expect(w.id).toBe("hemnet-old");
    expect(w.sources).toEqual(["booli", "hemnet"]);

    await seed(prisma, [
      row("no-coords-new", { lat: null, lng: null, lastSeenAt: new Date("2026-06-01T00:00:00Z") }),
      row("coords-old", { lastSeenAt: new Date("2026-01-01T00:00:00Z") }),
    ]);
    expect((await winner()).id).toBe("coords-old");
  });
});

describe("DedupedListing prefers priced rows (B38)", () => {
  it("picks the copy with a price over a better-ranked copy priced 0", async () => {
    await seed(prisma, [
      // Hemnet + coordinates would normally win, but this copy has no kr/m².
      row("unpriced", { pricePerSqmSek: BigInt(0), priceSek: BigInt(0) }),
      row("priced", { source: "booli", lat: null, lng: null }),
    ]);
    const w = await winner();
    expect(w.id).toBe("priced");
    expect(w.sources).toEqual(["booli", "hemnet"]);
    const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "DedupedListing" WHERE "pricePerSqmSek" > 0`;
    expect(Number(n)).toBe(1);
  });

  it("is independent of insertion order and still falls back to the unpriced row", async () => {
    await seed(prisma, [
      row("priced", { source: "booli", lat: null, lng: null }),
      row("unpriced", { pricePerSqmSek: BigInt(0), priceSek: BigInt(0) }),
    ]);
    expect((await winner()).id).toBe("priced");

    await seed(prisma, [row("only-unpriced", { pricePerSqmSek: BigInt(0), priceSek: BigInt(0) })]);
    expect((await winner()).id).toBe("only-unpriced");
  });
});

describe("DedupedListing clusters (B13)", () => {
  const count = async () => {
    const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "DedupedListing"`;
    return Number(n);
  };

  it("collapses rows with different dedupKeys that share a clusterId", async () => {
    await seed(prisma, [
      row("hemnet-1", { dedupKey: "key-a", clusterId: "cluster-1" }),
      row("booli-1", { source: "booli", dedupKey: "key-b", clusterId: "cluster-1", lat: null, lng: null }),
      row("other", { dedupKey: "key-c" }),
    ]);
    expect(await count()).toBe(2);
    const [c] = await prisma.$queryRaw<Array<{ id: string; sources: string[] }>>`
      SELECT id, sources FROM "DedupedListing" WHERE "clusterId" = 'cluster-1'`;
    // Same preference as before: the row with coordinates (Hemnet) wins, and
    // `sources` is aggregated over the whole cluster.
    expect(c).toEqual({ id: "hemnet-1", sources: ["booli", "hemnet"] });
  });

  it("keeps rows with different dedupKeys apart when there is no clusterId", async () => {
    await seed(prisma, [row("a", { dedupKey: "key-a" }), row("b", { dedupKey: "key-b" })]);
    expect(await count()).toBe(2);
  });

  it("still collapses a shared dedupKey when clusterId is null", async () => {
    await seed(prisma, [
      row("a", { dedupKey: "same" }),
      row("b", { source: "booli", dedupKey: "same" }),
    ]);
    expect(await count()).toBe(1);
  });

  it("applies the preference rules across the cluster, in any insertion order", async () => {
    const members = [
      row("unpriced", { dedupKey: "k1", clusterId: "c", pricePerSqmSek: BigInt(0) }),
      row("booli-late", { source: "booli", dedupKey: "k2", clusterId: "c", lastSeenAt: new Date("2026-09-01T00:00:00Z") }),
      row("hemnet-old", { dedupKey: "k3", clusterId: "c", lastSeenAt: new Date("2026-01-01T00:00:00Z") }),
      row("hemnet-new", { dedupKey: "k4", clusterId: "c", lastSeenAt: new Date("2026-06-01T00:00:00Z") }),
    ];
    for (const order of [members, [...members].reverse()]) {
      await seed(prisma, order);
      expect(await count()).toBe(1);
      const [w] = await prisma.$queryRaw<Array<{ id: string; sources: string[] }>>`
        SELECT id, sources FROM "DedupedListing"`;
      expect(w).toEqual({ id: "hemnet-new", sources: ["booli", "hemnet"] });
    }
  });

  it("lets an unclustered row join a cluster named after its dedupKey", async () => {
    await seed(prisma, [
      row("seed", { dedupKey: "key-a" }),
      row("late", { source: "booli", dedupKey: "key-b", clusterId: "key-a" }),
    ]);
    expect(await count()).toBe(1);
  });

  it("collapses a later exact copy of an already-clustered sale (upserts never set clusterId)", async () => {
    await seed(prisma, [
      row("hemnet-1", { dedupKey: "key-a", clusterId: "c1" }),
      row("booli-1", { source: "booli", dedupKey: "key-b", clusterId: "c1" }),
      row("other-1", { source: "other", dedupKey: "key-b" }), // later exact copy of booli-1
    ]);
    expect(await count()).toBe(1);
    const [w] = await prisma.$queryRaw<Array<{ id: string; sources: string[] }>>`
      SELECT id, sources FROM "DedupedListing"`;
    expect(w).toEqual({ id: "hemnet-1", sources: ["booli", "hemnet", "other"] });
  });

  it("does not merge unrelated clusters or unclustered rows", async () => {
    await seed(prisma, [
      row("a1", { dedupKey: "ka1", clusterId: "c1" }),
      row("a2", { dedupKey: "ka2", clusterId: "c1" }),
      row("b1", { dedupKey: "kb1", clusterId: "c2" }),
      row("b1-copy", { source: "booli", dedupKey: "kb1" }),
      row("solo", { dedupKey: "ks" }),
      row("legacy", { dedupKey: null }),
    ]);
    // c1, c2 (with its exact copy), solo and the NULL-dedupKey legacy row.
    expect(await count()).toBe(4);
  });

  it("ranks a copy with both coordinates above one with only a latitude", async () => {
    await seed(prisma, [
      row("lat-only", { lng: null, lastSeenAt: new Date("2026-09-01T00:00:00Z") }),
      row("full", { lastSeenAt: new Date("2026-01-01T00:00:00Z") }),
    ]);
    expect((await winner()).id).toBe("full");
  });

  it("indexes clusterId", async () => {
    const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM pg_indexes
      WHERE tablename = 'Listing' AND indexdef LIKE '%"clusterId"%'`;
    expect(Number(n)).toBe(1);
  });
});

describe("Listing.lastSeenAt column", () => {
  beforeEach(async () => {
    await seed(prisma, []);
  });

  it("is NOT NULL and defaults to now() for inserts that do not mention it", async () => {
    // What the Python scraper's reflected insert looks like today: no lastSeenAt.
    await prisma.$executeRaw`
      INSERT INTO "Listing" (id, source, "sourceId", street, district, "priceSek",
                             "pricePerSqmSek", "soldAt", raw)
      VALUES ('raw-insert', 'hemnet', 'raw-insert', 'Odengatan', 'vasastan', 1, 1,
              DATE '2026-03-10', '{}'::jsonb)`;
    const [r] = await prisma.$queryRaw<Array<{ ageMs: number }>>`
      SELECT (EXTRACT(EPOCH FROM (now() - "lastSeenAt")) * 1000)::float8 AS "ageMs"
      FROM "Listing" WHERE id = 'raw-insert'`;
    expect(r.ageMs).toBeGreaterThanOrEqual(-1000);
    expect(r.ageMs).toBeLessThan(60_000);

    const [{ nullable }] = await prisma.$queryRaw<Array<{ nullable: string }>>`
      SELECT is_nullable AS nullable FROM information_schema.columns
      WHERE table_name = 'Listing' AND column_name = 'lastSeenAt'`;
    expect(nullable).toBe("NO");
  });
});
