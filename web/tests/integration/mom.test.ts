import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { MIN_MOM_SALES, districtMomChange } from "@/lib/aggregations";
import type { DistrictSlug } from "@/lib/districts";
import type { FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// B7: MoM compares the last two *complete, adjacent* calendar months (Stockholm
// time), and is null when either month has fewer than MIN_MOM_SALES sales.

let seq = 0;
/** `n` sales in `month` ("YYYY-MM") at a fixed kr/m², spread over distinct days. */
function sales(
  month: string,
  n: number,
  pps: number,
  district: DistrictSlug = "vasastan"
): FixtureListing[] {
  return Array.from({ length: n }, (_, i) => {
    seq += 1;
    return {
      id: `mom-${seq}`,
      source: "hemnet",
      sourceId: `mom-${seq}`,
      dedupKey: `mom-dedup-${seq}`,
      street: "Odengatan",
      houseNumber: String(i + 1),
      district,
      rooms: 2,
      areaSqm: 50,
      priceSek: BigInt(pps * 50),
      pricePerSqmSek: BigInt(pps),
      soldAt: new Date(`${month}-${String(i + 5).padStart(2, "0")}T00:00:00Z`),
      lat: 59.34,
      lng: 18.05,
      raw: {},
    };
  });
}

const N = MIN_MOM_SALES;
const at = (iso: string) => new Date(iso);
// Mid-April 2026 in Stockholm: the complete months are 2026-03 and 2026-02.
const APRIL = at("2026-04-15T10:00:00Z");

afterAll(async () => {
  await prisma.$disconnect();
});

describe("MIN_MOM_SALES", () => {
  it("is 3", () => {
    expect(MIN_MOM_SALES).toBe(3);
  });
});

describe("districtMomChange", () => {
  it("ignores the in-progress month", async () => {
    await seed(prisma, [
      ...sales("2026-02", N, 100_000),
      ...sales("2026-03", N, 110_000),
      ...sales("2026-04", N, 200_000), // partial month: must not count
    ]);
    const mom = await districtMomChange("vasastan", APRIL);
    expect(mom).toMatchObject({ previous: 100_000, current: 110_000 });
    expect(mom?.pctChange).toBeCloseTo(10, 6);
  });

  it("returns null pctChange when a month is missing instead of comparing non-adjacent months", async () => {
    await seed(prisma, [...sales("2026-01", N, 100_000), ...sales("2026-03", N, 110_000)]);
    const mom = await districtMomChange("vasastan", APRIL);
    expect(mom).toMatchObject({ previous: null, current: 110_000, pctChange: null });
  });

  it("returns null pctChange when the latest complete month is missing", async () => {
    await seed(prisma, [...sales("2026-02", N, 100_000), ...sales("2026-04", N, 120_000)]);
    const mom = await districtMomChange("vasastan", APRIL);
    expect(mom).toMatchObject({ previous: 100_000, current: null, pctChange: null });
  });

  it("returns null pctChange when either month has fewer than MIN_MOM_SALES sales", async () => {
    await seed(prisma, [...sales("2026-02", N, 100_000), ...sales("2026-03", N - 1, 110_000)]);
    expect((await districtMomChange("vasastan", APRIL))?.pctChange).toBeNull();

    await seed(prisma, [...sales("2026-02", N - 1, 100_000), ...sales("2026-03", N, 110_000)]);
    expect((await districtMomChange("vasastan", APRIL))?.pctChange).toBeNull();
  });

  it("computes a change at exactly MIN_MOM_SALES and reports the counts", async () => {
    await seed(prisma, [...sales("2026-02", N, 100_000), ...sales("2026-03", N + 2, 90_000)]);
    const mom = await districtMomChange("vasastan", APRIL);
    expect(mom?.pctChange).toBeCloseTo(-10, 6);
    expect(mom).toMatchObject({
      previousMonth: "2026-02-01",
      currentMonth: "2026-03-01",
      previousCount: N,
      currentCount: N + 2,
    });
  });

  it("spans the year boundary", async () => {
    await seed(prisma, [...sales("2025-11", N, 100_000), ...sales("2025-12", N, 105_000)]);
    const mom = await districtMomChange("vasastan", at("2026-01-10T12:00:00Z"));
    expect(mom?.pctChange).toBeCloseTo(5, 6);
  });

  it("decides the current month in Stockholm time, not UTC", async () => {
    await seed(prisma, [
      ...sales("2026-01", N, 100_000),
      ...sales("2026-02", N, 110_000),
      ...sales("2026-03", N, 121_000),
    ]);
    // 23:30 on 31 March in Stockholm (CEST): March is still in progress.
    const before = await districtMomChange("vasastan", at("2026-03-31T21:30:00Z"));
    expect(before).toMatchObject({ previous: 100_000, current: 110_000 });
    // One hour later it is 1 April in Stockholm (but still 31 March in UTC).
    const after = await districtMomChange("vasastan", at("2026-03-31T22:30:00Z"));
    expect(after).toMatchObject({ previous: 110_000, current: 121_000 });
  });

  it("also rolls over at midnight in winter time (CET)", async () => {
    await seed(prisma, [
      ...sales("2025-11", N, 100_000),
      ...sales("2025-12", N, 105_000),
      ...sales("2026-01", N, 300_000),
    ]);
    // 22:30 UTC on 31 December is 23:30 in Stockholm: December is incomplete.
    const before = await districtMomChange("vasastan", at("2025-12-31T22:30:00Z"));
    expect(before).toMatchObject({ currentMonth: "2025-11-01", currentCount: N, previous: null });
    // 23:30 UTC is 00:30 on 1 January in Stockholm.
    const after = await districtMomChange("vasastan", at("2025-12-31T23:30:00Z"));
    expect(after).toMatchObject({ currentMonth: "2025-12-01", previous: 100_000, current: 105_000 });
  });

  it("only looks at the requested district and counts duplicated sales once", async () => {
    const march = sales("2026-03", N, 110_000);
    const dup = march[0];
    await seed(prisma, [
      ...sales("2026-02", N, 100_000),
      ...march,
      ...sales("2026-02", 10, 500_000, "ostermalm"),
      ...sales("2026-03", 10, 600_000, "ostermalm"),
      // Same sale reported by a second source (same dedupKey): still one sale.
      { ...dup, id: "mom-dup", source: "booli", sourceId: "mom-dup" },
    ]);
    const mom = await districtMomChange("vasastan", APRIL);
    expect(mom).toMatchObject({ previous: 100_000, current: 110_000, currentCount: N });
  });

  it("returns null when neither complete month has sales", async () => {
    await seed(prisma, sales("2026-04", N, 100_000));
    expect(await districtMomChange("vasastan", APRIL)).toBeNull();
    await seed(prisma, []);
    expect(await districtMomChange("vasastan", APRIL)).toBeNull();
  });
});

describe("districtMomChange without asOf", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults asOf to the current time", async () => {
    // Pin "now" and give both complete months data, so the result is non-null
    // and depends on the clock: a wrong default (e.g. the epoch) finds nothing.
    await seed(prisma, [...sales("2026-02", N, 100_000), ...sales("2026-03", N, 110_000)]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(APRIL);
    const mom = await districtMomChange("vasastan");
    expect(mom).not.toBeNull();
    expect(mom).toMatchObject({ previous: 100_000, current: 110_000 });
    expect(mom).toEqual(await districtMomChange("vasastan", APRIL));
  });
});
