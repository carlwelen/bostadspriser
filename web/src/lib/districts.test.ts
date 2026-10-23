import { describe, expect, it } from "vitest";
import { DISTRICTS, districtName, isDistrictSlug } from "./districts";

describe("districts", () => {
  it("lists the four inner-city districts in display order", () => {
    expect(DISTRICTS.map((d) => d.slug)).toEqual([
      "ostermalm",
      "vasastan",
      "norrmalm",
      "sodermalm",
    ]);
  });

  it("recognises slugs and rejects anything else", () => {
    expect(isDistrictSlug("sodermalm")).toBe(true);
    expect(isDistrictSlug("Södermalm")).toBe(false);
    expect(isDistrictSlug("")).toBe(false);
  });

  it("maps slugs to Swedish display names", () => {
    expect(districtName("ostermalm")).toBe("Östermalm");
    expect(districtName("sodermalm")).toBe("Södermalm");
  });
});
