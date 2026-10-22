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

export function isDistrictSlug(value: string): value is DistrictSlug {
  return value in SLUG_TO_NAME;
}

export function districtName(slug: DistrictSlug): string {
  return SLUG_TO_NAME[slug];
}
