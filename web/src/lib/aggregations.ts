// Reads go through "DedupedListingMat", a materialized snapshot of the live
// "DedupedListing" view (the dedup rules), refreshed by refresh_deduped_listing()
// after each scrape run. See docs/perf.md.
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { DistrictSlug } from "./districts";
import { cached } from "./cache";
import { slugifyStreet } from "./text";
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
  /** Robust to outlier sales; prefer it for display. */
  medianPricePerSqm: number;
  count: number;
};

export type StreetSummary = {
  street: string;
  slug: string;
  count: number;
  meanPricePerSqm: number;
  medianPricePerSqm: number;
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

/** Median kr/m² as whole kronor (half-up), for use inside aggregate queries. */
const MEDIAN_PPS = Prisma.sql`ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY "pricePerSqmSek"))::numeric)::bigint`;

/**
 * Room segmentation shared by page queries: undefined/[] includes unknown rooms;
 * selected values match FLOOR(rooms), with 5 meaning 5+. Unknown rooms are
 * excluded when a selection is active. Appended arguments preserve old callers.
 */
function roomFilter(rooms?: number[]): Prisma.Sql {
  if (!rooms?.length) return Prisma.sql``;
  const exact = rooms.filter((r) => r !== OPEN_ENDED_ROOMS);
  const alternatives: Prisma.Sql[] = [];
  if (exact.length) alternatives.push(Prisma.sql`FLOOR(rooms) IN (${Prisma.join(exact)})`);
  if (rooms.includes(OPEN_ENDED_ROOMS)) alternatives.push(Prisma.sql`rooms >= ${OPEN_ENDED_ROOMS}`);
  return Prisma.sql`AND (${Prisma.join(alternatives, " OR ")})`;
}

const TRUNC = (g: Granularity) => (g === "year" ? "year" : "month");

// The slug lives in ./text (shared vectors with the scraper); re-exported so
// existing imports keep working.
export { slugifyStreet };

/** Resolve a slug back to its canonical street display name within a district. */
async function streetFromSlugUncached(
  district: DistrictSlug,
  slug: string
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ street: string }>>(Prisma.sql`
    SELECT DISTINCT street
    FROM "DedupedListingMat"
    WHERE district = ${district}::"District"
  `);
  return rows.find((r) => slugifyStreet(r.street) === slug)?.street ?? null;
}

