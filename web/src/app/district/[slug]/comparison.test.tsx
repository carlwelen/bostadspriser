import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import DistrictPage from "./page";

vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("@/components/PriceChart", () => ({ PriceChart: () => null }));
vi.mock("@/lib/aggregations", () => ({
  MIN_MOM_SALES: 3,
  districtTimeseries: async () => [],
  districtStreetCount: async () => ({ count: 0, streetCount: 0, meanPricePerSqm: null, medianPricePerSqm: null, earliest: null, latest: null }),
  districtMomChange: async () => null,
  listStreets: async () => [],
  recentSales: async () => [],
}));

it("preserves annual granularity when entering comparison from a district", async () => {
  const html = renderToStaticMarkup(await DistrictPage({ params: Promise.resolve({ slug: "ostermalm" }), searchParams: Promise.resolve({ g: "year" }) }));
  expect(html).toContain('/compare?series=district%3Aostermalm&amp;g=year');
});
