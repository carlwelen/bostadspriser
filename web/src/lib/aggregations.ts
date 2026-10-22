import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { DistrictSlug } from "./districts";

export type Granularity = "month" | "year";

export type TimeseriesPoint = {
  bucket: string;
  meanPricePerSqm: number;
  count: number;
};

export type StreetSummary = {
  street: string;
  slug: string;
  count: number;
  meanPricePerSqm: number;
  latestSoldAt: string;
};

export type RecentSale = {
  street: string;
  houseNumber: string | null;
  rooms: number | null;
  areaSqm: number | null;
  priceSek: number;
  pricePerSqmSek: number;
  soldAt: string;
  sources: string[];
};

const TRUNC = (g: Granularity) => (g === "year" ? "year" : "month");

/** Stable, URL-safe slug for a Swedish street name. Round-trip via `unslugifyStreet`. */
export function slugifyStreet(name: string): string {
  return name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Resolve a slug back to its canonical street display name within a district. */
export async function streetFromSlug(
  district: DistrictSlug,
  slug: string
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ street: string }>>(Prisma.sql`
    SELECT DISTINCT street
    FROM "DedupedListing"
    WHERE district = ${district}::"District"
  `);
  return rows.find((r) => slugifyStreet(r.street) === slug)?.street ?? null;
}

export async function districtTimeseries(
  district: DistrictSlug,
  granularity: Granularity = "month"
): Promise<TimeseriesPoint[]> {
  const trunc = TRUNC(granularity);
  const rows = await prisma.$queryRaw<
    Array<{ bucket: Date; mean_price_per_sqm: bigint; n: bigint }>
  >(Prisma.sql`
    SELECT
      date_trunc(${trunc}, "soldAt")::date AS bucket,
      AVG("pricePerSqmSek")::bigint        AS mean_price_per_sqm,
      COUNT(*)::bigint                     AS n
    FROM "DedupedListing"
    WHERE district = ${district}::"District"
      AND "pricePerSqmSek" > 0
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  return rows.map((r) => ({
    bucket: r.bucket.toISOString().slice(0, 10),
    meanPricePerSqm: Number(r.mean_price_per_sqm),
    count: Number(r.n),
  }));
}

export async function streetTimeseries(
  district: DistrictSlug,
  street: string,
  granularity: Granularity = "month",
  houseNumber?: string
): Promise<TimeseriesPoint[]> {
  const trunc = TRUNC(granularity);
  const houseFilter = houseNumber
    ? Prisma.sql`AND "houseNumber" = ${houseNumber}`
    : Prisma.sql``;
  const rows = await prisma.$queryRaw<
    Array<{ bucket: Date; mean_price_per_sqm: bigint; n: bigint }>
  >(Prisma.sql`
    SELECT
      date_trunc(${trunc}, "soldAt")::date AS bucket,
      AVG("pricePerSqmSek")::bigint        AS mean_price_per_sqm,
      COUNT(*)::bigint                     AS n
    FROM "DedupedListing"
    WHERE district = ${district}::"District"
      AND street    = ${street}
      ${houseFilter}
      AND "pricePerSqmSek" > 0
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  return rows.map((r) => ({
    bucket: r.bucket.toISOString().slice(0, 10),
    meanPricePerSqm: Number(r.mean_price_per_sqm),
    count: Number(r.n),
  }));
}

export async function listStreets(
  district: DistrictSlug,
  limit = 200
): Promise<StreetSummary[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      street: string;
      n: bigint;
      mean_pps: bigint;
      latest: Date;
    }>
  >(Prisma.sql`
    SELECT street,
           COUNT(*)::bigint                AS n,
           AVG("pricePerSqmSek")::bigint   AS mean_pps,
           MAX("soldAt")                   AS latest
    FROM "DedupedListing"
    WHERE district = ${district}::"District"
      AND "pricePerSqmSek" > 0
    GROUP BY street
    ORDER BY n DESC, street ASC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    street: r.street,
    slug: slugifyStreet(r.street),
    count: Number(r.n),
    meanPricePerSqm: Number(r.mean_pps),
    latestSoldAt: r.latest.toISOString().slice(0, 10),
  }));
}

export async function listHouseNumbers(
  district: DistrictSlug,
  street: string
): Promise<Array<{ houseNumber: string; count: number; meanPricePerSqm: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ houseNumber: string; n: bigint; mean_pps: bigint }>
  >(Prisma.sql`
    SELECT "houseNumber",
           COUNT(*)::bigint                AS n,
           AVG("pricePerSqmSek")::bigint   AS mean_pps
    FROM "DedupedListing"
    WHERE district = ${district}::"District"
      AND street    = ${street}
      AND "houseNumber" IS NOT NULL
    GROUP BY "houseNumber"
    ORDER BY "houseNumber" ASC
  `);

  return rows.map((r) => ({
    houseNumber: r.houseNumber,
    count: Number(r.n),
    meanPricePerSqm: Number(r.mean_pps),
  }));
}

export async function recentSales(
  where: { district: DistrictSlug; street?: string; houseNumber?: string },
  limit = 25
): Promise<RecentSale[]> {
  const conds: Prisma.Sql[] = [Prisma.sql`district = ${where.district}::"District"`];
  if (where.street) conds.push(Prisma.sql`street = ${where.street}`);
  if (where.houseNumber) conds.push(Prisma.sql`"houseNumber" = ${where.houseNumber}`);
  const rows = await prisma.$queryRaw<
    Array<{
      street: string;
      houseNumber: string | null;
      rooms: Prisma.Decimal | null;
      areaSqm: Prisma.Decimal | null;
      priceSek: bigint;
      pricePerSqmSek: bigint;
      soldAt: Date;
      sources: string[];
    }>
  >(Prisma.sql`
    SELECT street, "houseNumber", rooms, "areaSqm", "priceSek", "pricePerSqmSek", "soldAt", sources
    FROM "DedupedListing"
    WHERE ${Prisma.join(conds, " AND ")}
    ORDER BY "soldAt" DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    street: r.street,
    houseNumber: r.houseNumber,
    rooms: r.rooms ? Number(r.rooms) : null,
    areaSqm: r.areaSqm ? Number(r.areaSqm) : null,
    priceSek: Number(r.priceSek),
    pricePerSqmSek: Number(r.pricePerSqmSek),
    soldAt: r.soldAt.toISOString().slice(0, 10),
    sources: r.sources ?? [],
  }));
}

