import { expect, it } from "vitest";
import { comparisonHref, comparisonIds, parseComparisonSpec } from "./comparison";

it("deduplicates every repeated and comma-separated query value before loading", () => {
  expect(comparisonIds(["district:ostermalm,district:ostermalm", "street:sodermalm/gotgatan", "street:sodermalm/gotgatan"]))
    .toEqual(["district:ostermalm", "street:sodermalm/gotgatan"]);
  expect(comparisonIds(undefined)).toHaveLength(4);
  expect(comparisonIds("")).toEqual([]);
});

it("rejects unknown districts, extra path segments and malformed street slugs", () => {
  for (const id of ["district:toString", "street:sodermalm/gotgatan/extra", "street:sodermalm/../", "street:unknown/a", "street:sodermalm/", "street:sodermalm/åäö"]) {
    expect(parseComparisonSpec(id)).toBeNull();
  }
});

it("keeps the explicit empty selection and granularity when the final chip is removed", () => {
  expect(comparisonHref([], "year")).toBe("/compare?series=&g=year");
  expect(comparisonHref(["district:ostermalm", "district:ostermalm"], "month"))
    .toBe("/compare?series=district%3Aostermalm");
});
