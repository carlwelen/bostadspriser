import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { AddressResponse } from "@/lib/api-types";
import { DrawerTooltip } from "./DrawerTooltip";

const data: AddressResponse = {
  district: "ostermalm", street: "Karlavägen", house: "10", period: "12mo", granularity: "month",
  streetSeries: [{ bucket: "2025-06-01", meanPricePerSqm: 140_000, medianPricePerSqm: 130_000, count: 2 }],
  addressSales: [
    { soldAt: "2025-06-01", priceSek: 3_000_000, pricePerSqmSek: 100_000, sources: ["booli"] },
    { soldAt: "2025-06-01", priceSek: 3_600_000, pricePerSqmSek: 120_000, sources: ["hemnet"] },
  ],
};

it("reports the SQL bucket count and every same-day individual sale (F12)", () => {
  const html = renderToStaticMarkup(createElement(DrawerTooltip, { active: true, label: Date.parse("2025-06-01"), data }));
  expect(html).toContain("2 försäljningar");
  expect(html).toContain("få affärer");
  expect(html.match(/1 försäljning/g)).toHaveLength(2);
  expect(html).toContain("100 000 kr/m²");
  expect(html).toContain("120 000 kr/m²");
});

it("does not invent counts for a missing bucket or inactive tooltip (F12)", () => {
  expect(renderToStaticMarkup(createElement(DrawerTooltip, { active: true, label: Date.parse("2025-07-01"), data }))).toBe("");
  expect(renderToStaticMarkup(createElement(DrawerTooltip, { active: false, label: Date.parse("2025-06-01"), data }))).toBe("");
});

it("leads with the median and keeps the SQL mean as context (B14)", () => {
  const html = renderToStaticMarkup(createElement(DrawerTooltip, { active: true, label: Date.parse("2025-06-01"), data }));
  expect(html).toContain("Gatans median: 130 000 kr/m²");
  expect(html).toContain("Medel: 140 000 kr/m²");
});
