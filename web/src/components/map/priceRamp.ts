// The price/m² colour ramp, shared by the map layer (HeatmapMap) and the
// sidebar legend (PriceLegend) so they cannot drift apart. Breaks come from the
// points currently shown. These are display breaks computed from rows the
// client already holds for rendering, not an aggregation over the database.

export const PRICE_COLORS = ["#1a9850", "#a6d96a", "#fee08b", "#fdae61", "#d73027"] as const;

/** Used when there is nothing to compute from (no points). */
export const DEFAULT_PRICE_BREAKS = [80_000, 120_000, 150_000, 180_000, 220_000];

const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
const STEP = 1000; // breaks are rounded to whole thousands of kr

/** Linear-interpolated quantile of an ascending array (non-empty). */
function quantile(sorted: number[], q: number): number {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const roundStep = (n: number) => Math.round(n / STEP) * STEP;

/**
 * Five strictly ascending breaks (5/25/50/75/95th percentile, rounded to
 * 1 000 kr) for the five ramp colours. The outer percentiles keep outliers
 * from stretching the ramp; Mapbox requires strictly ascending stops, so ties
 * are nudged apart. Falls back to the defaults without usable values and
 * spreads +-20 % around the value when everything is (about) the same.
 */
export function computePriceBreaks(values: number[]): number[] {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [...DEFAULT_PRICE_BREAKS];

  const breaks = QUANTILES.map((q) => roundStep(quantile(sorted, q)));
  if (breaks[0] === breaks[4]) {
    const mid = breaks[2];
    return [0.8, 0.9, 1, 1.1, 1.2].map((f) => roundStep(mid * f));
  }
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i] <= breaks[i - 1]) breaks[i] = breaks[i - 1] + STEP;
  }
  return breaks;
}

/** Mapbox expression colouring a point by its pricePerSqm. */
export function priceColorExpression(breaks: number[]): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["get", "pricePerSqm"],
    ...breaks.flatMap((b, i) => [b, PRICE_COLORS[i]]),
  ];
}

/** "80k" ... "220k+" labels for the legend; the top break is open-ended. */
export function formatBreakLabels(breaks: number[]): string[] {
  return breaks.map((b, i) => `${Math.round(b / 1000)}k${i === breaks.length - 1 ? "+" : ""}`);
}
