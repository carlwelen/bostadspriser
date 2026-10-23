import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { latestScrapeRuns, sourceFreshness } from "@/lib/aggregations";
import type { FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// B18 (schema + SQL side): ScrapeRun rows and the freshness read model.

let seq = 0;
const listing = (source: string, soldAt: string): FixtureListing => {
  seq += 1;
  return {
    id: `fr-${seq}`,
    source,
    sourceId: `fr-${seq}`,
    dedupKey: `fr-dedup-${seq}`,
    street: "Odengatan",
    houseNumber: String(seq),
    district: "vasastan",
    rooms: 2,
    areaSqm: 50,
    priceSek: BigInt(5_000_000),
    pricePerSqmSek: BigInt(100_000),
    soldAt: new Date(`${soldAt}T00:00:00Z`),
    lat: 59.34,
    lng: 18.05,
    raw: {},
  };
};

const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  await seed(prisma, [
    listing("hemnet", "2025-06-01"),
    listing("hemnet", "2026-03-15"),
    listing("hemnet", "2026-02-01"),
    listing("booli", "2025-12-24"),
    listing("booli", "2026-03-20"),
  ]);
  await prisma.scrapeRun.createMany({
    data: [
      // hemnet/vasastan: ok at 08:00 and a *later* failure that must not count.
      { source: "hemnet", district: "vasastan", startedAt: at("2026-03-20T07:50:00Z"), finishedAt: at("2026-03-20T08:00:00Z"), status: "ok", pages: 4, rowsUpserted: 80, rowsRejected: 1, oldestSoldAt: at("2026-01-02T00:00:00Z") },
      { source: "hemnet", district: "vasastan", startedAt: at("2026-03-21T07:50:00Z"), finishedAt: at("2026-03-21T07:55:00Z"), status: "failed", error: "blocked" },
      // hemnet/ostermalm: an older ok and a newer partial; the partial is the latest.
      { source: "hemnet", district: "ostermalm", startedAt: at("2026-03-18T07:00:00Z"), finishedAt: at("2026-03-18T07:10:00Z"), status: "ok", pages: 3, rowsUpserted: 50 },
      { source: "hemnet", district: "ostermalm", startedAt: at("2026-03-22T07:00:00Z"), finishedAt: at("2026-03-22T07:30:00Z"), status: "partial", pages: 2, rowsUpserted: 20, error: "429" },
      // booli: still running, never finished.
      { source: "booli", district: "vasastan", startedAt: at("2026-03-23T07:00:00Z"), status: "running" },
      // a source that has runs but no listings yet.
      { source: "newsite", district: "norrmalm", startedAt: at("2026-03-01T07:00:00Z"), finishedAt: at("2026-03-01T07:05:00Z"), status: "ok" },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ScrapeRun table", () => {
  it("has working defaults, including a database-generated id", async () => {
    // What the scraper's reflected insert looks like: no id, no counters, no status.
    await prisma.$executeRaw`
      INSERT INTO "ScrapeRun" (source, district) VALUES ('hemnet', 'sodermalm')`;
    const row = await prisma.scrapeRun.findFirstOrThrow({ where: { district: "sodermalm" } });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row).toMatchObject({
      status: "running",
      pages: 0,
      rowsUpserted: 0,
      rowsRejected: 0,
      finishedAt: null,
      error: null,
      oldestSoldAt: null,
    });
    expect(row.startedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    await prisma.scrapeRun.delete({ where: { id: row.id } });
  });

  it("rejects an unknown status", async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO "ScrapeRun" (source, district, status) VALUES ('x', 'vasastan', 'weird')`
    ).rejects.toThrow();
  });
});

describe("latestScrapeRuns", () => {
  it("returns the latest ok/partial run per source and district", async () => {
    const runs = await latestScrapeRuns();
    expect(runs.map((r) => [r.source, r.district, r.status])).toEqual([
      ["hemnet", "ostermalm", "partial"],
      ["hemnet", "vasastan", "ok"],
      ["newsite", "norrmalm", "ok"],
    ]);
    expect(runs[1]).toEqual({
      source: "hemnet",
      district: "vasastan",
      status: "ok",
      startedAt: "2026-03-20T07:50:00.000Z",
      finishedAt: "2026-03-20T08:00:00.000Z",
      pages: 4,
      rowsUpserted: 80,
      rowsRejected: 1,
      oldestSoldAt: "2026-01-02",
    });
  });
});

describe("sourceFreshness", () => {
  it("reports the last successful finish and the sold-date coverage per source", async () => {
    expect(await sourceFreshness()).toEqual([
      {
        source: "booli",
        lastSuccessAt: null, // only a running run
        listingCount: 2,
        earliestSoldAt: "2025-12-24",
        latestSoldAt: "2026-03-20",
      },
      {
        source: "hemnet",
        // The failed run at 03-21 is ignored; the partial at 03-22 counts.
        lastSuccessAt: "2026-03-22T07:30:00.000Z",
        listingCount: 3,
        earliestSoldAt: "2025-06-01",
        latestSoldAt: "2026-03-15",
      },
      {
        source: "newsite",
        lastSuccessAt: "2026-03-01T07:05:00.000Z",
        listingCount: 0,
        earliestSoldAt: null,
        latestSoldAt: null,
      },
    ]);
  });

  it("is empty on an empty database", async () => {
    await seed(prisma, []);
    expect(await sourceFreshness()).toEqual([]);
    expect(await latestScrapeRuns()).toEqual([]);
  });
});
