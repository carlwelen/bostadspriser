import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRICE_BREAKS,
  PRICE_COLORS,
  computePriceBreaks,
  formatBreakLabels,
  priceColorExpression,
} from "./priceRamp";

const strictlyIncreasing = (b: number[]) => b.every((v, i) => i === 0 || v > b[i - 1]);

describe("computePriceBreaks", () => {
  it("uses the 5/25/50/75/95 percentiles, rounded to 1 000 kr", () => {
    const values = Array.from({ length: 100 }, (_, i) => (i + 1) * 1000);
    expect(computePriceBreaks(values)).toEqual([6000, 26000, 51000, 75000, 95000]);
  });

  it("does not depend on input order", () => {
    const values = Array.from({ length: 100 }, (_, i) => (i + 1) * 1000);
    expect(computePriceBreaks([...values].reverse())).toEqual(computePriceBreaks(values));
  });

  it("falls back to the default breaks without usable data", () => {
    expect(computePriceBreaks([])).toEqual(DEFAULT_PRICE_BREAKS);
    expect(computePriceBreaks([NaN, -5, 0, Infinity, -Infinity])).toEqual(DEFAULT_PRICE_BREAKS);
  });

  it("ignores non-finite and non-positive values among good ones", () => {
    const good = Array.from({ length: 50 }, (_, i) => 100_000 + i * 1000);
    expect(computePriceBreaks([...good, NaN, 0, -1, Infinity])).toEqual(computePriceBreaks(good));
  });

  it("spreads identical values around that value instead of collapsing the ramp", () => {
    const expected = [120_000, 135_000, 150_000, 165_000, 180_000];
    expect(computePriceBreaks(Array(10).fill(150_000))).toEqual(expected);
    expect(computePriceBreaks([150_000])).toEqual(expected);
  });

  it("handles very few points", () => {
    const two = computePriceBreaks([100_000, 200_000]);
    expect(two).toHaveLength(5);
    expect(strictlyIncreasing(two)).toBe(true);
    expect(two[0]).toBeGreaterThanOrEqual(100_000);
    expect(two[4]).toBeLessThanOrEqual(200_000);
    const three = computePriceBreaks([90_000, 120_000, 160_000]);
    expect(strictlyIncreasing(three)).toBe(true);
  });

  it("keeps outliers from stretching the ramp", () => {
    const values = [...Array.from({ length: 99 }, (_, i) => 100_000 + i * 1000), 5_000_000, 1];
    const b = computePriceBreaks(values);
    expect(b[4]).toBeLessThan(250_000);
    expect(b[0]).toBeGreaterThan(90_000);
  });

  it("stays strictly increasing (Mapbox needs ascending stops) with heavy ties and tiny spreads", () => {
    const cases = [
      [...Array(9).fill(100_000), 200_000],
      [100_000, 100_400],
      [...Array(50).fill(100_000), ...Array(50).fill(100_300)],
      [99_999.6, 100_000.4],
    ];
    for (const c of cases) {
      const b = computePriceBreaks(c);
      expect(b).toHaveLength(5);
      expect(strictlyIncreasing(b)).toBe(true);
    }
  });
});

describe("priceColorExpression", () => {
  it("interpolates pricePerSqm over the breaks and colours in order", () => {
    const breaks = [60_000, 90_000, 120_000, 150_000, 180_000];
    expect(priceColorExpression(breaks)).toEqual([
      "interpolate",
      ["linear"],
      ["get", "pricePerSqm"],
      60_000, PRICE_COLORS[0],
      90_000, PRICE_COLORS[1],
      120_000, PRICE_COLORS[2],
      150_000, PRICE_COLORS[3],
      180_000, PRICE_COLORS[4],
    ]);
  });
});

describe("formatBreakLabels", () => {
  it("formats thousands and marks the top break open-ended", () => {
    expect(formatBreakLabels([80_000, 120_000, 150_000, 180_000, 220_000])).toEqual([
      "80k",
      "120k",
      "150k",
      "180k",
      "220k+",
    ]);
  });

  it("matches the default breaks the legend used to hard-code", () => {
    expect(formatBreakLabels(DEFAULT_PRICE_BREAKS)).toEqual(["80k", "120k", "150k", "180k", "220k+"]);
  });
});
