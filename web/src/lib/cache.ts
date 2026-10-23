import { randomUUID } from "node:crypto";
import { unstable_cache } from "next/cache";

// Tag-based caching of the aggregation functions (B24, notes in docs/perf.md).
//
// The pages render per request, but the data changes a few times a day at
// most. Wrapping the aggregations (rather than the pages) caches their results
// in Next's data cache, so no page file needs to change.
//
//   - Every entry carries CACHE_TAG ("listings") and "agg:<function name>".
//   - POST /api/revalidate (secret-protected; the scraper calls it after
//     refresh_deduped_listing()) drops entries by tag.
//   - Entries also expire after DEFAULT_REVALIDATE_SECONDS, as a safety net
//     when nobody calls the route.
//   - The cache is only active in production builds (`AGG_CACHE=on|off`
//     overrides, mainly for tests). In `next dev` and in vitest every call goes
//     to the database.
//   - Keys contain a per-process id, so a restart never serves entries written
//     by an earlier process. That is what keeps the e2e suite honest: its
//     server is started fresh, seeded before the first data request, and Next's
//     on-disk cache from earlier runs is never read.
//
// Results must survive JSON (Next stores them serialised): numbers, strings,
// booleans, null, arrays and plain objects. No Date, bigint, Decimal or
// undefined. Functions that return those, or whose results are huge or keyed by
// free-form user input (the heatmap, the address drawer), are left uncached and
// rely on HTTP caching instead.

export const CACHE_TAG = "listings";
export const DEFAULT_REVALIDATE_SECONDS = 3600;

export function cacheEnabled(): boolean {
  const flag = process.env.AGG_CACHE;
  if (flag === "on") return true;
  if (flag === "off") return false;
  return process.env.NODE_ENV === "production";
}

// On globalThis because Next bundles a module once per entry point: all copies
// must agree on the id.
function processId(): string {
  const g = globalThis as { __aggCacheProcessId?: string };
  return (g.__aggCacheProcessId ??= randomUUID());
}

/** Wrap an async query so its results are cached (when caching is enabled). */
export function cached<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
  opts: { revalidate?: number } = {}
): (...args: A) => Promise<R> {
  let wrapped: ((...args: A) => Promise<R>) | undefined;
  return (...args: A) => {
    if (!cacheEnabled()) return fn(...args);
    wrapped ??= unstable_cache(fn, ["agg", processId(), name], {
      tags: [CACHE_TAG, `agg:${name}`],
      revalidate: opts.revalidate ?? DEFAULT_REVALIDATE_SECONDS,
    });
    return wrapped(...args);
  };
}
