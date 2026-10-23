import { describe, expect, it } from "vitest";
import type { LatestScrapeRun, SourceFreshness } from "@/lib/aggregations";
import { formatUpdated, latestUpdate, partialRuns, sourceLabel } from "./freshness";

const NBSP = /\s/g;
const plain = (s: string) => s.replace(NBSP, " ");

describe("formatUpdated", () => {
  it("shows Stockholm wall-clock time (winter: UTC+1)", () => {
    expect(plain(formatUpdated("2026-03-20T08:00:00Z"))).toBe("20 mars 2026 kl. 09:00");
  });

  it("follows daylight saving time (summer: UTC+2) and rolls the date over", () => {
    expect(plain(formatUpdated("2026-07-01T22:30:00Z"))).toBe("2 juli 2026 kl. 00:30");
  });

  it("is stable across the spring transition", () => {
    expect(plain(formatUpdated("2026-03-29T00:30:00Z"))).toBe("29 mars 2026 kl. 01:30");
    expect(plain(formatUpdated("2026-03-29T01:30:00Z"))).toBe("29 mars 2026 kl. 03:30");
  });
});

const src = (source: string, lastSuccessAt: string | null): SourceFreshness => ({
  source,
  lastSuccessAt,
  listingCount: 1,
  earliestSoldAt: null,
  latestSoldAt: null,
});

describe("latestUpdate", () => {
  it("is the newest successful run over all sources", () => {
    expect(
      latestUpdate([
        src("hemnet", "2026-03-20T08:00:00Z"),
        src("booli", "2026-03-22T07:30:00Z"),
        src("x", null),
      ])
    ).toBe("2026-03-22T07:30:00Z");
  });

  it("is null when nothing has run yet", () => {
    expect(latestUpdate([])).toBeNull();
    expect(latestUpdate([src("hemnet", null)])).toBeNull();
  });
});

describe("sourceLabel", () => {
  it("names the known sources and capitalises unknown ones", () => {
    expect(sourceLabel("hemnet")).toBe("Hemnet");
    expect(sourceLabel("booli")).toBe("Booli");
    expect(sourceLabel("newsite")).toBe("Newsite");
  });
});

describe("partialRuns", () => {
  const run = (source: string, district: LatestScrapeRun["district"], status: LatestScrapeRun["status"]): LatestScrapeRun => ({
    source,
    district,
    status,
    startedAt: "2026-03-22T07:00:00Z",
    finishedAt: "2026-03-22T07:30:00Z",
    pages: 2,
    rowsUpserted: 20,
    rowsRejected: 0,
    oldestSoldAt: null,
  });

  it("lists only the latest runs that stopped early", () => {
    const out = partialRuns([
      run("hemnet", "ostermalm", "partial"),
      run("hemnet", "vasastan", "ok"),
      run("booli", "norrmalm", "partial"),
    ]);
    expect(out).toEqual([
      { source: "hemnet", district: "ostermalm" },
      { source: "booli", district: "norrmalm" },
    ]);
  });

  it("is empty when every run completed", () => {
    expect(partialRuns([run("hemnet", "ostermalm", "ok")])).toEqual([]);
  });
});
