import { expect, it } from "vitest";
import { DISTRICTS, districtColor } from "@/lib/districts";
import { CHART_COLORS, CHART_THEME, comparisonColors } from "./chartColors";

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

it("keeps district identity for every comparison order and prefers separate street tones", () => {
  for (const district of DISTRICTS) {
    for (let index = 0; index < 12; index++) {
      const ids = [...Array(index).fill("street:sodermalm/gotgatan"), `district:${district.slug}`];
      expect(comparisonColors(ids)[index]).toBe(districtColor(district.slug));
    }
    expect(CHART_COLORS).toContain(districtColor(district.slug));
  }
  const districts = DISTRICTS.map((district) => district.color);
  for (const color of comparisonColors(Array(4).fill("street:sodermalm/gotgatan"))) expect(districts).not.toContain(color);
});

it("allocates street tones by street ordinal regardless of interleaved districts", () => {
  const streets = ["street:ostermalm/karlavagen", "street:vasastan/odengatan", "street:norrmalm/drottninggatan", "street:sodermalm/gotgatan"];
  const expected = comparisonColors(streets);
  expect(new Set(expected).size).toBe(streets.length);
  for (let mask = 0; mask < 256; mask++) {
    if (mask.toString(2).replaceAll("0", "").length !== 4) continue;
    let street = 0;
    let district = 0;
    const ids = Array.from({ length: 8 }, (_, index) => mask & (1 << index)
      ? streets[street++] : `district:${DISTRICTS[district++].slug}`);
    const colors = comparisonColors(ids);
    expect(new Set(colors).size).toBe(ids.length);
    expect(colors.filter((_, index) => ids[index].startsWith("street:"))).toEqual(expected);
  }
});

it("preserves all eight available tones for street-only comparisons before cycling", () => {
  const streets = Array.from({ length: 9 }, (_, i) => `street:ostermalm/street-${i}`);
  const colors = comparisonColors(streets);
  expect(new Set(colors.slice(0, 5)).size).toBe(5);
  expect(new Set(colors.slice(0, 8)).size).toBe(8);
  expect(colors[8]).toBe(colors[0]);
});

it("reserves every selected district tone before allocating the remaining palette to streets", () => {
  for (let mask = 0; mask < 16; mask++) {
    const districts = DISTRICTS.filter((_, index) => mask & (1 << index));
    const streets = Array.from({ length: 8 - districts.length }, (_, i) => `street:ostermalm/street-${i}`);
    // Put districts last so a street cannot claim a tone needed by a later district.
    const ids = [...streets, ...districts.map((district) => `district:${district.slug}`)];
    const colors = comparisonColors(ids);
    expect(new Set(colors).size).toBe(8);
    expect(colors.slice(streets.length)).toEqual(districts.map((district) => district.color));
    expect(comparisonColors([...ids, "street:ostermalm/extra"]).at(-1)).toBe(colors[0]);
  }
});
