export const DISTRICTS = [
  { slug: "ostermalm", displayName: "Östermalm" },
  { slug: "vasastan", displayName: "Vasastan" },
  { slug: "norrmalm", displayName: "Norrmalm" },
  { slug: "sodermalm", displayName: "Södermalm" },
] as const;

export type DistrictSlug = (typeof DISTRICTS)[number]["slug"];

const SLUG_TO_NAME: Record<DistrictSlug, string> = Object.fromEntries(
  DISTRICTS.map((d) => [d.slug, d.displayName])
) as Record<DistrictSlug, string>;

// A Set, not `in`: `"toString" in obj` is true for inherited keys.
const SLUGS: ReadonlySet<string> = new Set(DISTRICTS.map((d) => d.slug));

export function isDistrictSlug(value: string): value is DistrictSlug {
  return SLUGS.has(value);
}

export function districtName(slug: DistrictSlug): string {
  return SLUG_TO_NAME[slug];
}
