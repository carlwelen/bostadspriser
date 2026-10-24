import { describe, expect, it } from "vitest";
import {
  LOW_SAMPLE_BELOW,
  buildChartData,
  countKey,
  isLowSample,
  meanKey,
  pickTicks,
  type ChartSeries,
} from "./priceChartData";

// The mean sits 1 000 above the median so the two can't be mixed up.
const pt = (bucket: string, median: number, count: number) => ({
  bucket,
  medianPricePerSqm: median,
  meanPricePerSqm: median + 1000,
  count,
});

const MS = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

describe("isLowSample", () => {
  it("flags buckets with fewer than 3 sales", () => {
    expect(LOW_SAMPLE_BELOW).toBe(3);
    expect(isLowSample(1)).toBe(true);
    expect(isLowSample(2)).toBe(true);
    expect(isLowSample(3)).toBe(false);
    expect(isLowSample(40)).toBe(false);
    expect(isLowSample(undefined)).toBe(false);
  });
});

describe("buildChartData", () => {
  const a: ChartSeries = {
    name: "A",
    points: [pt("2025-01-01", 100, 5), pt("2025-02-01", 110, 2), pt("2025-05-01", 130, 4)],
  };

  it("uses UTC millisecond timestamps as the x value", () => {
    const { rows } = buildChartData([a], "month");
    expect(rows[0].t).toBe(MS("2025-01-01"));
    expect(rows[0][countKey("A")]).toBe(5);
  });

  it("plots the median and keeps the mean alongside it", () => {
    const { rows } = buildChartData([a], "month");
    expect(rows[0].A).toBe(100);
    expect(rows[0][meanKey("A")]).toBe(1100);
  });

  it("fills missing months with empty rows so the line breaks there", () => {
    const { rows } = buildChartData([a], "month");
    expect(rows.map((r) => r.t)).toEqual([
      MS("2025-01-01"),
      MS("2025-02-01"),
      MS("2025-03-01"),
      MS("2025-04-01"),
      MS("2025-05-01"),
    ]);
    expect(rows[2].A).toBeUndefined();
    expect(rows[3].A).toBeUndefined();
    expect(rows[4].A).toBe(130);
  });

  it("covers the union of all series' ranges, crossing a year boundary", () => {
    const b: ChartSeries = { name: "B", points: [pt("2024-11-01", 90, 3), pt("2025-01-01", 95, 3)] };
    const { rows } = buildChartData([a, b], "month");
    expect(rows[0].t).toBe(MS("2024-11-01"));
    expect(rows[1].t).toBe(MS("2024-12-01"));
    expect(rows[2].t).toBe(MS("2025-01-01"));
    expect(rows[2].A).toBe(100);
    expect(rows[2].B).toBe(95);
    expect(rows[0].A).toBeUndefined();
  });

  it("steps by year for yearly buckets", () => {
    const y: ChartSeries = { name: "Y", points: [pt("2023-01-01", 1, 9), pt("2026-01-01", 2, 9)] };
    const { rows } = buildChartData([y], "year");
    expect(rows.map((r) => r.t)).toEqual([
      MS("2023-01-01"),
      MS("2024-01-01"),
      MS("2025-01-01"),
      MS("2026-01-01"),
    ]);
  });

  it("returns no rows for no data", () => {
    expect(buildChartData([], "month").rows).toEqual([]);
    expect(buildChartData([{ name: "A", points: [] }], "month").rows).toEqual([]);
  });

  it("sorts unsorted input and tolerates a repeated bucket (last one wins)", () => {
    const s: ChartSeries = {
      name: "S",
      points: [pt("2025-03-01", 3, 3), pt("2025-01-01", 1, 3), pt("2025-01-01", 9, 4)],
    };
    const { rows } = buildChartData([s], "month");
    expect(rows.map((r) => r.t)).toEqual([MS("2025-01-01"), MS("2025-02-01"), MS("2025-03-01")]);
    expect(rows[0].S).toBe(9);
  });

  it("skips buckets that are not valid dates", () => {
    const s: ChartSeries = { name: "S", points: [pt("nonsense", 1, 1), pt("2025-01-01", 2, 3)] };
    expect(buildChartData([s], "month").rows).toHaveLength(1);
  });
});

describe("pickTicks", () => {
  const months = (n: number) =>
    Array.from({ length: n }, (_, i) => Date.UTC(2025, i, 1));

  it("keeps every tick when there is room", () => {
    expect(pickTicks(months(6), 8)).toEqual(months(6));
  });

  it("thins evenly to at most max ticks and keeps the first", () => {
    const t = pickTicks(months(24), 8);
    expect(t.length).toBeLessThanOrEqual(8);
    expect(t[0]).toBe(months(24)[0]);
    const step = t[1] - t[0];
    expect(step).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    expect(pickTicks([], 8)).toEqual([]);
  });
});
