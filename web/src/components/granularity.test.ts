import { describe, expect, it } from "vitest";
import { granularityHref, parseGranularity } from "./granularity";

describe("parseGranularity", () => {
  it("accepts year and month, defaults everything else to month", () => {
    expect(parseGranularity("year")).toBe("year");
    expect(parseGranularity("month")).toBe("month");
    expect(parseGranularity(undefined)).toBe("month");
    expect(parseGranularity("banana")).toBe("month");
    expect(parseGranularity("YEAR")).toBe("month");
    expect(parseGranularity("")).toBe("month");
  });

  it("uses the first value when the parameter is repeated", () => {
    expect(parseGranularity(["year", "month"])).toBe("year");
    expect(parseGranularity([])).toBe("month");
  });
});

describe("granularityHref", () => {
  it("adds g=year and drops the parameter for the default", () => {
    expect(granularityHref("/district/ostermalm", {}, "year")).toBe("/district/ostermalm?g=year");
    expect(granularityHref("/district/ostermalm", { g: "year" }, "month")).toBe("/district/ostermalm");
  });

  it("keeps the other query parameters, encoded", () => {
    expect(
      granularityHref("/compare", { series: "district:ostermalm,street:vasastan/odengatan" }, "year")
    ).toBe("/compare?series=district%3Aostermalm%2Cstreet%3Avasastan%2Fodengatan&g=year");
  });

  it("keeps repeated parameters", () => {
    expect(granularityHref("/compare", { series: ["a", "b"] }, "year")).toBe(
      "/compare?series=a&series=b&g=year"
    );
  });

  it("replaces an existing g instead of duplicating it", () => {
    expect(granularityHref("/compare", { series: "a", g: ["month", "month"] }, "year")).toBe(
      "/compare?series=a&g=year"
    );
  });
});
