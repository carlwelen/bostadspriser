import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { MIN_MOVER_PRIOR_SALES, MIN_MOVER_RECENT_SALES, topMovers } from "@/lib/aggregations";
import type { DistrictSlug } from "@/lib/districts";
import type { FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// B26: movers compare the last 90 days with the disjoint 12 months before that,
// by median, and only for streets with enough sales in both windows.
//
// asOf = 2026-10-23 (Stockholm). Recent window: 2026-07-25 .. today. Prior
// window: 2025-07-25 .. 2026-07-24.

const AS_OF = new Date("2026-10-23T10:00:00Z");
const RECENT_START = "2026-07-25";
const PRIOR_START = "2025-07-25";
const LAST_PRIOR_DAY = "2026-07-24";
const BEFORE_PRIOR = "2025-07-24";

let seq = 0;
/** One sale per entry of `dates`, all at `pps` kr/m². */
const sales = (
  street: string,
  dates: string[],
  pps: number,
  district: DistrictSlug = "vasastan"
): FixtureListing[] =>
  dates.map((d) => {
    seq += 1;
    return {
      id: `mv-${seq}`,
      source: "hemnet",
      sourceId: `mv-${seq}`,
      dedupKey: `mv-dedup-${seq}`,
      street,
      houseNumber: String(seq),
      district,
      rooms: 2,
      areaSqm: 50,
      priceSek: BigInt(pps * 50),
      pricePerSqmSek: BigInt(pps),
      soldAt: new Date(`${d}T00:00:00Z`),
      lat: 59.34,
      lng: 18.05,
      raw: {},
    };
  });

const repeat = (date: string, n: number) => Array.from({ length: n }, () => date);

/** `nPrior` sales mid-prior-window at `priorPps`, `nRecent` mid-recent-window at `recentPps`. */
const street = (
  name: string,
  nPrior: number,
  priorPps: number,
  nRecent: number,
  recentPps: number,
  district: DistrictSlug = "vasastan"
) => [
  ...sales(name, repeat("2026-01-15", nPrior), priorPps, district),
  ...sales(name, repeat("2026-09-01", nRecent), recentPps, district),
];

afterAll(async () => {
  await prisma.$disconnect();
});

describe("thresholds", () => {
  it("are 5 recent and 10 prior sales", () => {
    expect([MIN_MOVER_RECENT_SALES, MIN_MOVER_PRIOR_SALES]).toEqual([5, 10]);
  });

  it("include a street exactly at both thresholds and exclude one just below either", async () => {
    await seed(prisma, [
      ...street("Exact", 10, 100_000, 5, 110_000),
      ...street("FewRecent", 10, 100_000, 4, 150_000),
      ...street("FewPrior", 9, 100_000, 5, 150_000),
    ]);
    const movers = await topMovers("up", 10, AS_OF);
    expect(movers.map((m) => m.street)).toEqual(["Exact"]);
    expect(movers[0]).toMatchObject({ recentCount: 5, priorCount: 10 });
    expect(movers[0].pctChange).toBeCloseTo(10, 6);
  });
});

describe("medians over disjoint windows", () => {
  it("uses medians, not means, and reports both windows' sizes", async () => {
    await seed(prisma, [
      // Prior: eleven sales at 100k plus one wild outlier -> median 100k.
      ...sales("Odengatan", [...repeat("2026-01-15", 10), "2026-02-01"], 100_000),
      ...sales("Odengatan", ["2026-03-01"], 1_000_000),
      // Recent: five at 120k.
      ...sales("Odengatan", repeat("2026-09-01", 5), 120_000),
    ]);
    const [m] = await topMovers("up", 5, AS_OF);
    expect(m).toMatchObject({
      street: "Odengatan",
      slug: "odengatan",
      district: "vasastan",
      priorCount: 12,
      recentCount: 5,
      priorMedianPricePerSqm: 100_000,
      recentMedianPricePerSqm: 120_000,
    });
    expect(m.pctChange).toBeCloseTo(20, 6);
    // Legacy fields keep their meaning: recent mean, all-sales mean and count.
    expect(m.windowMeanPricePerSqm).toBe(120_000);
    expect(m.count).toBe(17);
    expect(m.meanPricePerSqm).toBe(Math.round((100_000 * 11 + 1_000_000 + 120_000 * 5) / 17));
  });

  it("splits the windows cleanly at the boundaries and ignores older sales", async () => {
    await seed(prisma, [
      // Prior: first and last day of the window, 5 + 5 sales at 100k.
      ...sales("Boundary", repeat(PRIOR_START, 5), 100_000),
      ...sales("Boundary", repeat(LAST_PRIOR_DAY, 5), 100_000),
      // One day before the prior window: in neither window.
      ...sales("Boundary", repeat(BEFORE_PRIOR, 3), 1_000_000),
      // Recent: first day of the window (the 90th day back) and today.
      ...sales("Boundary", repeat(RECENT_START, 3), 150_000),
      ...sales("Boundary", repeat("2026-10-23", 2), 150_000),
    ]);
    const [m] = await topMovers("up", 5, AS_OF);
    expect(m).toMatchObject({ priorCount: 10, recentCount: 5 });
    expect(m.priorMedianPricePerSqm).toBe(100_000);
    expect(m.pctChange).toBeCloseTo(50, 6);
  });

  it("orders up and down movers and applies the limit", async () => {
    await seed(prisma, [
      ...street("Up20", 10, 100_000, 5, 120_000),
      ...street("Up50", 10, 100_000, 5, 150_000),
      ...street("Down20", 10, 100_000, 5, 80_000, "norrmalm"),
    ]);
    expect((await topMovers("up", 5, AS_OF)).map((m) => m.street)).toEqual(["Up50", "Up20", "Down20"]);
    expect((await topMovers("down", 5, AS_OF)).map((m) => m.street)).toEqual(["Down20", "Up20", "Up50"]);
    expect((await topMovers("up", 1, AS_OF)).map((m) => m.street)).toEqual(["Up50"]);
  });

  it("breaks ties by district (enum order) and then street", async () => {
    await seed(prisma, [
      ...street("Samma", 10, 100_000, 5, 110_000, "sodermalm"),
      ...street("Samma", 10, 100_000, 5, 110_000, "norrmalm"),
      ...street("Samma", 10, 100_000, 5, 110_000, "vasastan"),
      ...street("Aaa", 10, 100_000, 5, 110_000, "vasastan"),
    ]);
    const key = (ms: Awaited<ReturnType<typeof topMovers>>) => ms.map((m) => `${m.district}/${m.street}`);
    const expected = ["vasastan/Aaa", "vasastan/Samma", "norrmalm/Samma", "sodermalm/Samma"];
    expect(key(await topMovers("up", 10, AS_OF))).toEqual(expected);
    expect(key(await topMovers("down", 10, AS_OF))).toEqual(expected);
    expect(key(await topMovers("up", 2, AS_OF))).toEqual(expected.slice(0, 2));
  });

  it("district outranks street in ties", async () => {
    await seed(prisma, [
      ...street("Samma", 10, 100_000, 5, 110_000, "norrmalm"),
      ...street("Aaa", 10, 100_000, 5, 110_000, "sodermalm"),
      ...street("Samma", 10, 100_000, 5, 110_000, "vasastan"),
    ]);
    const key = (ms: Awaited<ReturnType<typeof topMovers>>) => ms.map((m) => `${m.district}/${m.street}`);
    // Enum order is vasastan, norrmalm, sodermalm; by street alone "Aaa" would be first.
    expect(key(await topMovers("up", 10, AS_OF))).toEqual([
      "vasastan/Samma",
      "norrmalm/Samma",
      "sodermalm/Aaa",
    ]);
  });

  it("returns nothing on an empty database", async () => {
    await seed(prisma, []);
    expect(await topMovers("up", 5, AS_OF)).toEqual([]);
  });
});
