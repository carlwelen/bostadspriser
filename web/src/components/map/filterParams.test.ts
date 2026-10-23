import { describe, expect, it } from "vitest";
import {
  applyFilters,
  DEFAULT_FILTERS,
  parseFilters,
  periodToSinceDays,
  serializeFilters,
  type MapFilterState,
} from "./filterParams";

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe("parseFilters", () => {
  it("returns the defaults for an empty query", () => {
    expect(parse("")).toEqual(DEFAULT_FILTERS);
    expect(DEFAULT_FILTERS).toEqual({
      districts: ["ostermalm", "vasastan", "norrmalm", "sodermalm"],
      rooms: [],
      period: "12mo",
      mode: "price",
      showHeatmap: true,
    });
  });

  it("reads every parameter", () => {
    expect(parse("districts=vasastan&rooms=2,3&period=3mo&mode=frequency&heatmap=0")).toEqual({
      districts: ["vasastan"],
      rooms: [2, 3],
      period: "3mo",
      mode: "frequency",
      showHeatmap: false,
    });
  });

  it("treats an empty districts param as 'none selected' (the F2 empty state)", () => {
    expect(parse("districts=").districts).toEqual([]);
  });

  it("matches district slugs case-insensitively", () => {
    expect(parse("districts=Vasastan,SODERMALM").districts).toEqual(["vasastan", "sodermalm"]);
  });

  it("falls back to all districts when the param holds no valid slug", () => {
    expect(parse("districts=gamla-stan,x").districts).toEqual(DEFAULT_FILTERS.districts);
  });

  it("drops invalid slugs, de-duplicates and uses the canonical order", () => {
    expect(parse("districts=sodermalm,nope,ostermalm,sodermalm").districts).toEqual([
      "ostermalm",
      "sodermalm",
    ]);
  });

  it("keeps only rooms 1-5, de-duplicated and sorted", () => {
    expect(parse("rooms=3,abc,0,6,-1,2,2,1.5,%20").rooms).toEqual([2, 3]);
    expect(parse("rooms=").rooms).toEqual([]);
  });

  it("falls back to the defaults for an unknown period, mode or heatmap value", () => {
    const s = parse("period=forever&mode=3d&heatmap=maybe");
    expect(s.period).toBe("12mo");
    expect(s.mode).toBe("price");
    expect(s.showHeatmap).toBe(true);
  });

  it("uses the first value of a repeated parameter and ignores unrelated ones", () => {
    expect(parse("mode=frequency&mode=price&utm_source=x").mode).toBe("frequency");
  });
});

describe("serializeFilters", () => {
  it("omits defaults", () => {
    expect(serializeFilters(DEFAULT_FILTERS)).toBe("");
  });

  it("writes non-default values", () => {
    const s: MapFilterState = {
      districts: ["vasastan", "norrmalm"],
      rooms: [2, 3],
      period: "all",
      mode: "frequency",
      showHeatmap: false,
    };
    expect(serializeFilters(s)).toBe(
      "districts=vasastan,norrmalm&rooms=2,3&period=all&mode=frequency&heatmap=0"
    );
  });

  it("writes an empty districts param for 'none selected'", () => {
    expect(serializeFilters({ ...DEFAULT_FILTERS, districts: [] })).toBe("districts=");
  });

  it("round-trips", () => {
    const cases: MapFilterState[] = [
      DEFAULT_FILTERS,
      { ...DEFAULT_FILTERS, districts: [] },
      { ...DEFAULT_FILTERS, districts: ["norrmalm"], rooms: [5], period: "30d" },
      { ...DEFAULT_FILTERS, mode: "frequency", showHeatmap: false, period: "all" },
    ];
    for (const c of cases) expect(parse(serializeFilters(c))).toEqual(c);
  });
});

describe("strict room parsing", () => {
  it("rejects exponent, hex, signed, padded and decimal forms", () => {
    expect(parse("rooms=1e0,0x2,%2B3,03,2.0,4").rooms).toEqual([4]);
  });
});

describe("applyFilters", () => {
  it("keeps unrelated parameters and rewrites only the filter keys", () => {
    const current = "?utm_source=x&mode=3d&districts=nope&foo=bar%20baz&q=a%2Cb";
    const next = { ...DEFAULT_FILTERS, mode: "frequency" as const };
    // Other parameters are kept byte for byte (no %20 -> +, no %2C -> ,).
    expect(applyFilters(current, next)).toBe("utm_source=x&foo=bar%20baz&q=a%2Cb&mode=frequency");
  });

  it("removes filter keys that are back at their defaults", () => {
    const current = "rooms=2&period=all&keep=1";
    expect(applyFilters(current, DEFAULT_FILTERS)).toBe("keep=1");
  });

  it("does not mutate its input", () => {
    const current = new URLSearchParams("mode=frequency");
    applyFilters(current, DEFAULT_FILTERS);
    expect(current.toString()).toBe("mode=frequency");
  });

  it("writes commas unescaped in the filter values", () => {
    const out = applyFilters("", { ...DEFAULT_FILTERS, districts: ["vasastan", "norrmalm"], rooms: [2, 3] });
    expect(out).toBe("districts=vasastan,norrmalm&rooms=2,3");
    expect(out).not.toContain("%2C");
  });
});

describe("periodToSinceDays", () => {
  it("maps periods to day counts and 'all' to undefined", () => {
    expect(periodToSinceDays("30d")).toBe(30);
    expect(periodToSinceDays("3mo")).toBe(90);
    expect(periodToSinceDays("12mo")).toBe(365);
    expect(periodToSinceDays("all")).toBeUndefined();
  });
});