export type StreetMover = {
  street: string;
  slug: string;
  district: DistrictSlug;
  count: number;
  meanPricePerSqm: number;
  windowMeanPricePerSqm: number;
  pctChange: number;
};

/**
 * Streets whose mean price/m² changed the most between the trailing 12-month
 * window and the most recent 90-day window. Excludes streets with too few data
 * points to be meaningful (`minRecent` / `minHistorical`).
 */
export async function topMovers(
  direction: "up" | "down",
  limit = 8
): Promise<StreetMover[]> {
  const op = direction === "up" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const rows = await prisma.$queryRaw<
    Array<{
      district: DistrictSlug;
      street: string;
      n: bigint;
      mean_pps: bigint;
      window_mean_pps: bigint;
      pct: number;
    }>
  >(Prisma.sql`
    WITH agg AS (
      SELECT
        district,
        street,
        COUNT(*) FILTER (WHERE "soldAt" >= CURRENT_DATE - 90)::bigint               AS recent_n,
        AVG("pricePerSqmSek") FILTER (WHERE "soldAt" >= CURRENT_DATE - 90)::bigint  AS recent_mean,
        COUNT(*)::bigint                                                            AS hist_n,
        AVG("pricePerSqmSek")::bigint                                               AS hist_mean
      FROM "DedupedListing"
      WHERE "pricePerSqmSek" > 0
      GROUP BY district, street
    )


    SELECT district,
           street,
           hist_n               AS n,
           hist_mean            AS mean_pps,
           recent_mean          AS window_mean_pps,
           ((recent_mean - hist_mean)::float8 / NULLIF(hist_mean, 0)::float8) * 100 AS pct
    FROM agg
    WHERE recent_n >= 2 AND hist_n >= 4 AND recent_mean IS NOT NULL
    ORDER BY pct ${op} NULLS LAST
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    district: r.district,
    street: r.street,
    slug: slugifyStreet(r.street),
    count: Number(r.n),
    meanPricePerSqm: Number(r.mean_pps),
    windowMeanPricePerSqm: Number(r.window_mean_pps),
    pctChange: Number(r.pct),
  }));
}

/** Bucketed price/m² distribution across all districts. */
export async function pricePerSqmDistribution(
  bucketWidth = 20_000
): Promise<Array<{ bucket: number; count: number }>> {
  const rows = await prisma.$queryRaw<Array<{ bucket: number; n: bigint }>>(Prisma.sql`
    SELECT (FLOOR("pricePerSqmSek" / ${bucketWidth}::numeric)::int * ${bucketWidth}) AS bucket,
           COUNT(*)::bigint                                                          AS n
    FROM "DedupedListing"
    WHERE "pricePerSqmSek" > 0
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return rows.map((r) => ({ bucket: Number(r.bucket), count: Number(r.n) }));
}

/** Per-room-count breakdown: average price/m², average area, count. */
export async function roomsBreakdown(): Promise<
  Array<{
    rooms: number;
    count: number;
    meanPricePerSqm: number;
    meanAreaSqm: number;
    meanPriceSek: number;
  }>
> {
  const rows = await prisma.$queryRaw<
    Array<{
      rooms_floor: number;
      n: bigint;
      mean_pps: bigint;
      mean_area: number | null;
      mean_price: bigint;
    }>
  >(Prisma.sql`
    SELECT FLOOR(rooms)::int        AS rooms_floor,
           COUNT(*)::bigint         AS n,
           AVG("pricePerSqmSek")::bigint  AS mean_pps,
           AVG("areaSqm")           AS mean_area,
           AVG("priceSek")::bigint  AS mean_price
    FROM "DedupedListing"
    WHERE rooms IS NOT NULL
      AND "pricePerSqmSek" > 0
      AND rooms >= 1 AND rooms < 8
    GROUP BY FLOOR(rooms)
    ORDER BY rooms_floor ASC
  `);
  return rows.map((r) => ({
    rooms: Number(r.rooms_floor),
    count: Number(r.n),
    meanPricePerSqm: Number(r.mean_pps),
    meanAreaSqm: r.mean_area ? Number(r.mean_area) : 0,
    meanPriceSek: Number(r.mean_price),
  }));
}

/** Random-but-stable sample of (areaSqm, pricePerSqmSek, rooms) tuples for a scatter plot. */
export async function priceAreaSample(limit = 600): Promise<
  Array<{ areaSqm: number; pricePerSqm: number; rooms: number | null; district: string }>
> {
  const rows = await prisma.$queryRaw<
    Array<{ areaSqm: number; pricePerSqm: number; rooms: number | null; district: string }>
  >(Prisma.sql`
    SELECT "areaSqm"::float8        AS "areaSqm",
           "pricePerSqmSek"::int    AS "pricePerSqm",
           rooms::float8            AS rooms,
           district::text           AS district
    FROM "DedupedListing"
    WHERE "areaSqm" IS NOT NULL AND "pricePerSqmSek" > 0
    ORDER BY ("id"::text)
    LIMIT ${limit}
  `);
  return rows;
}

/** Single-shot summary across the whole dataset. */
export async function globalSummary(): Promise<{
  total: number;
  meanPricePerSqm: number | null;
  earliest: string | null;
  latest: string | null;
  byDistrict: Array<{ district: string; count: number; meanPricePerSqm: number }>;
}> {
  const [tot] = await prisma.$queryRaw<
    Array<{ n: bigint; mean: bigint | null; earliest: Date | null; latest: Date | null }>
  >(Prisma.sql`
    SELECT COUNT(*)::bigint AS n,
           AVG("pricePerSqmSek")::bigint AS mean,
           MIN("soldAt") AS earliest,
           MAX("soldAt") AS latest
    FROM "DedupedListing"
    WHERE "pricePerSqmSek" > 0
  `);
  const byDistrict = await prisma.$queryRaw<
    Array<{ district: string; n: bigint; mean: bigint }>
  >(Prisma.sql`
    SELECT district::text AS district, COUNT(*)::bigint AS n, AVG("pricePerSqmSek")::bigint AS mean
    FROM "DedupedListing"
    WHERE "pricePerSqmSek" > 0
    GROUP BY district
    ORDER BY n DESC
  `);
  return {
    total: Number(tot?.n ?? 0),
    meanPricePerSqm: tot?.mean ? Number(tot.mean) : null,
    earliest: tot?.earliest?.toISOString().slice(0, 10) ?? null,
    latest: tot?.latest?.toISOString().slice(0, 10) ?? null,
    byDistrict: byDistrict.map((r) => ({
      district: r.district,
      count: Number(r.n),
      meanPricePerSqm: Number(r.mean),
    })),
  };
}

export type DistrictSummary = {
  count: number;
  meanPricePerSqm: number | null;
  earliest: string | null;
  latest: string | null;
};

/** Dedup-aware single-shot summary for one district. */
export async function districtSummary(
  district: DistrictSlug
): Promise<DistrictSummary> {
  const [row] = await prisma.$queryRaw<
    Array<{ n: bigint; mean: bigint | null; earliest: Date | null; latest: Date | null }>
  >(Prisma.sql`
    SELECT COUNT(*)::bigint                    AS n,
           AVG("pricePerSqmSek")::bigint       AS mean,
           MIN("soldAt")                       AS earliest,
           MAX("soldAt")                       AS latest
    FROM "DedupedListing"
    WHERE district = ${district}::"District"
      AND "pricePerSqmSek" > 0
  `);
  return {
    count: Number(row?.n ?? 0),
    meanPricePerSqm: row?.mean ? Number(row.mean) : null,
    earliest: row?.earliest?.toISOString().slice(0, 10) ?? null,
    latest: row?.latest?.toISOString().slice(0, 10) ?? null,
  };
}

/** Month-over-month change for the latest two complete buckets. */
export async function districtMomChange(district: DistrictSlug): Promise<{
  current: number | null;
  previous: number | null;
  pctChange: number | null;
} | null> {
  const ts = await districtTimeseries(district, "month");
  if (ts.length === 0) return null;
  const current = ts.at(-1)?.meanPricePerSqm ?? null;
  const previous = ts.at(-2)?.meanPricePerSqm ?? null;
  const pctChange =
    current !== null && previous !== null && previous > 0
      ? ((current - previous) / previous) * 100
      : null;
  return { current, previous, pctChange };
}