async function districtTimeseriesUncached(
  district: DistrictSlug,
  granularity: Granularity = "month",
  rooms?: number[]
): Promise<TimeseriesPoint[]> {
  const trunc = TRUNC(granularity);
  const rows = await prisma.$queryRaw<
    Array<{ bucket: Date; mean_price_per_sqm: bigint; median_price_per_sqm: bigint; n: bigint }>
  >(Prisma.sql`
    SELECT
      date_trunc(${trunc}, "soldAt")::date AS bucket,
      AVG("pricePerSqmSek")::bigint        AS mean_price_per_sqm,
      ${MEDIAN_PPS}                        AS median_price_per_sqm,
      COUNT(*)::bigint                     AS n
    FROM "DedupedListingMat"
    WHERE district = ${district}::"District"
      ${roomFilter(rooms)}
      AND "pricePerSqmSek" > 0
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  return rows.map((r) => ({
    bucket: r.bucket.toISOString().slice(0, 10),
    meanPricePerSqm: Number(r.mean_price_per_sqm),
    medianPricePerSqm: Number(r.median_price_per_sqm),
    count: Number(r.n),
  }));
}

async function streetTimeseriesUncached(
  district: DistrictSlug,
  street: string,
  granularity: Granularity = "month",
  houseNumber?: string,
  rooms?: number[]
): Promise<TimeseriesPoint[]> {
  const trunc = TRUNC(granularity);
  const houseFilter = houseNumber
    ? Prisma.sql`AND "houseNumber" = ${houseNumber}`
    : Prisma.sql``;
  const rows = await prisma.$queryRaw<
    Array<{ bucket: Date; mean_price_per_sqm: bigint; median_price_per_sqm: bigint; n: bigint }>
  >(Prisma.sql`
    SELECT
      date_trunc(${trunc}, "soldAt")::date AS bucket,
      AVG("pricePerSqmSek")::bigint        AS mean_price_per_sqm,
      ${MEDIAN_PPS}                        AS median_price_per_sqm,
      COUNT(*)::bigint                     AS n
    FROM "DedupedListingMat"
    WHERE district = ${district}::"District"
      AND street    = ${street}
      ${houseFilter}
      ${roomFilter(rooms)}
      AND "pricePerSqmSek" > 0
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  return rows.map((r) => ({
    bucket: r.bucket.toISOString().slice(0, 10),
    meanPricePerSqm: Number(r.mean_price_per_sqm),
    medianPricePerSqm: Number(r.median_price_per_sqm),
    count: Number(r.n),
  }));
}

async function listStreetsUncached(
  district: DistrictSlug,
  limit = 200,
  rooms?: number[]
): Promise<StreetSummary[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      street: string;
      n: bigint;
      mean_pps: bigint;
      median_pps: bigint;
      latest: Date;
    }>
  >(Prisma.sql`
    SELECT street,
           COUNT(*)::bigint                AS n,
           AVG("pricePerSqmSek")::bigint   AS mean_pps,
           ${MEDIAN_PPS}                   AS median_pps,
           MAX("soldAt")                   AS latest
    FROM "DedupedListingMat"
    WHERE district = ${district}::"District"
      ${roomFilter(rooms)}
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
    medianPricePerSqm: Number(r.median_pps),
    latestSoldAt: r.latest.toISOString().slice(0, 10),
  }));
}

/** The house number without surrounding spaces, tabs or non-breaking spaces (btrim alone only strips ' '). */
const HN_TRIMMED = Prisma.sql`btrim("houseNumber", ' \t\u00a0')`;

/**
 * Natural order for house numbers: numeric prefix, then letter ("3" before
 * "3A"), then the end of a range ("10" before "10-12"). Unparseable values
 * ("Kv") sort last; ties fall back to the text. POSIX classes rather than
 * `\d`, because Prisma.sql reads the cooked template string.
 */
const HOUSE_NUMBER_ORDER = Prisma.sql`
  NULLIF(substring(${HN_TRIMMED} from '^[0-9]{1,9}'), '')::int ASC NULLS LAST,
  upper(substring(${HN_TRIMMED} from '^[0-9]+[[:space:]\u00a0]*([[:alpha:]])')) ASC NULLS FIRST,
  NULLIF(substring(${HN_TRIMMED} from '^[0-9]+[[:space:]\u00a0]*[[:alpha:]]?[[:space:]\u00a0]*[-–][[:space:]\u00a0]*([0-9]{1,9})'), '')::int ASC NULLS FIRST,
  "houseNumber" ASC`;

/** Houses with at least one priced sale; count, mean and median are over priced sales (as in listStreets). */
async function listHouseNumbersUncached(
  district: DistrictSlug,
  street: string,
  rooms?: number[]
): Promise<
  Array<{ houseNumber: string; count: number; meanPricePerSqm: number; medianPricePerSqm: number }>
> {
  const rows = await prisma.$queryRaw<
    Array<{ houseNumber: string; n: bigint; mean_pps: bigint; median_pps: bigint }>
  >(Prisma.sql`
    SELECT "houseNumber",
           COUNT(*)::bigint                AS n,
           AVG("pricePerSqmSek")::bigint   AS mean_pps,
           ${MEDIAN_PPS}                   AS median_pps
    FROM "DedupedListingMat"
    WHERE district = ${district}::"District"
      AND street    = ${street}
      AND "houseNumber" IS NOT NULL
      ${roomFilter(rooms)}
      AND "pricePerSqmSek" > 0
    GROUP BY "houseNumber"
    ORDER BY ${HOUSE_NUMBER_ORDER}
  `);

  return rows.map((r) => ({
    houseNumber: r.houseNumber,
    count: Number(r.n),
    meanPricePerSqm: Number(r.mean_pps),
    medianPricePerSqm: Number(r.median_pps),
  }));
}

async function recentSalesUncached(
  where: { district: DistrictSlug; street?: string; houseNumber?: string; rooms?: number[] },
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
    FROM "DedupedListingMat"
    WHERE ${Prisma.join(conds, " AND ")}
      ${roomFilter(where.rooms)}
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

/** A street needs at least this many sales in the recent window to be ranked... */
export const MIN_MOVER_RECENT_SALES = 5;
/** ...and at least this many in the prior window it is compared with. */
export const MIN_MOVER_PRIOR_SALES = 10;
/**
 * The "recent" window is `soldAt >= today - 90`, like `sinceDays=90` elsewhere:
 * today plus the 90 days before it, i.e. 91 calendar days.
 */
const MOVER_RECENT_DAYS = 90;
/**
 * The "prior" window is the 365 days right before the recent one:
 * `today - 455 <= soldAt < today - 90`. Disjoint from the recent window.
 */
const MOVER_PRIOR_DAYS = 365;

export type StreetMover = {
  street: string;
  slug: string;
  district: DistrictSlug;
  /**
   * Sales in the two windows together (recentCount + priorCount: today plus the 455
   * days before it, 456 calendar days). Before B26 this was the street's all-time count.
   */
  count: number;
  /**
   * Mean kr/m² over those same sales (both windows: today plus the 455 days before it). Before B26
   * this was the all-time mean.
   */
  meanPricePerSqm: number;
  /** Mean kr/m² in the recent window only (same meaning as before; the change itself is median-based). */
  windowMeanPricePerSqm: number;
  /** (recentMedian - priorMedian) / priorMedian in percent: medians, not means. */
  pctChange: number;
  /** Sales in the recent window (today and the 90 days before it). */
  recentCount: number;
  /** Sales in the prior window (the 365 days before the recent one). */
  priorCount: number;
  recentMedianPricePerSqm: number;
  priorMedianPricePerSqm: number;
};

/**
 * Streets whose median price/m² moved the most between two disjoint windows
 * ending today (Stockholm): the last 90 days, against the 12 months before
 * them. Streets need `MIN_MOVER_RECENT_SALES` sales in the recent and
 * `MIN_MOVER_PRIOR_SALES` in the prior window. Both windows' sizes are returned
 * so the UI can show how much data stands behind a percentage. `asOf` pins
 * "now" for tests.
 */
async function topMoversUncached(
  direction: "up" | "down",
  limit = 8,
  asOf: Date = new Date()
): Promise<StreetMover[]> {
  const op = direction === "up" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const today = stockholmToday(asOf);
  const recentFrom = Prisma.sql`(${today} - ${MOVER_RECENT_DAYS}::int)`;
  const priorFrom = Prisma.sql`(${today} - ${MOVER_RECENT_DAYS + MOVER_PRIOR_DAYS}::int)`;
  const isRecent = Prisma.sql`"soldAt" >= ${recentFrom}`;
  const isPrior = Prisma.sql`"soldAt" >= ${priorFrom} AND "soldAt" < ${recentFrom}`;
  const median = (cond: Prisma.Sql) =>
    Prisma.sql`ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY "pricePerSqmSek") FILTER (WHERE ${cond}))::numeric)::bigint`;

  const rows = await prisma.$queryRaw<
    Array<{
      district: DistrictSlug;
      street: string;
      n: bigint;
      mean_pps: bigint;
      recent_n: bigint;
      prior_n: bigint;
      recent_mean: bigint;
      recent_median: bigint;
      prior_median: bigint;
      pct: number;
    }>
  >(Prisma.sql`
    WITH agg AS (
      SELECT
        district,
        street,
        COUNT(*)::bigint                                                  AS n,
        AVG("pricePerSqmSek")::bigint                                     AS mean_pps,
        COUNT(*) FILTER (WHERE ${isRecent})::bigint                       AS recent_n,
        COUNT(*) FILTER (WHERE ${isPrior})::bigint                        AS prior_n,
        AVG("pricePerSqmSek") FILTER (WHERE ${isRecent})::bigint          AS recent_mean,
        ${median(isRecent)}                                               AS recent_median,
        ${median(isPrior)}                                                AS prior_median
      FROM "DedupedListingMat"
      WHERE "pricePerSqmSek" > 0
        AND "soldAt" >= ${priorFrom}
        AND "soldAt" <= ${today}
      GROUP BY district, street
    )
    SELECT district, street, n, mean_pps, recent_n, prior_n, recent_mean, recent_median, prior_median,
           ((recent_median - prior_median)::float8 / prior_median::float8) * 100 AS pct
    FROM agg
    WHERE recent_n >= ${MIN_MOVER_RECENT_SALES}
      AND prior_n  >= ${MIN_MOVER_PRIOR_SALES}
      AND prior_median > 0
    ORDER BY pct ${op}, district ASC, street ASC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    district: r.district,
    street: r.street,
    slug: slugifyStreet(r.street),
    count: Number(r.n),
    meanPricePerSqm: Number(r.mean_pps),
    windowMeanPricePerSqm: Number(r.recent_mean),
    pctChange: Number(r.pct),
    recentCount: Number(r.recent_n),
    priorCount: Number(r.prior_n),
    recentMedianPricePerSqm: Number(r.recent_median),
    priorMedianPricePerSqm: Number(r.prior_median),
  }));
}

