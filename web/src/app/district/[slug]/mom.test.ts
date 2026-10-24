import { describe, expect, it } from "vitest";
import type { DistrictMomChange } from "@/lib/aggregations";
import { describeMom, formatMonthYear } from "./mom";

const base: DistrictMomChange = {
  current: 165_000,
  previous: 150_000,
  pctChange: 10,
  currentMedian: 165_000,
  previousMedian: 150_000,
  medianPctChange: 10,
  currentMonth: "2026-09-01",
  previousMonth: "2026-08-01",
  currentCount: 14,
  previousCount: 12,
};

describe("formatMonthYear", () => {
  it("names the month in Swedish, without a time-zone shift", () => {
    expect(formatMonthYear("2026-09-01")).toBe("september 2026");
    expect(formatMonthYear("2026-01-01")).toBe("januari 2026");
    expect(formatMonthYear("2025-12-01")).toBe("december 2025");
  });
});

describe("describeMom", () => {
  it("shows the change and the two compared months with their sample sizes", () => {
    const d = describeMom(base, 3);
    expect(d.value).toMatch(/^\+10,0\s?%$/);
    expect(d.tone).toBe("up");
    expect(d.hint).toContain("Medianpris/m²");
    expect(d.hint).toContain("augusti 2026");
    expect(d.hint).toContain("september 2026");
    expect(d.hint).toContain("12");
    expect(d.hint).toContain("14");
  });

  it("is a decline for negative changes", () => {
    const d = describeMom({ ...base, current: 135_000, pctChange: -10, currentMedian: 135_000, medianPctChange: -10 }, 3);
    expect(d.tone).toBe("down");
    expect(d.value).toMatch(/^[-−]10,0\s?%$/);
  });

  it("says there are too few sales, and for which months, when pctChange is null", () => {
    const d = describeMom({ ...base, pctChange: null, medianPctChange: null, currentCount: 2 }, 3);
    expect(d.value).toBe("—");
    expect(d.tone).toBe("neutral");
    expect(d.hint).toContain("För få affärer");
    expect(d.hint).toContain("september 2026: 2 försäljningar");
    expect(d.hint).toContain("augusti 2026: 12 försäljningar");
    expect(d.hint).toContain("minst 3");
  });

  it("uses the singular for exactly one sale", () => {
    const d = describeMom({ ...base, pctChange: null, medianPctChange: null, previousCount: 1 }, 3);
    expect(d.hint).toContain("augusti 2026: 1 försäljning,");
  });

  it("uses median change and tone when mean and median move in opposite directions", () => {
    const d = describeMom({ ...base, pctChange: 30, medianPctChange: -5 }, 3);
    expect(d.value).toMatch(/^[-−]5,0\s?%$/);
    expect(d.tone).toBe("down");
    expect(d.hint).toContain("Medianpris/m²");
  });

  it("does not fall back to a mean change when the median change is unavailable", () => {
    const d = describeMom({ ...base, medianPctChange: null, currentCount: 2 }, 3);
    expect(d.value).toBe("—");
    expect(d.tone).toBe("neutral");
    expect(d.hint).toContain("För få affärer");
  });

  it("retains the median change when the mean change is unavailable", () => {
    const d = describeMom({ ...base, pctChange: null }, 3);
    expect(d.value).toMatch(/^\+10,0\s?%$/);
    expect(d.tone).toBe("up");
  });

  it("says so when neither month has any sales", () => {
    const d = describeMom(null, 3);
    expect(d.value).toBe("—");
    expect(d.hint).toBe("Inga försäljningar de två senaste hela månaderna.");
  });
});
