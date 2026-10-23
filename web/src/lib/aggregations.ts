import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { DistrictSlug } from "./districts";
import {
  OPEN_ENDED_ROOMS,
  type AddressBucketGranularity,
  type AddressSale,
  type StreetsAllItem,
} from "./api-types";

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

/**
 * SQL expression for today's date in Europe/Stockholm (`soldAt` is a
 * Stockholm-local date). Use it instead of `CURRENT_DATE`, which follows the
 * database session's time zone. `asOf` pins the clock for tests.
 */
export function stockholmToday(asOf: Date = new Date()): Prisma.Sql {
  return Prisma.sql`((${asOf}::timestamptz AT TIME ZONE 'Europe/Stockholm')::date)`;
}

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

/**
 * Natural order for house numbers: numeric prefix, then letter ("3" before
 * "3A"), then the end of a range ("10" before "10-12"). Unparseable values
 * ("Kv") sort last; ties fall back to the text. POSIX classes rather than
 * `\d`, because Prisma.sql reads the cooked template string.
 */
const HOUSE_NUMBER_ORDER = Prisma.sql`
  NULLIF(substring("houseNumber" from '^[0-9]{1,9}'), '')::int ASC NULLS LAST,
  upper(substring("houseNumber" from '^[0-9]+[[:space:]]*([[:alpha:]])')) ASC NULLS FIRST,
  NULLIF(substring("houseNumber" from '^[0-9]+[[:space:]]*[[:alpha:]]?[[:space:]]*-[[:space:]]*([0-9]{1,9})'), '')::int ASC NULLS FIRST,
  "houseNumber" ASC`;

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
    ORDER BY ${HOUSE_NUMBER_ORDER}
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
  limit = 8,
  asOf: Date = new Date()
): Promise<StreetMover[]> {
  const op = direction === "up" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const today = stockholmToday(asOf);
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
        COUNT(*) FILTER (WHERE "soldAt" >= ${today} - 90)::bigint               AS recent_n,
        AVG("pricePerSqmSek") FILTER (WHERE "soldAt" >= ${today} - 90)::bigint  AS recent_mean,
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

/** Dedup-aware headline numbers for a set of sales (kr/m², whole kronor). */
export type SalesSummary = {
  count: number;
  meanPricePerSqm: number | null;
  /** Median is robust to the odd outlier sale; prefer it over the mean for display. */
  medianPricePerSqm: number | null;
  earliest: string | null;
  latest: string | null;
};

export type DistrictStreetCount = SalesSummary & {
  /** Distinct streets with at least one sale in the district. */
  streetCount: number;
};

type SummaryRow = {
  n: bigint;
  streets: bigint;
  mean: bigint | null;
  median: bigint | null;
  earliest: Date | null;
  latest: Date | null;
};

async function summarize(
  scope: Prisma.Sql
): Promise<{ summary: SalesSummary; streetCount: number }> {
  const [row] = await prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
    SELECT COUNT(*)::bigint                                                      AS n,
           COUNT(DISTINCT street)::bigint                                        AS streets,
           AVG("pricePerSqmSek")::bigint                                         AS mean,
           ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY "pricePerSqmSek"))::numeric)::bigint AS median,
           MIN("soldAt")                                                         AS earliest,
           MAX("soldAt")                                                         AS latest
    FROM "DedupedListing"
    WHERE ${scope}
      AND "pricePerSqmSek" > 0
  `);
  return {
    streetCount: Number(row?.streets ?? 0),
    summary: {
      count: Number(row?.n ?? 0),
      meanPricePerSqm: row?.mean != null ? Number(row.mean) : null,
      medianPricePerSqm: row?.median != null ? Number(row.median) : null,
      earliest: row?.earliest?.toISOString().slice(0, 10) ?? null,
      latest: row?.latest?.toISOString().slice(0, 10) ?? null,
    },
  };
}

/** Summary of every sale on one street. */
export async function streetSummary(
  district: DistrictSlug,
  street: string
): Promise<SalesSummary> {
  const { summary } = await summarize(
    Prisma.sql`district = ${district}::"District" AND street = ${street}`
  );
  return summary;
}

/** Summary of every sale at one address (street + house number, exact match). */
export async function addressSummary(
  district: DistrictSlug,
  street: string,
  houseNumber: string
): Promise<SalesSummary> {
  const { summary } = await summarize(
    Prisma.sql`district = ${district}::"District" AND street = ${street} AND "houseNumber" = ${houseNumber}`
  );
  return summary;
}

/** Exact number of streets with sales in a district, plus the district summary. */
export async function districtStreetCount(
  district: DistrictSlug
): Promise<DistrictStreetCount> {
  const { streetCount, summary } = await summarize(
    Prisma.sql`district = ${district}::"District"`
  );
  return { streetCount, ...summary };
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

/** A month-over-month change needs at least this many sales in *each* month. */
export const MIN_MOM_SALES = 3;

export type DistrictMomChange = {
  /** Mean kr/m² of the latest complete month; null if it has no sales. */
  current: number | null;
  /** Mean kr/m² of the month before that; null if it has no sales. */
  previous: number | null;
  /** Percent change; null unless both months have at least `MIN_MOM_SALES` sales. */
  pctChange: number | null;
  /** First day (YYYY-MM-DD) of the two compared months. */
  currentMonth: string;
  previousMonth: string;
  /** Sales behind each mean, so callers can say how thin the data is. */
  currentCount: number;
  previousCount: number;
};

/**
 * Month-over-month change between the last two complete, adjacent calendar
 * months. "Complete" means before the current month in Europe/Stockholm
 * (`soldAt` is a Stockholm-local date), so in mid-April it compares March with
 * February; the partial April is ignored. If either month is missing or has
 * fewer than `MIN_MOM_SALES` sales, `pctChange` is null. Returns null when
 * neither month has any sales.
 *
 * `asOf` is the instant treated as "now" (defaults to the current time).
 */
export async function districtMomChange(
  district: DistrictSlug,
  asOf: Date = new Date()
): Promise<DistrictMomChange | null> {
  // `back` = whole calendar months before `asOf`'s month (Stockholm): 1 is the
  // latest complete month, 2 the one before it. Months with no sales have no row.
  const rows = await prisma.$queryRaw<
    Array<{ back: number; mean_pps: bigint; n: bigint; current_month: string; previous_month: string }>
  >(Prisma.sql`
    WITH bounds AS (
      SELECT date_trunc('month', ${asOf}::timestamptz AT TIME ZONE 'Europe/Stockholm')::date AS cur
    )
    SELECT ((EXTRACT(YEAR FROM b.cur) * 12 + EXTRACT(MONTH FROM b.cur))
          - (EXTRACT(YEAR FROM l."soldAt") * 12 + EXTRACT(MONTH FROM l."soldAt")))::int AS back,
           AVG(l."pricePerSqmSek")::bigint                                     AS mean_pps,
           COUNT(*)::bigint                                                    AS n,
           to_char(b.cur - INTERVAL '1 month', 'YYYY-MM-DD')                   AS current_month,
           to_char(b.cur - INTERVAL '2 months', 'YYYY-MM-DD')                  AS previous_month
    FROM "DedupedListing" l, bounds b
    WHERE l.district = ${district}::"District"
      AND l."pricePerSqmSek" > 0
      AND l."soldAt" >= (b.cur - INTERVAL '2 months')::date
      AND l."soldAt" <  b.cur
    GROUP BY back, b.cur
  `);
  if (rows.length === 0) return null;

  const cur = rows.find((r) => r.back === 1);
  const prev = rows.find((r) => r.back === 2);
  const current = cur ? Number(cur.mean_pps) : null;
  const previous = prev ? Number(prev.mean_pps) : null;
  const currentCount = cur ? Number(cur.n) : 0;
  const previousCount = prev ? Number(prev.n) : 0;
  const pctChange =
    current !== null &&
    previous !== null &&
    previous > 0 &&
    currentCount >= MIN_MOM_SALES &&
    previousCount >= MIN_MOM_SALES
      ? ((current - previous) / previous) * 100
      : null;
  return {
    current,
    previous,
    pctChange,
    currentMonth: rows[0].current_month,
    previousMonth: rows[0].previous_month,
    currentCount,
    previousCount,
  };
}

// Queries behind the JSON API routes (moved out of the route handlers, B27).

/** Upper bound on points returned for the map (revisit with B25). */
export const HEATMAP_LIMIT = 50_000;

export type HeatmapFilters = {
  districts?: DistrictSlug[];
  /** west, south, east, north in degrees (inclusive). */
  bbox?: [number, number, number, number];
  /** kr/m², inclusive bounds. */
  priceMin?: number;
  priceMax?: number;
  /** Room counts; `OPEN_ENDED_ROOMS` (5) means "5 or more", other values match FLOOR(rooms). */
  rooms?: number[];
  /** Only sales from the last N days, counted from today in Stockholm. */
  sinceDays?: number;
};

export type HeatmapPoint = {
  lat: number;
  lng: number;
  pricePerSqm: number;
  street: string;
  houseNumber: string | null;
  district: DistrictSlug;
  soldAt: Date;
  source: string;
  sources: string[];
  dedupKey: string | null;
};

/** Geocoded, deduplicated sales matching `filters`, newest first. */
export async function heatmapPoints(
  filters: HeatmapFilters = {},
  asOf: Date = new Date()
): Promise<HeatmapPoint[]> {
  const { districts, bbox, priceMin, priceMax, rooms, sinceDays } = filters;
  const conds: Prisma.Sql[] = [
    Prisma.sql`lat IS NOT NULL`,
    Prisma.sql`lng IS NOT NULL`,
    Prisma.sql`"pricePerSqmSek" > 0`,
  ];
  if (districts && districts.length > 0) {
    conds.push(Prisma.sql`district::text IN (${Prisma.join(districts)})`);
  }
  if (bbox) {
    const [w, s, e, n] = bbox;
    conds.push(Prisma.sql`lng BETWEEN ${w} AND ${e}`);
    conds.push(Prisma.sql`lat BETWEEN ${s} AND ${n}`);
  }
  if (priceMin !== undefined) {
    conds.push(Prisma.sql`"pricePerSqmSek" >= ${priceMin}`);
  }
  if (priceMax !== undefined) {
    conds.push(Prisma.sql`"pricePerSqmSek" <= ${priceMax}`);
  }
  if (rooms && rooms.length > 0) {
    // Every value matches the integer-rounded room count (4 covers 4 and 4.5),
    // except the open-ended "5+" value (5), which matches 5 rooms or more.
    // `rooms` is non-empty, so at least one of the two alternatives exists.
    const exact = rooms.filter((r) => r !== OPEN_ENDED_ROOMS);
    const alts: Prisma.Sql[] = [];
    if (exact.length > 0) alts.push(Prisma.sql`FLOOR(rooms) IN (${Prisma.join(exact)})`);
    if (rooms.includes(OPEN_ENDED_ROOMS)) alts.push(Prisma.sql`rooms >= ${OPEN_ENDED_ROOMS}`);
    conds.push(Prisma.sql`(${Prisma.join(alts, " OR ")})`);
  }
  if (sinceDays !== undefined) {
    conds.push(Prisma.sql`"soldAt" >= (${stockholmToday(asOf)} - ${sinceDays}::int)`);
  }

  return prisma.$queryRaw<HeatmapPoint[]>(Prisma.sql`
    SELECT lat, lng,
           "pricePerSqmSek"::int AS "pricePerSqm",
           street, "houseNumber", district::text AS district,
           "soldAt", source, sources, "dedupKey"
    FROM "DedupedListing"
    WHERE ${Prisma.join(conds, " AND ")}
    ORDER BY "soldAt" DESC
    LIMIT ${HEATMAP_LIMIT}
  `);
}

/** Every street with sales, busiest first (ties by name), across all districts. */
export async function listAllStreets(limit = 4000): Promise<StreetsAllItem[]> {
  const rows = await prisma.$queryRaw<
    Array<{ district: DistrictSlug; street: string; n: bigint; mean_pps: bigint }>
  >(Prisma.sql`
    SELECT district::text AS district,
           street,
           COUNT(*)::bigint               AS n,
           AVG("pricePerSqmSek")::bigint  AS mean_pps
    FROM "DedupedListing"
    WHERE "pricePerSqmSek" > 0
    GROUP BY district, street
    ORDER BY n DESC, street ASC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    district: r.district,
    street: r.street,
    slug: slugifyStreet(r.street),
    count: Number(r.n),
    meanPricePerSqm: Number(r.mean_pps),
  }));
}

