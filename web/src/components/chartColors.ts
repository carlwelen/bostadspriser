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

// Street comparisons use separate tones so a street cannot take a district's identity.
const STREET_COLORS = [CHART_THEME.address, CHART_THEME.reference, "#6f3c9f", "#6b5900"] as const;
export const CHART_COLORS = [...DISTRICTS.map((district) => district.color), ...STREET_COLORS];

export function comparisonColor(id: string, index: number): string {
  const slug = id.startsWith("district:") ? id.slice(9) : "";
  return isDistrictSlug(slug) ? districtColor(slug) : STREET_COLORS[index % STREET_COLORS.length];
}
