import type { Granularity } from "@/lib/aggregations";

type SearchParams = Record<string, string | string[] | undefined>;

/** Reads `?g=`: "year" or "month"; anything else (or missing) is the default, month. */
export function parseGranularity(value: string | string[] | undefined): Granularity {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "year" ? "year" : "month";
}

/** Caption for the chart's buckets: the plotted value is the median per bucket. */
export function granularityCaption(granularity: Granularity): string {
  return granularity === "year" ? "Median kr/m² per år" : "Median kr/m² per månad";
}

/**
 * The URL of `path` with the other query parameters kept and `g` set to
 * `granularity`. Month is the default and is left out of the URL.
 */
export function granularityHref(
  path: string,
  params: SearchParams,
  granularity: Granularity
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "g" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  if (granularity === "year") query.append("g", "year");
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}