/** Bucketed price/m² distribution across all districts. */
async function pricePerSqmDistributionUncached(
  bucketWidth = 20_000
): Promise<Array<{ bucket: number; count: number }>> {
  const rows = await prisma.$queryRaw<Array<{ bucket: number; n: bigint }>>(Prisma.sql`
    SELECT (FLOOR("pricePerSqmSek" / ${bucketWidth}::numeric)::int * ${bucketWidth}) AS bucket,
           COUNT(*)::bigint                                                          AS n
    FROM "DedupedListingMat"
    WHERE "pricePerSqmSek" > 0
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return rows.map((r) => ({ bucket: Number(r.bucket), count: Number(r.n) }));
}

/** Per-room-count breakdown: average price/m², average area, count. */
async function roomsBreakdownUncached(): Promise<
  Array<{
    rooms: number;
    count: number;
    meanPricePerSqm: number;
    medianPricePerSqm: number;
    meanAreaSqm: number;
    meanPriceSek: number;
  }>
> {
  const rows = await prisma.$queryRaw<
    Array<{
      rooms_floor: number;
      n: bigint;
      mean_pps: bigint;
      median_pps: bigint;
      mean_area: number | null;
      mean_price: bigint;
    }>
  >(Prisma.sql`
    SELECT FLOOR(rooms)::int        AS rooms_floor,
           COUNT(*)::bigint         AS n,
           AVG("pricePerSqmSek")::bigint  AS mean_pps,
           ${MEDIAN_PPS}                  AS median_pps,
           AVG("areaSqm")           AS mean_area,
           AVG("priceSek")::bigint  AS mean_price
    FROM "DedupedListingMat"
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
    medianPricePerSqm: Number(r.median_pps),
    meanAreaSqm: r.mean_area ? Number(r.mean_area) : 0,
    meanPriceSek: Number(r.mean_price),
  }));
}

