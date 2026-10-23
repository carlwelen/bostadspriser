import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  AddressBucketGranularity,
  AddressResponse,
  Period,
} from "@/lib/api-types";
import { PUBLIC_CACHE, addressQuery, parseQuery, withApiErrors } from "@/lib/api-validation";

const PERIOD_CONFIG: Record<
  Period,
  { days: number | null; granularity: AddressBucketGranularity }
> = {
  "30d": { days: 30, granularity: "day" },
  "3mo": { days: 90, granularity: "week" },
  "12mo": { days: 365, granularity: "month" },
  all: { days: null, granularity: "month" },
};

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
export const GET = withApiErrors("/api/address", async (request: Request) => {
  const parsed = parseQuery(addressQuery, new URL(request.url).searchParams);
  if (!parsed.ok) return parsed.response;
  const { district, street, house, period } = parsed.data;

  const { days, granularity } = PERIOD_CONFIG[period];
  const sinceClause = days
    ? Prisma.sql`AND "soldAt" >= CURRENT_DATE - ${days}::int`
    : Prisma.sql``;
  const houseClause = house
    ? Prisma.sql`AND "houseNumber" = ${house}`
    : Prisma.sql``;

  const [addressSales, streetSeries] = await Promise.all([
    prisma.$queryRaw<Sale[]>(Prisma.sql`
      SELECT "soldAt", "priceSek", "pricePerSqmSek", sources
      FROM "DedupedListing"
      WHERE district = ${district}::"District"
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
      WHERE district = ${district}::"District"
        AND street    = ${street}
        AND "pricePerSqmSek" > 0
        ${sinceClause}
      GROUP BY bucket
      ORDER BY bucket ASC
    `),
  ]);

  const body: AddressResponse = {
    district,
    street,
    house: house ?? null,
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
  };
  return NextResponse.json(body, { headers: { "Cache-Control": PUBLIC_CACHE } });
});
