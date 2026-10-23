import { NextResponse } from "next/server";
import { z } from "zod";
import { DISTRICTS, type DistrictSlug } from "./districts";
import { PERIODS, type ApiErrorBody, type ApiIssue } from "./api-types";

// Query-string validation and error handling shared by every /api route.
//
// Rules:
//   - A parameter that is absent or empty (`?rooms=`) counts as not given.
//   - Anything else must parse strictly: integers are plain digits (no `1e2`,
//     no `1.5`, no whitespace), so `Number("")` / `Number("abc")` quirks never
//     reach SQL.
//   - Unknown districts in a list are a 400, not silently dropped.
//   - Unknown query parameters are ignored (cache-busters like `?_=123` work).
//   - Bad input -> 400 `{ error, issues }`. Unexpected failures -> 500
//     `{ error: "internal error" }`, with the cause logged server-side only.
//   - Error responses are `no-store`.

export const PUBLIC_CACHE = "public, max-age=60, stale-while-revalidate=300";

/** Bounds, in one place so docs and tests can refer to them. */
export const LIMITS = {
  /** /api/streets `limit`. */
  streets: { min: 1, max: 1000, default: 200 },
  /** /api/streets/all `limit`. */
  streetsAll: { min: 1, max: 4000, default: 4000 },
  /** /api/heatmap `sinceDays`: one day to ten years. */
  sinceDays: { min: 1, max: 3650 },
  /** /api/heatmap `priceMin`/`priceMax`, kr per m². Far above any real price. */
  pricePerSqm: { min: 0, max: 10_000_000 },
  /** /api/heatmap `rooms`. The value `open` is the UI's "5+" chip: 5 or more rooms. */
  rooms: { min: 1, max: 15, open: 5 },
  /** Street and house strings, in characters. */
  street: { max: 200 },
  house: { max: 50 },
} as const;

const DISTRICT_SLUGS = DISTRICTS.map((d) => d.slug) as [DistrictSlug, ...DistrictSlug[]];

/** No ASCII control characters: NUL in particular makes Postgres reject the bind parameter. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const districtSchema = z.enum(DISTRICT_SLUGS, "unknown district");

function intSchema(min: number, max: number) {
  return z
    .string()
    .regex(/^-?\d+$/, "must be an integer")
    .transform(Number)
    .pipe(
      z
        .number()
        .min(min, `must be between ${min} and ${max}`)
        .max(max, `must be between ${min} and ${max}`)
    );
}

const decimalSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a number")
  .transform(Number);

/**
 * Comma-separated list; each item is validated by `item`. With `dropEmpty`,
 * empty items (`a,,b`, trailing comma) are skipped instead of being invalid.
 */
function listSchema<T extends z.ZodType<unknown, string>>(
  item: T,
  maxItems: number,
  dropEmpty = false
) {
  return z
    .string()
    .transform((s) => (dropEmpty ? s.split(",").filter((x) => x !== "") : s.split(",")))
    .pipe(z.array(item).max(maxItems, `at most ${maxItems} values`));
}