export type AddressDrawerData = {
  streetSeries: TimeseriesPoint[];
  addressSales: AddressSale[];
};

/**
 * Data behind the price-dot drawer: the sales at one address (all houses on the
 * street when `house` is omitted, newest first, at most 200) and the street's
 * bucketed trend. `days` limits both to the last N days (Stockholm), null = all
 * time; `bucket` is the trend's date_trunc unit.
 */
export async function addressDrawerData(
  district: DistrictSlug,
  street: string,
  house: string | undefined,
  range: { days: number | null; bucket: AddressBucketGranularity },
  asOf: Date = new Date()
): Promise<AddressDrawerData> {
  const sinceClause = range.days
    ? Prisma.sql`AND "soldAt" >= ${stockholmToday(asOf)} - ${range.days}::int`
    : Prisma.sql``;
  const houseClause = house ? Prisma.sql`AND "houseNumber" = ${house}` : Prisma.sql``;

  const [sales, series] = await Promise.all([
    prisma.$queryRaw<
      Array<{ soldAt: Date; priceSek: bigint; pricePerSqmSek: bigint; sources: string[] | null }>
    >(Prisma.sql`
      SELECT "soldAt", "priceSek", "pricePerSqmSek", sources
      FROM "DedupedListing"
      WHERE district = ${district}::"District"
        AND street    = ${street}
        ${houseClause}
        AND "pricePerSqmSek" > 0
        ${sinceClause}
      ORDER BY "soldAt" DESC
      LIMIT 200
    `),
    prisma.$queryRaw<Array<{ bucket: Date; mean_price_per_sqm: bigint; n: bigint }>>(Prisma.sql`
      SELECT
        date_trunc(${range.bucket}, "soldAt")::date AS bucket,
        AVG("pricePerSqmSek")::bigint               AS mean_price_per_sqm,
        COUNT(*)::bigint                            AS n
      FROM "DedupedListing"
      WHERE district = ${district}::"District"
        AND street    = ${street}
        AND "pricePerSqmSek" > 0
        ${sinceClause}
      GROUP BY bucket
      ORDER BY bucket ASC
    `),
  ]);

  return {
    streetSeries: series.map((r) => ({
      bucket: r.bucket.toISOString().slice(0, 10),
      meanPricePerSqm: Number(r.mean_price_per_sqm),
      count: Number(r.n),
    })),
    addressSales: sales.map((r) => ({
      soldAt: r.soldAt.toISOString().slice(0, 10),
      priceSek: Number(r.priceSek),
      pricePerSqmSek: Number(r.pricePerSqmSek),
      sources: r.sources ?? [],
    })),
  };
}
