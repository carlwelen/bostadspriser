import type { Granularity } from "@/lib/aggregations";

/** A bucket with fewer sales than this is drawn muted: one odd sale can swing the average. */
export const LOW_SAMPLE_BELOW = 3;

export function isLowSample(count: number | undefined): boolean {
  return count !== undefined && count < LOW_SAMPLE_BELOW;
}

export type ChartSeries = {
  name: string;
  points: Array<{
    bucket: string;
    medianPricePerSqm: number;
    meanPricePerSqm: number;
    count: number;
  }>;
};

/** One chart row: `t` (UTC ms of the bucket start) plus, per series, its value and sale count. */
export type ChartRow = { t: number } & Record<string, number | undefined>;

/** Key under which a series' sale count is stored in a row. */
export const countKey = (name: string) => `${name}__n`;
/** Key under which a series' mean is stored in a row (the plotted value is the median). */
export const meanKey = (name: string) => `${name}__mean`;

function stepUtc(ms: number, granularity: Granularity): number {
  const d = new Date(ms);
  return granularity === "year"
    ? Date.UTC(d.getUTCFullYear() + 1, 0, 1)
    : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * Rows for a numeric time axis. Every bucket between the earliest and latest
 * point of any series gets a row, so months without sales are real, empty
 * x positions: the axis keeps true time spacing and lines break there instead
 * of silently joining distant points.
 */
export function buildChartData(
  series: ChartSeries[],
  granularity: Granularity
): { rows: ChartRow[] } {
  const byTime = new Map<number, ChartRow>();
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      const t = Date.parse(p.bucket);
      if (Number.isNaN(t)) continue;
      min = Math.min(min, t);
      max = Math.max(max, t);
      const row = byTime.get(t) ?? { t };
      row[s.name] = p.medianPricePerSqm;
      row[meanKey(s.name)] = p.meanPricePerSqm;
      row[countKey(s.name)] = p.count;
      byTime.set(t, row);
    }
  }
  if (min === Infinity) return { rows: [] };

  const rows: ChartRow[] = [];
  for (let t = min; t <= max; t = stepUtc(t, granularity)) {
    rows.push(byTime.get(t) ?? { t });
  }
  return { rows };
}

/** At most `max` evenly spaced ticks (always starting with the first). */
export function pickTicks(ticks: number[], max: number): number[] {
  if (ticks.length <= max) return ticks;
  const step = Math.ceil(ticks.length / max);
  return ticks.filter((_, i) => i % step === 0);
}
