import { describe, expect, it } from "vitest";
import { formatSalesInSelection, salesWord } from "./format";

describe("salesWord", () => {
  it("is singular only for exactly one", () => {
    expect(salesWord(1)).toBe("försäljning");
    expect(salesWord(0)).toBe("försäljningar");
    expect(salesWord(2)).toBe("försäljningar");
    expect(salesWord(1000)).toBe("försäljningar");
  });
});

describe("formatSalesInSelection", () => {
  it("agrees the noun with the count and groups thousands the Swedish way", () => {
    expect(formatSalesInSelection(1)).toBe("1 försäljning i urvalet");
    expect(formatSalesInSelection(0)).toBe("0 försäljningar i urvalet");
    expect(formatSalesInSelection(28)).toBe("28 försäljningar i urvalet");
    expect(formatSalesInSelection(1234)).toBe("1 234 försäljningar i urvalet");
  });
});
