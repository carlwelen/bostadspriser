import { expect, it } from "vitest";
import { DISTRICTS, districtColor } from "@/lib/districts";
import { CHART_COLORS, CHART_THEME, comparisonColor } from "./chartColors";

function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

it("uses unique district colours with graphical-object contrast on white", () => {
  expect(new Set(DISTRICTS.map((district) => district.color)).size).toBe(4);
  for (const color of CHART_COLORS) expect(1.05 / (luminance(color) + 0.05)).toBeGreaterThanOrEqual(3);
  expect(CHART_THEME.surface).toBe("#ffffff");
});

it("keeps district identity for every comparison order and reserves separate street tones", () => {
  for (const district of DISTRICTS) {
    for (let index = 0; index < 12; index++) expect(comparisonColor(`district:${district.slug}`, index)).toBe(districtColor(district.slug));
    expect(CHART_COLORS).toContain(districtColor(district.slug));
  }
  const districts = DISTRICTS.map((district) => district.color);
  for (let index = 0; index < 8; index++) expect(districts).not.toContain(comparisonColor("street:sodermalm/gotgatan", index));
});
