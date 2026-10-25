import { DISTRICTS, districtColor, isDistrictSlug } from "@/lib/districts";

/** Categorical identity lives with districts; every chart shares these rendering tokens. */
export const CHART_THEME = {
  primary: DISTRICTS[0].color,
  address: "#111827",
  reference: "#666666",
  axis: "#52525b",
  grid: "#e4e4e7",
  surface: "#ffffff",
  cursor: "#a1a1aa",
} as const;

// Prefer separate street tones, then use district tones that are absent from the comparison.
const STREET_COLORS = [CHART_THEME.address, CHART_THEME.reference, "#6f3c9f", "#6b5900"] as const;
export const CHART_COLORS = [...DISTRICTS.map((district) => district.color), ...STREET_COLORS];

/** Reserve selected district identities before assigning streets every remaining tone. */
export function comparisonColors(ids: readonly string[]): string[] {
  const streetColors = [...STREET_COLORS, ...DISTRICTS
    .filter((district) => !ids.includes(`district:${district.slug}`))
    .map((district) => district.color)];
  let streetIndex = 0;
  return ids.map((id) => {
    const slug = id.startsWith("district:") ? id.slice(9) : "";
    return isDistrictSlug(slug) ? districtColor(slug) : streetColors[streetIndex++ % streetColors.length];
  });
}
