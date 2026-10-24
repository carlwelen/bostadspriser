import { DISTRICTS, isDistrictSlug, type DistrictSlug } from "@/lib/districts";
import { granularityHref } from "./granularity";
import type { Granularity } from "@/lib/aggregations";

export type ComparisonOption = { id: string; name: string; color: string };
export type ComparisonSpec =
  | { kind: "district"; slug: DistrictSlug }
  | { kind: "street"; district: DistrictSlug; streetSlug: string };

export function parseComparisonSpec(raw: string): ComparisonSpec | null {
  if (raw.startsWith("district:")) {
    const slug = raw.slice(9);
    return isDistrictSlug(slug) ? { kind: "district", slug } : null;
  }
  const match = /^street:([^/]+)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(raw);
  return match && isDistrictSlug(match[1])
    ? { kind: "street", district: match[1], streetSlug: match[2] }
    : null;
}

export function comparisonIds(value: string | string[] | undefined): string[] {
  const raw = value === undefined ? DISTRICTS.map((d) => `district:${d.slug}`)
    : (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(","));
  return [...new Set(raw)].filter((id) => parseComparisonSpec(id) !== null);
}

/** An explicit empty series value keeps removing the final chip from restoring defaults. */
export function comparisonHref(ids: string[], granularity: Granularity): string {
  return granularityHref("/compare", { series: [...new Set(ids)].join(",") }, granularity);
}
