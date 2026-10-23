import { describe, expect, it } from "vitest";
import { formatSales, formatSold, soldWord } from "./plural";

describe("Swedish singular/plural counts", () => {
  it("uses the singular only for exactly one", () => {
    expect(soldWord(1)).toBe("såld");
    expect(soldWord(0)).toBe("sålda");
    expect(soldWord(2)).toBe("sålda");
  });

  it("formats counts with a number", () => {
    expect(formatSold(1)).toBe("1 såld");
    expect(formatSold(14)).toBe("14 sålda");
    expect(formatSales(1)).toBe("1 försäljning");
    expect(formatSales(0)).toBe("0 försäljningar");
  });

  it("groups thousands the Swedish way (NBSP)", () => {
    expect(formatSold(1234)).toMatch(/^1 234 sålda$/);
  });
});