function textSchema(max: number) {
  return z
    .string()
    .min(1, "must not be empty")
    .max(max, `must be at most ${max} characters`)
    .refine((s) => !CONTROL_CHARS.test(s), "must not contain control characters");
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

// /api/heatmap

const bboxSchema = listSchema(decimalSchema, 4)
  .refine((p) => p.length === 4, "must be west,south,east,north")
  .refine(
    ([w, s, e, n]) => w >= -180 && e <= 180 && s >= -90 && n <= 90,
    "longitude must be within -180..180 and latitude within -90..90"
  )
  // `<=`: a zero-width box is a valid (if tiny) BETWEEN range.
  .refine(([w, s, e, n]) => w <= e && s <= n, "west must be <= east and south must be <= north")
  .transform((p) => p as [number, number, number, number]);

export const heatmapQuery = z
  .object({
    // An empty list (`districts=,`) means "all districts", like an absent one.
    districts: listSchema(districtSchema, 20, true).transform(uniq).optional(),
    /** west,south,east,north in degrees. Boxes crossing the antimeridian are not supported. */
    bbox: bboxSchema.optional(),
    // 0 means "no bound" (the map UI sends nothing, older clients sent 0), so it
    // is normalised to undefined rather than filtering on `<= 0`.
    priceMin: intSchema(LIMITS.pricePerSqm.min, LIMITS.pricePerSqm.max)
      .transform((v) => (v === 0 ? undefined : v))
      .optional(),
    priceMax: intSchema(LIMITS.pricePerSqm.min, LIMITS.pricePerSqm.max)
      .transform((v) => (v === 0 ? undefined : v))
      .optional(),
    rooms: listSchema(intSchema(LIMITS.rooms.min, LIMITS.rooms.max), LIMITS.rooms.max, true)
      .transform((xs) => uniq(xs).sort((a, b) => a - b))
      .optional(),
    sinceDays: intSchema(LIMITS.sinceDays.min, LIMITS.sinceDays.max).optional(),
  })
  .refine((q) => q.priceMin === undefined || q.priceMax === undefined || q.priceMin <= q.priceMax, {
    path: ["priceMin"],
    message: "must be <= priceMax",
  });
export type HeatmapQuery = z.output<typeof heatmapQuery>;

// /api/timeseries

const timeseriesBase = z.object({
  scope: z.enum(["district", "street"], "must be district or street").default("district"),
  id: textSchema(LIMITS.street.max + LIMITS.house.max + 20),
  granularity: z.enum(["month", "year"], "must be month or year").default("month"),
});

export type TimeseriesQuery =
  | { scope: "district"; district: DistrictSlug; granularity: "month" | "year" }
  | {
      scope: "street";
      district: DistrictSlug;
      street: string;
      houseNumber?: string;
      granularity: "month" | "year";
    };

function decodeSegment(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export const timeseriesQuery = timeseriesBase.transform((q, ctx): TimeseriesQuery => {
  const fail = (message: string) => {
    ctx.issues.push({ code: "custom", message, input: q.id, path: ["id"] });
    return z.NEVER;
  };

  if (q.scope === "district") {
    const district = districtSchema.safeParse(q.id);
    if (!district.success) return fail("unknown district");
    return { scope: "district", district: district.data, granularity: q.granularity };
  }

  // id format: <district>/<street>[/<houseNumber>]. Segments may be
  // percent-encoded on top of the query-string encoding.
  const parts = q.id.split("/");
  if (parts.length < 2 || parts.length > 3) return fail("must be <district>/<street>[/<house>]");
  const district = districtSchema.safeParse(parts[0]);
  if (!district.success) return fail("unknown district");
  const decoded = parts.slice(1).map(decodeSegment);
  if (decoded.some((s) => s === null)) return fail("malformed percent-encoding");
  const [street, houseNumber] = decoded as [string, string | undefined];
  const checkedStreet = textSchema(LIMITS.street.max).safeParse(street);
  if (!checkedStreet.success) return fail(`street ${checkedStreet.error.issues[0].message}`);
  if (houseNumber !== undefined) {
    const checkedHouse = textSchema(LIMITS.house.max).safeParse(houseNumber);
    if (!checkedHouse.success) return fail(`house ${checkedHouse.error.issues[0].message}`);
  }
  return {
    scope: "street",
    district: district.data,
    street,
    houseNumber,
    granularity: q.granularity,
  };
});

// /api/streets, /api/streets/all

export const streetsQuery = z.object({
  district: districtSchema,
  limit: intSchema(LIMITS.streets.min, LIMITS.streets.max).default(LIMITS.streets.default),
});
export type StreetsQuery = z.output<typeof streetsQuery>;

export const streetsAllQuery = z.object({
  limit: intSchema(LIMITS.streetsAll.min, LIMITS.streetsAll.max).default(
    LIMITS.streetsAll.default
  ),
});
export type StreetsAllQuery = z.output<typeof streetsAllQuery>;

// /api/address

export const addressQuery = z.object({
  district: districtSchema,
  street: textSchema(LIMITS.street.max),
  house: textSchema(LIMITS.house.max).optional(),
  period: z.enum(PERIODS, `must be one of ${PERIODS.join(", ")}`).default("12mo"),
});
export type AddressQuery = z.output<typeof addressQuery>;

// Helpers used by the route handlers

function issuePath(path: ReadonlyArray<PropertyKey>): string {
  return path.map(String).join(".");
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/** Validate query parameters against `schema`; on failure return the 400 response to send. */
export function parseQuery<S extends z.ZodType>(
  schema: S,
  searchParams: URLSearchParams
): ParseResult<z.output<S>> {
  // Own-property record: a `?__proto__=x` key must not touch Object.prototype.
  const raw: Record<string, string> = Object.create(null);
  for (const [key, value] of searchParams) {
    if (value !== "" && !(key in raw)) raw[key] = value;
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues: ApiIssue[] = parsed.error.issues.map((i) => ({
    path: issuePath(i.path),
    message: i.message,
  }));
  return { ok: false, response: errorResponse(400, "invalid query parameters", issues) };
}

export function errorResponse(status: number, error: string, issues?: ApiIssue[]) {
  const body: ApiErrorBody = issues ? { error, issues } : { error };
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Wrap a route handler so an unexpected throw (DB down, bad SQL, ...) becomes
 * a JSON 500. The cause is logged; the client never sees it.
 */
export function withApiErrors<Args extends unknown[]>(
  route: string,
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error(`[api] ${route} failed`, err);
      return errorResponse(500, "internal error");
    }
  };
}