/** Random-but-stable sample of (areaSqm, pricePerSqmSek, rooms) tuples for a scatter plot. */
async function priceAreaSampleUncached(limit = 600): Promise<
  Array<{ areaSqm: number; pricePerSqm: number; rooms: number | null; district: string }>
> {
  const rows = await prisma.$queryRaw<
    Array<{ areaSqm: number; pricePerSqm: number; rooms: number | null; district: string }>
  >(Prisma.sql`
    SELECT "areaSqm"::float8        AS "areaSqm",
           "pricePerSqmSek"::int    AS "pricePerSqm",
           rooms::float8            AS rooms,
           district::text           AS district
    FROM "DedupedListingMat"
    WHERE "areaSqm" IS NOT NULL AND "pricePerSqmSek" > 0
    ORDER BY ("id"::text)
    LIMIT ${limit}
  `);
  return rows;
}

/** Single-shot summary across the whole dataset. */
async function globalSummaryUncached(): Promise<{
  total: number;
  meanPricePerSqm: number | null;
  medianPricePerSqm: number | null;
  earliest: string | null;
  latest: string | null;
  byDistrict: Array<{
    district: string;
    count: number;
    meanPricePerSqm: number;
    medianPricePerSqm: number;
  }>;
}> {
  const [tot] = await prisma.$queryRaw<
    Array<{
      n: bigint;
      mean: bigint | null;
      median: bigint | null;
      earliest: Date | null;
      latest: Date | null;
    }>
  >(Prisma.sql`
    SELECT COUNT(*)::bigint AS n,
           AVG("pricePerSqmSek")::bigint AS mean,
           ${MEDIAN_PPS} AS median,
           MIN("soldAt") AS earliest,
           MAX("soldAt") AS latest
    FROM "DedupedListingMat"
    WHERE "pricePerSqmSek" > 0
  `);
  const byDistrict = await prisma.$queryRaw<
    Array<{ district: string; n: bigint; mean: bigint; median: bigint }>
  >(Prisma.sql`
    SELECT district::text AS district, COUNT(*)::bigint AS n,
           AVG("pricePerSqmSek")::bigint AS mean, ${MEDIAN_PPS} AS median
    FROM "DedupedListingMat"
    WHERE "pricePerSqmSek" > 0
    GROUP BY district
    ORDER BY n DESC
  `);
  return {
    total: Number(tot?.n ?? 0),
    meanPricePerSqm: tot?.mean != null ? Number(tot.mean) : null,
    medianPricePerSqm: tot?.median != null ? Number(tot.median) : null,
    earliest: tot?.earliest?.toISOString().slice(0, 10) ?? null,
    latest: tot?.latest?.toISOString().slice(0, 10) ?? null,
    byDistrict: byDistrict.map((r) => ({
      district: r.district,
      count: Number(r.n),
      meanPricePerSqm: Number(r.mean),
      medianPricePerSqm: Number(r.median),
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
           ${MEDIAN_PPS}                                                         AS median,
           MIN("soldAt")                                                         AS earliest,
           MAX("soldAt")                                                         AS latest
    FROM "DedupedListingMat"
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
async function streetSummaryUncached(
  district: DistrictSlug,
  street: string,
  rooms?: number[]
): Promise<SalesSummary> {
  const { summary } = await summarize(
    Prisma.sql`district = ${district}::"District" AND street = ${street} ${roomFilter(rooms)}`
  );
  return summary;
}

/** Summary of every sale at one address (street + house number, exact match). */
async function addressSummaryUncached(
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
async function districtStreetCountUncached(
  district: DistrictSlug,
  rooms?: number[]
): Promise<DistrictStreetCount> {
  const { streetCount, summary } = await summarize(
    Prisma.sql`district = ${district}::"District" ${roomFilter(rooms)}`
  );
  return { streetCount, ...summary };
}

export type DistrictSummary = SalesSummary;

/** Dedup-aware single-shot summary for one district. */
async function districtSummaryUncached(
  district: DistrictSlug,
  rooms?: number[]
): Promise<DistrictSummary> {
  const { summary } = await summarize(Prisma.sql`district = ${district}::"District" ${roomFilter(rooms)}`);
  return summary;
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
async function districtMomChangeUncached(
  district: DistrictSlug,
  asOf: Date = new Date(),
  rooms?: number[]
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
    FROM "DedupedListingMat" l, bounds b
    WHERE l.district = ${district}::"District"
      ${roomFilter(rooms)}
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

/**
 * Most points the map endpoint returns: the newest N sales matching the
 * filters; `truncated` says when older ones were cut. A deliberate cap, not a
 * safety net: 30,000 features are ~7 MB of JSON (about 1 MB gzipped) and the
 * most Mapbox GL handles comfortably as one GeoJSON source. The UI's default
 * period (12 months) stays well below it; "all time" over a big database is
 * what hits it, and the newest sales are the ones people look at.
 */
export const HEATMAP_LIMIT = 30_000;

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
  sources: string[];
};

/**
 * Geocoded, deduplicated sales matching `filters`, newest first, at most
 * `HEATMAP_LIMIT` of them (`truncated` is true when more matched).
 */
export async function heatmapPoints(
  filters: HeatmapFilters = {},
  asOf: Date = new Date()
): Promise<{ points: HeatmapPoint[]; truncated: boolean }> {
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

  // One extra row tells us whether the cap cut anything.
  const rows = await prisma.$queryRaw<HeatmapPoint[]>(Prisma.sql`
    SELECT lat, lng,
           "pricePerSqmSek"::int AS "pricePerSqm",
           street, "houseNumber", district::text AS district,
           "soldAt", sources
    FROM "DedupedListingMat"
    WHERE ${Prisma.join(conds, " AND ")}
    ORDER BY "soldAt" DESC, id
    LIMIT ${HEATMAP_LIMIT + 1}
  `);
  const truncated = rows.length > HEATMAP_LIMIT;
  return { points: truncated ? rows.slice(0, HEATMAP_LIMIT) : rows, truncated };
}

/** Every street with sales, busiest first (ties by name), across all districts. */
async function listAllStreetsUncached(limit = 4000): Promise<StreetsAllItem[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      district: DistrictSlug;
      street: string;
      n: bigint;
      mean_pps: bigint;
      median_pps: bigint;
    }>
  >(Prisma.sql`
    SELECT district::text AS district,
           street,
           COUNT(*)::bigint               AS n,
           AVG("pricePerSqmSek")::bigint  AS mean_pps,
           ${MEDIAN_PPS}                  AS median_pps
    FROM "DedupedListingMat"
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
    medianPricePerSqm: Number(r.median_pps),
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
      FROM "DedupedListingMat"
      WHERE district = ${district}::"District"
        AND street    = ${street}
        ${houseClause}
        AND "pricePerSqmSek" > 0
        ${sinceClause}
      ORDER BY "soldAt" DESC
      LIMIT 200
    `),
    prisma.$queryRaw<
      Array<{ bucket: Date; mean_price_per_sqm: bigint; median_price_per_sqm: bigint; n: bigint }>
    >(Prisma.sql`
      SELECT
        date_trunc(${range.bucket}, "soldAt")::date AS bucket,
        AVG("pricePerSqmSek")::bigint               AS mean_price_per_sqm,
        ${MEDIAN_PPS}                               AS median_price_per_sqm,
        COUNT(*)::bigint                            AS n
      FROM "DedupedListingMat"
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
      medianPricePerSqm: Number(r.median_price_per_sqm),
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

// Scraper freshness (B18). Written by the scraper into "ScrapeRun"; read by the UI.

export type LatestScrapeRun = {
  source: string;
  district: DistrictSlug;
  status: "ok" | "partial";
  /** ISO timestamps (UTC). */
  startedAt: string;
  finishedAt: string;
  pages: number;
  rowsUpserted: number;
  rowsRejected: number;
  /** Oldest sale date (YYYY-MM-DD) the run reached, if recorded. */
  oldestSoldAt: string | null;
};

/** For every (source, district): its most recently finished ok/partial run. */
async function latestScrapeRunsUncached(): Promise<LatestScrapeRun[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      source: string;
      district: DistrictSlug;
      status: "ok" | "partial";
      startedAt: Date;
      finishedAt: Date;
      pages: number;
      rowsUpserted: number;
      rowsRejected: number;
      oldestSoldAt: Date | null;
    }>
  >(Prisma.sql`
    SELECT DISTINCT ON (source, district)
           source, district::text AS district, status::text AS status,
           "startedAt", "finishedAt", pages, "rowsUpserted", "rowsRejected", "oldestSoldAt"
    FROM "ScrapeRun"
    WHERE status IN ('ok', 'partial') AND "finishedAt" IS NOT NULL
    ORDER BY source, district, "finishedAt" DESC, "startedAt" DESC
  `);
  return rows.map((r) => ({
    source: r.source,
    district: r.district,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt.toISOString(),
    pages: r.pages,
    rowsUpserted: r.rowsUpserted,
    rowsRejected: r.rowsRejected,
    oldestSoldAt: r.oldestSoldAt?.toISOString().slice(0, 10) ?? null,
  }));
}

export type SourceFreshness = {
  source: string;
  /** Finish time (ISO, UTC) of the source's latest ok/partial run; null if it has none. */
  lastSuccessAt: string | null;
  /** Raw (not deduplicated) rows from this source, and the sold-date range they cover. */
  listingCount: number;
  earliestSoldAt: string | null;
  latestSoldAt: string | null;
};

/** Per source: when it last scraped successfully and which sale dates it covers. */
async function sourceFreshnessUncached(): Promise<SourceFreshness[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      source: string;
      last_success: Date | null;
      n: bigint;
      earliest: Date | null;
      latest: Date | null;
    }>
  >(Prisma.sql`
    WITH runs AS (
      SELECT source, MAX("finishedAt") AS last_success
      FROM "ScrapeRun"
      WHERE status IN ('ok', 'partial') AND "finishedAt" IS NOT NULL
      GROUP BY source
    ), coverage AS (
      SELECT source, COUNT(*)::bigint AS n, MIN("soldAt") AS earliest, MAX("soldAt") AS latest
      FROM "Listing"
      GROUP BY source
    )
    SELECT COALESCE(c.source, r.source) AS source,
           r.last_success,
           COALESCE(c.n, 0)::bigint     AS n,
           c.earliest,
           c.latest
    FROM coverage c
    FULL OUTER JOIN runs r ON r.source = c.source
    ORDER BY 1
  `);
  return rows.map((r) => ({
    source: r.source,
    lastSuccessAt: r.last_success?.toISOString() ?? null,
    listingCount: Number(r.n),
    earliestSoldAt: r.earliest?.toISOString().slice(0, 10) ?? null,
    latestSoldAt: r.latest?.toISOString().slice(0, 10) ?? null,
  }));
}

export type DedupKeyClusterViolation = {
  dedupKey: string;
  /** The distinct non-null clusterIds found on rows with this dedupKey, sorted. */
  clusterIds: string[];
  /** Rows with this dedupKey that have no clusterId while another row has one. */
  unclusteredRows: number;
};

/**
 * Check of the clustering contract (see `clusterId` in schema.prisma): every
 * row sharing a dedupKey must carry the same clusterId. Returns the dedupKeys
 * that break it, either because their rows are spread over several clusters
 * (the matcher must merge them) or because some copies arrived after the
 * matcher ran and have none yet (it must stamp them). Empty = healthy. Reads
 * "Listing" directly, not the snapshot, so it sees rows not yet refreshed.
 */
export async function dedupKeysInMultipleClusters(
  limit = 1000
): Promise<DedupKeyClusterViolation[]> {
  const rows = await prisma.$queryRaw<
    Array<{ dedup_key: string; cluster_ids: string[]; unclustered: bigint }>
  >(Prisma.sql`
    SELECT "dedupKey"                                               AS dedup_key,
           array_agg(DISTINCT "clusterId" ORDER BY "clusterId")
             FILTER (WHERE "clusterId" IS NOT NULL)                 AS cluster_ids,
           COUNT(*) FILTER (WHERE "clusterId" IS NULL)::bigint      AS unclustered
    FROM "Listing"
    WHERE "dedupKey" IS NOT NULL
    GROUP BY "dedupKey"
    HAVING COUNT(DISTINCT "clusterId") > 1
        OR (COUNT("clusterId") > 0 AND COUNT(*) FILTER (WHERE "clusterId" IS NULL) > 0)
    ORDER BY "dedupKey"
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    dedupKey: r.dedup_key,
    clusterIds: r.cluster_ids,
    unclusteredRows: Number(r.unclustered),
  }));
}

// Cached entry points (lib/cache.ts). The JSDoc of each function sits on its
// `...Uncached` implementation above. Left uncached on purpose: heatmapPoints
// and addressDrawerData (large or user-keyed, covered by HTTP caching),
// dedupKeysInMultipleClusters (a diagnostic that must see live data).
export const streetFromSlug = cached("streetFromSlug", streetFromSlugUncached);
export const districtTimeseries = cached("districtTimeseries", districtTimeseriesUncached);
export const streetTimeseries = cached("streetTimeseries", streetTimeseriesUncached);
export const listStreets = cached("listStreets", listStreetsUncached);
export const listHouseNumbers = cached("listHouseNumbers", listHouseNumbersUncached);
export const recentSales = cached("recentSales", recentSalesUncached);
export const topMovers = cached("topMovers", topMoversUncached);
export const pricePerSqmDistribution = cached("pricePerSqmDistribution", pricePerSqmDistributionUncached);
export const roomsBreakdown = cached("roomsBreakdown", roomsBreakdownUncached);
export const priceAreaSample = cached("priceAreaSample", priceAreaSampleUncached);
export const globalSummary = cached("globalSummary", globalSummaryUncached);
export const streetSummary = cached("streetSummary", streetSummaryUncached);
export const addressSummary = cached("addressSummary", addressSummaryUncached);
export const districtStreetCount = cached("districtStreetCount", districtStreetCountUncached);
export const districtSummary = cached("districtSummary", districtSummaryUncached);
export const districtMomChange = cached("districtMomChange", districtMomChangeUncached);
export const listAllStreets = cached("listAllStreets", listAllStreetsUncached);
// Freshness is what readers look at to judge staleness: keep it short-lived.
export const latestScrapeRuns = cached("latestScrapeRuns", latestScrapeRunsUncached, { revalidate: 300 });
export const sourceFreshness = cached("sourceFreshness", sourceFreshnessUncached, { revalidate: 300 });
