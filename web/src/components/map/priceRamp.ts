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

const isStrictlyAscending = (b: number[]) => b.every((v, i) => i === 0 || v > b[i - 1]);

/** Strictly ascending, finite: what Mapbox's `interpolate` accepts. */
function isValidBreaks(b: number[]): boolean {
  return b.length === 5 && b.every(Number.isFinite) && isStrictlyAscending(b);
}

/** Push ties apart so every break is above the one before it. */
function ascend(b: number[]): number[] {
  const out = [...b];
  for (let i = 1; i < out.length; i++) {
    if (out[i] <= out[i - 1]) out[i] = out[i - 1] + STEP;
  }
  return out;
}

/**
 * Five strictly ascending breaks (5/25/50/75/95th percentile, rounded to
 * 1 000 kr) for the five ramp colours. The outer percentiles keep outliers
 * from stretching the ramp; Mapbox requires strictly ascending stops, so ties
 * are nudged apart. Falls back to the defaults without usable values and
 * spreads +-10 % steps around the value when everything is (about) the same.
 * Whatever comes out is checked once more and replaced by the defaults if it
 * is still not a valid ramp.
 */
export function computePriceBreaks(values: number[]): number[] {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [...DEFAULT_PRICE_BREAKS];

  let breaks = QUANTILES.map((q) => roundStep(quantile(sorted, q)));
  if (breaks[0] === breaks[4]) {
    const mid = quantile(sorted, 0.5);
    breaks = [-2, -1, 0, 1, 2].map((k) => roundStep(mid * (1 + 0.1 * k)));
  }
  if (!isStrictlyAscending(breaks)) {
    // Tied quantiles still use the outer percentiles, so an extreme sale
    // cannot stretch the whole ramp just because central prices repeat.
    const lo = roundStep(quantile(sorted, QUANTILES[0]));
    const hi = roundStep(quantile(sorted, QUANTILES[4]));
    if (hi > lo) breaks = [0, 1, 2, 3, 4].map((i) => roundStep(lo + ((hi - lo) * i) / 4));
  }
  breaks = ascend(breaks);
  return isValidBreaks(breaks) ? breaks : [...DEFAULT_PRICE_BREAKS];
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

/** "≤80k" ... "220k+" labels for the legend; both end breaks are open-ended. */
export function formatBreakLabels(breaks: number[]): string[] {
  const last = breaks.length - 1;
  return breaks.map((b, i) => `${i === 0 ? "≤" : ""}${Math.round(b / 1000)}k${i === last ? "+" : ""}`);
}

const zoomRamp = (...stops: number[]) => ["interpolate", ["linear"], ["zoom"], ...stops];

/**
 * Paint for the price circles. Used both when the layer is added and when the
 * breaks change (`setPaintProperty(..., "circle-color", ...)`), so the layer
 * can't colour with anything but the breaks the legend shows.
 *
 * The layer plays two roles depending on zoom: at low zoom large, blurred,
 * semi-transparent dots overlap and "paint" a price field; at high zoom small
 * precise circles with a hairline white stroke, each one a clickable sale.
 */
export function pricePointPaint(breaks: number[]) {
  return {
    "circle-radius": zoomRamp(10, 28, 12, 18, 14, 10, 16, 6, 18, 5),
    "circle-blur": zoomRamp(10, 0.85, 12, 0.55, 14, 0.25, 16, 0),
    "circle-color": priceColorExpression(breaks),
    "circle-opacity": zoomRamp(10, 0.18, 12, 0.32, 14, 0.6, 16, 0.9, 18, 0.95),
    "circle-stroke-width": zoomRamp(14, 0, 16, 1),
    "circle-stroke-color": "#ffffff",
  };
}
