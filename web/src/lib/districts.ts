// Okabe–Ito categorical hues (https://jfly.uni-koeln.de/color/), each ≥3:1 on white.
export const DISTRICTS = [
  { slug: "ostermalm", displayName: "Östermalm", color: "#0072b2" },
  { slug: "vasastan", displayName: "Vasastan", color: "#d55e00" },
  { slug: "norrmalm", displayName: "Norrmalm", color: "#009e73" },
  { slug: "sodermalm", displayName: "Södermalm", color: "#cc79a7" },
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

/** District identity is independent of chart order or selection. */
export function districtColor(slug: DistrictSlug): string {
  return DISTRICTS.find((district) => district.slug === slug)!.color;
}
