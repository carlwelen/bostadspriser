import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import InsightsPage from "./page";

vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("@/components/Histogram", () => ({ Histogram: () => null }));
vi.mock("@/components/PriceAreaScatter", () => ({ PriceAreaScatter: () => null }));
vi.mock("@/lib/aggregations", () => ({
  globalSummary: async () => ({ total: 20, byDistrict: [] }),
  pricePerSqmDistribution: async () => [],
  roomsBreakdown: async () => [],
  priceAreaSample: async () => [],
  sourceFreshness: async () => [],
  latestScrapeRuns: async () => [],
  topMovers: async (direction: string) => direction === "down" ? [] : [{
    district: "sodermalm", slug: "gotgatan", street: "Götgatan",
    count: 21, meanPricePerSqm: 222222, pctChange: 10,
    recentCount: 7, priorCount: 14,
    recentMedianPricePerSqm: 110000, priorMedianPricePerSqm: 100000,
  }],
}));

it("explains the disjoint median windows and shows each window's sample size", async () => {
  const html = renderToStaticMarkup(await InsightsPage());
  expect(html).toContain("Median senaste 90 dagar jämfört med föregående 12 månader");
  expect(html).not.toContain("vs hela perioden");
  expect(html).toContain("Senaste 90 dagar: 110 000 kr/m² (7 försäljningar)");
  expect(html).toContain("Föregående 12 månader: 100 000 kr/m² (14 försäljningar)");
  expect(html).not.toContain("222 222");
  expect(html).toContain("Otillräckligt underlag.");
});
