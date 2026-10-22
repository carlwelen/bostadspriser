import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isDistrictSlug, type DistrictSlug } from "@/lib/districts";

const PERIODS = {
  "30d": { days: 30, granularity: "day" as const },
  "3mo": { days: 90, granularity: "week" as const },
  "12mo": { days: 365, granularity: "month" as const },
  all: { days: null as number | null, granularity: "month" as const },
};

type Period = keyof typeof PERIODS;

type Sale = {
  soldAt: Date;
  priceSek: bigint;
  pricePerSqmSek: bigint;
  sources: string[] | null;
};

type Bucket = {
  bucket: Date;
  mean_price_per_sqm: bigint;
  n: bigint;
};

/**
 * Fetch the data backing the price-dot drawer:
 *   - per-address sales (rendered as dots),
 *   - street-level rolled-up series (rendered as the trend line).
 *
 * Period selects time range + bucket granularity. Address can be a single house
 * (when ?house= is set) or all houses on the street.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const district = searchParams.get("district");
  const street = searchParams.get("street");
  const house = searchParams.get("house");
  const period = (searchParams.get("period") ?? "12mo") as Period;

  if (!district || !isDistrictSlug(district)) {
    return NextResponse.json({ error: "missing/invalid district" }, { status: 400 });
  }
  if (!street) {
    return NextResponse.json({ error: "missing street" }, { status: 400 });
  }
  if (!(period in PERIODS)) {
    return NextResponse.json({ error: "invalid period" }, { status: 400 });
  }

  const { days, granularity } = PERIODS[period];
  const sinceClause = days
    ? Prisma.sql`AND "soldAt" >= CURRENT_DATE - ${days}::int`
    : Prisma.sql``;
  const houseClause = house
    ? Prisma.sql`AND "houseNumber" = ${house}`
    : Prisma.sql``;

  const districtTyped = district as DistrictSlug;

  const [addressSales, streetSeries] = await Promise.all([
    prisma.$queryRaw<Sale[]>(Prisma.sql`
      SELECT "soldAt", "priceSek", "pricePerSqmSek", sources
      FROM "DedupedListing"
      WHERE district = ${districtTyped}::"District"
        AND street    = ${street}
        ${houseClause}
        AND "pricePerSqmSek" > 0
      ORDER BY "soldAt" DESC
      LIMIT 200
    `),
    prisma.$queryRaw<Bucket[]>(Prisma.sql`
      SELECT
        date_trunc(${granularity}, "soldAt")::date AS bucket,
        AVG("pricePerSqmSek")::bigint              AS mean_price_per_sqm,
        COUNT(*)::bigint                           AS n
      FROM "DedupedListing"
      WHERE district = ${districtTyped}::"District"
        AND street    = ${street}
        AND "pricePerSqmSek" > 0
        ${sinceClause}
      GROUP BY bucket
      ORDER BY bucket ASC
    `),
  ]);

  return NextResponse.json(
    {
      district,
      street,
      house,
      period,
      granularity,
      streetSeries: streetSeries.map((r) => ({
        bucket: r.bucket.toISOString().slice(0, 10),
        meanPricePerSqm: Number(r.mean_price_per_sqm),
        count: Number(r.n),
      })),
      addressSales: addressSales.map((r) => ({
        soldAt: r.soldAt.toISOString().slice(0, 10),
        priceSek: Number(r.priceSek),
        pricePerSqmSek: Number(r.pricePerSqmSek),
        sources: r.sources ?? [],
      })),
    },
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } }
  );
}
