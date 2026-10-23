import { unstable_cache } from "next/cache";

// Tag-based caching of the aggregation functions (B24, notes in docs/perf.md).
//
// The pages render per request, but the data changes a few times a day at
// most. Wrapping the aggregations (rather than the pages) caches their results
// in Next's data cache, so no page file needs to change.
//
//   - Every entry carries CACHE_TAG ("listings") and "agg:<function name>".
//   - POST /api/revalidate (secret-protected; the scraper should call it after
//     refresh_deduped_listing(), backlog B49) drops entries by tag.
//   - Entries also expire after DEFAULT_REVALIDATE_SECONDS, as a safety net
//     when nobody calls the route.
//   - The cache is only active in production builds (`AGG_CACHE=on|off`
//     overrides, mainly for tests). In `next dev` and in vitest every call goes
//     to the database.
//   - The data cache lives in memory only (`experimental.isrFlushToDisk: false`
//     in next.config.ts): bounded by Next's LRU (`cacheMaxMemorySize`, 50 MB)
//     and gone on restart. Anything on disk would grow without bound, because
//     some cached functions are keyed by URL input (street names), and would
//     survive restarts.
//
// Results must survive JSON (Next stores them serialised): numbers, strings,
// booleans, null, arrays and plain objects. No Date, bigint, Decimal or
// undefined (tests/integration/cache.test.ts checks every cached function).
// Functions that return those, or whose results are huge or keyed by
// free-form user input (the heatmap, the address drawer), are left uncached and
// rely on HTTP caching instead.

export const CACHE_TAG = "listings";
export const DEFAULT_REVALIDATE_SECONDS = 3600;

const registry = new Set<string>();

/** Names of every function passed to `cached()`; `agg:<name>` is a valid tag for each. */
export function registeredCacheNames(): string[] {
  return [...registry];
}

/** Tags a caller of /api/revalidate may use: the global one and one per cached function. */
export function knownCacheTags(): string[] {
  return [CACHE_TAG, ...registeredCacheNames().map((n) => `agg:${n}`)];
}

export function cacheEnabled(): boolean {
  const flag = process.env.AGG_CACHE;
  if (flag === "on") return true;
  if (flag === "off") return false;
  return process.env.NODE_ENV === "production";
}

/**
 * A Date that is not midnight UTC makes a new cache key on every call
 * (`asOf = new Date()`), so such results would never be reused.
 */
function hasVolatileDate(args: unknown[]): boolean {
  return args.some(
    (a) =>
      a instanceof Date &&
      (a.getUTCHours() !== 0 ||
        a.getUTCMinutes() !== 0 ||
        a.getUTCSeconds() !== 0 ||
        a.getUTCMilliseconds() !== 0)
  );
}

/**
 * Wrap an async query so its results are cached (when caching is enabled).
 *
 * Calls with a non-midnight Date argument are not cacheable: they throw outside
 * production (so the mistake shows up in tests) and run uncached, with one
 * warning, in production. Calls that omit the Date and let the function default
 * to "now" are fine; see docs/perf.md for the staleness that implies.
 */
export function cached<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
  opts: { revalidate?: number } = {}
): (...args: A) => Promise<R> {
  registry.add(name);
  let wrapped: ((...args: A) => Promise<R>) | undefined;
  let warned = false;
  return (...args) => {
    if (!cacheEnabled()) return fn(...args);
    if (hasVolatileDate(args)) {
      if (process.env.NODE_ENV !== "production") {
        return Promise.reject(
          new TypeError(
            `${name}: a Date argument other than midnight UTC makes a cache entry per call; ` +
              "pass a day-aligned Date or omit it"
          )
        );
      }
      if (!warned) {
        warned = true;
        console.warn(`[cache] ${name} called with a volatile Date argument; running uncached`);
      }
      return fn(...args);
    }
    wrapped ??= unstable_cache(fn, ["agg", name], {
      tags: [CACHE_TAG, `agg:${name}`],
      revalidate: opts.revalidate ?? DEFAULT_REVALIDATE_SECONDS,
    });
    return wrapped(...args);
  };
}
