import Link from "next/link";
import type { Granularity } from "@/lib/aggregations";
import { granularityHref } from "./granularity";

const OPTIONS: Array<{ value: Granularity; label: string }> = [
  { value: "month", label: "Månad" },
  { value: "year", label: "År" },
];

/**
 * Segmented Månad/År control for a time-series chart. The state lives in the
 * URL (`?g=year`), so it works without client JS and can be shared; the page
 * re-fetches the series with the chosen granularity on the server.
 */
export function GranularityToggle({
  granularity,
  path,
  params = {},
}: {
  granularity: Granularity;
  /** Path of the current page, without query. */
  path: string;
  /** The page's other query parameters, kept when switching. */
  params?: Record<string, string | string[] | undefined>;
}) {
  return (
    <div
      role="group"
      aria-label="Tidsupplösning"
      className="inline-flex shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-white text-xs"
    >
      {OPTIONS.map((o) => {
        const active = o.value === granularity;
        return (
          <Link
            key={o.value}
            href={granularityHref(path, params, o.value)}
            replace
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={
              "px-3 py-1.5 font-medium transition-colors " +
              (active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50")
            }
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
