import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { districtSummary } from "@/lib/aggregations";
import type { FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// B21: reads go through "DedupedListingMat", a materialized snapshot of the
// live "DedupedListing" view, refreshed by refresh_deduped_listing().

const row = (id: string, extra: Partial<FixtureListing> = {}): FixtureListing => ({
  id,
  source: "hemnet",
  sourceId: id,
  dedupKey: id,
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
  ...extra,
});

const matCount = async () => {
  const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM "DedupedListingMat"`;
  return Number(n);
};

const refresh = () => prisma.$executeRaw`SELECT refresh_deduped_listing()`;

afterAll(async () => {
  await prisma.$disconnect();
});

describe("DedupedListingMat", () => {
  it("holds exactly the rows (and columns) of the live view after a refresh", async () => {
    await seed(prisma); // the shared fixture, which includes a duplicate pair
    const [{ only_live }] = await prisma.$queryRaw<Array<{ only_live: bigint }>>`
      SELECT COUNT(*)::bigint AS only_live FROM (
        SELECT * FROM "DedupedListing" EXCEPT SELECT * FROM "DedupedListingMat") d`;
    const [{ only_mat }] = await prisma.$queryRaw<Array<{ only_mat: bigint }>>`
      SELECT COUNT(*)::bigint AS only_mat FROM (
        SELECT * FROM "DedupedListingMat" EXCEPT SELECT * FROM "DedupedListing") d`;
    expect([Number(only_live), Number(only_mat)]).toEqual([0, 0]);
    expect(await matCount()).toBeGreaterThan(0);
  });

  it("is a snapshot: it changes only on refresh_deduped_listing()", async () => {
    await seed(prisma, [row("a")]);
    expect(await matCount()).toBe(1);

    await prisma.listing.create({ data: row("b") });
    expect(await matCount()).toBe(1); // stale on purpose
    expect((await districtSummary("vasastan")).count).toBe(1);

    await refresh();
    expect(await matCount()).toBe(2);
    expect((await districtSummary("vasastan")).count).toBe(2);
  });

  it("refreshes inside a transaction, repeatedly, and when empty", async () => {
    await seed(prisma, [row("a")]);
    await prisma.$transaction(async (tx) => {
      await tx.listing.create({ data: row("b") });
      await tx.$executeRaw`SELECT refresh_deduped_listing()`;
      await tx.$executeRaw`SELECT refresh_deduped_listing()`;
    });
    expect(await matCount()).toBe(2);

    await seed(prisma, []);
    expect(await matCount()).toBe(0);
    await refresh();
    expect(await matCount()).toBe(0);
  });

  it("refreshes with a plain REFRESH, not CONCURRENTLY (which hung the suite twice)", async () => {
    const [{ src }] = await prisma.$queryRaw<Array<{ src: string }>>`
      SELECT prosrc AS src FROM pg_proc WHERE proname = 'refresh_deduped_listing'`;
    expect(src).toMatch(/REFRESH MATERIALIZED VIEW/);
    expect(src).not.toMatch(/CONCURRENTLY/i);
  });

  it("copes with the snapshot growing and shrinking between refreshes", async () => {
    const many = (tag: string, n: number) =>
      Array.from({ length: n }, (_, i) => row(`${tag}-${i}`));
    for (const [tag, n] of [["a", 3000], ["b", 5], ["c", 0], ["d", 3000]] as const) {
      await seed(prisma, many(tag, n));
      expect(await matCount()).toBe(n);
    }
  });

  it("gives up after 5 s instead of queueing behind a long reader (lock_timeout)", async () => {
    const [{ cfg }] = await prisma.$queryRaw<Array<{ cfg: string[] | null }>>`
      SELECT proconfig AS cfg FROM pg_proc WHERE proname = 'refresh_deduped_listing'`;
    expect(cfg).toContain("lock_timeout=5s");

    await seed(prisma, [row("a")]);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let locked: () => void = () => {};
    const holding = new Promise<void>((r) => (locked = r));
    // A reader holding ACCESS SHARE on the snapshot, as a long page query would.
    const reader = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT COUNT(*) FROM "DedupedListingMat"`;
        locked();
        await gate;
      },
      { timeout: 60_000 }
    );
    await holding;
    const t0 = Date.now();
    await expect(refresh()).rejects.toThrow(/lock timeout/i);
    const waited = Date.now() - t0;
    release();
    await reader;
    expect(waited).toBeGreaterThan(4_000);
    expect(waited).toBeLessThan(15_000);
    await refresh(); // fine again once the reader is gone
  });

  it("runs the test connections with the configured statement_timeout (60 s by default)", async () => {
    const [{ statement_timeout }] = await prisma.$queryRaw<Array<{ statement_timeout: string }>>`
      SHOW statement_timeout`;
    // Postgres prints the largest unit that divides the value evenly.
    const ms = Number(process.env.TEST_DB_STATEMENT_TIMEOUT_MS ?? "60000");
    const show = (n: number) =>
      n === 0 ? "0"
      : n % 3_600_000 === 0 ? `${n / 3_600_000}h`
      : n % 60_000 === 0 ? `${n / 60_000}min`
      : n % 1000 === 0 ? `${n / 1000}s`
      : `${n}ms`;
    expect(statement_timeout).toBe(show(ms));
  });

  it("has the same column list as the live view (recreate both together)", async () => {
    const cols = async (rel: string) =>
      (
        await prisma.$queryRawUnsafe<Array<{ attname: string; type: string }>>(
          `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type
           FROM pg_attribute a
           WHERE a.attrelid = '"${rel}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped
           ORDER BY a.attnum`
        )
      ).map((c) => `${c.attname}:${c.type}`);
    const live = await cols("DedupedListing");
    expect(await cols("DedupedListingMat")).toEqual(live);
    // And both carry every Listing column plus the aggregated `sources`.
    const listing = (
      await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'Listing'
        ORDER BY ordinal_position`
    ).map((c) => c.column_name);
    expect(live.map((c) => c.split(":")[0])).toEqual([...listing, "sources"]);
  });

  it("follows deduplication (clusters, priced rows) like the live view", async () => {
    await seed(prisma, [
      row("h", { dedupKey: "k1", clusterId: "c" }),
      row("b", { source: "booli", dedupKey: "k2", clusterId: "c", lat: null, lng: null }),
      row("u", { source: "other", dedupKey: "k2", pricePerSqmSek: BigInt(0) }),
    ]);
    const [m] = await prisma.$queryRaw<Array<{ id: string; sources: string[] }>>`
      SELECT id, sources FROM "DedupedListingMat"`;
    expect(await matCount()).toBe(1);
    expect(m).toEqual({ id: "h", sources: ["booli", "hemnet", "other"] });
  });

  it("has a unique id index (kept for lookups; allows CONCURRENTLY later) and the query indexes", async () => {
    const idx = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'DedupedListingMat'`;
    const defs = idx.map((i) => i.indexdef);
    expect(defs.some((d) => d.includes("CREATE UNIQUE INDEX") && d.includes("(id)"))).toBe(true);
    expect(defs.some((d) => d.includes("(district, \"soldAt\")"))).toBe(true);
    expect(defs.some((d) => d.includes("(district, street, \"houseNumber\", \"soldAt\")"))).toBe(true);
    expect(defs.some((d) => d.includes("(lat, lng)"))).toBe(true);
  });
});
